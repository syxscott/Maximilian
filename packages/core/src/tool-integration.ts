// Tool integration — bridges @max/tools with AgentRuntime
// Adds tool execution capability to agents without modifying the base Agent class
// 借鉴 pi: beforeToolCall/afterToolCall hooks, parallel execution, truncated message safety

import type { AnyTool, ToolDefinition } from "@max/llm"
import {
  createToolRegistry,
  type ToolRegistry,
  type Materialization,
  type ExecuteInput,
  isPermissionRequestError,
  isPermissionDeniedError,
  PermissionDeniedError,
  type ToolName,
} from "@max/tools"
import type { Provider, ChatMessage, ChatOptions } from "@max/providers"
import { mergeAdjacentSameRole } from "@max/providers"
import type { AgentContext, Agent } from "./agent.js"
import { isLLMRequestOversized } from "./error-taxonomy.js"
import { isRefusalFinish, settleRefusal, canContinueAsPrefix } from "./refusal.js"
import { shouldInjectAnchor, formatAnchorMessage } from "./context-anchor.js"
import { compactProactiveHistory, type CompactionSummarizer } from "./compaction.js"
import type {
  BeforeToolCallContext,
  BeforeToolCallResult,
  AfterToolCallContext,
  AfterToolCallResult,
  ToolExecutionMode,
} from "./types.js"

// Re-export `createToolRegistry` so consumers / tests can build a registry
// synchronously and pass it to a `ToolEnabledProvider` without going through
// `createDefaultToolRegistry` (which pulls in BUILTIN_TOOLS via dynamic
// import).
export { createToolRegistry, type ToolRegistry }

// ── Tool-Enabled Provider Wrapper ──

export interface ToolCall {
  id: string
  name: string
  input: unknown
  /**
   * Optional per-tool execution mode override (借鉴 pi).
   * When set, this tool's execution is controlled by this mode rather than
   * the global toolExecution option.
   */
  executionMode?: ToolExecutionMode
}

/** Result of a finalized tool call (借鉴 pi). */
export interface FinalizedToolCallOutcome {
  toolCall: ToolCall
  result: unknown
  isError: boolean
}

export interface ToolEnabledResponse {
  content: string
  toolCalls: ToolCall[]
  model: string
  /** Why the model stopped generating. "length" means output was truncated (借鉴 pi). */
  stopReason?: string
  /**
   * Safety-refusal settlement flag (deepseek chat-demo reply.ts borrowing).
   * Set when the provider reported finishReason "refusal": the turn is
   * terminal and its partial body is protocol-untrusted — downstream
   * consumers must treat it as having no valid content.
   */
  refused?: boolean
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    /** Mirrors Provider ChatResponse.usage — see packages/providers/src/base.ts. */
    cacheReadTokens?: number
    cacheCreationTokens?: number
  }
}

/**
 * Wraps a Provider to support tool calls in chat responses.
 * This extends the basic chat interface with tool awareness.
 */
export class ToolEnabledProvider {
  private toolDefs: ToolDefinition[] = []
  /**
   * Per-agent tool allowlist (借鉴 cc-switch).
   * When set, only tools in this set are returned by getToolDefinitions().
   */
  private allowedToolNames?: Set<string>
  /**
   * Per-agent tool denylist (借鉴 cc-switch, wins over allowlist).
   */
  private deniedToolNames?: Set<string>
  /**
   * Live tool-scope source (borrowing; MiniApps package-contract.md:156
   * "live switch" semantics). When set, the CURRENT allow/deny sets are
   * re-read on EVERY getToolDefinitions() and executeTool() call —
   * mid-run permission changes apply to the next call without re-running
   * the task. The static sets from setToolAllowlist/setToolDenylist stay
   * as the base: the live allow REPLACES the static allow, the live deny
   * is UNIONED with the static deny (deny is fail-closed).
   */
  private liveToolScopes?: () => { allowed?: string[]; denied?: string[] } | undefined
  /** Cached tool instructions string, invalidated when tool sets change. */
  private toolInstructionsCache?: string

  constructor(
    private provider: Provider,
    private registry: ToolRegistry,
  ) {}

  /**
   * Restrict available tools to the given set of names (借鉴 cc-switch).
   * Pass undefined to lift restriction.
   */
  setToolAllowlist(names: string[] | undefined): void {
    this.allowedToolNames = names ? new Set(names) : undefined
    this.toolInstructionsCache = undefined // Invalidate cache
  }

  /**
   * Exclude specific tools from the available set (借鉴 cc-switch).
   * Denylist wins over allowlist: if a tool is in both, it's denied.
   */
  setToolDenylist(names: string[] | undefined): void {
    this.deniedToolNames = names ? new Set(names) : undefined
    this.toolInstructionsCache = undefined // Invalidate cache
  }

  /**
   * Install the live tool-scope source (borrowing; see the field doc).
   * Pass undefined to fall back to the static sets only.
   */
  setLiveToolScopes(
    get: (() => { allowed?: string[]; denied?: string[] } | undefined) | undefined,
  ): void {
    this.liveToolScopes = get
    this.toolInstructionsCache = undefined // Invalidate cache
  }

  /**
   * Effective allow/deny sets RIGHT NOW (borrowing): re-evaluated on every
   * definition listing and tool execution so a live scope change lands on
   * the next call. Live allow replaces the static allow; live deny unions
   * with the static deny.
   */
  private effectiveScopes(): { allowed?: Set<string>; denied?: Set<string> } {
    const live = this.liveToolScopes?.()
    const allowed = live?.allowed !== undefined ? new Set(live.allowed) : this.allowedToolNames
    const deniedNames = live?.denied
    const denied =
      deniedNames !== undefined
        ? new Set([...(this.deniedToolNames ?? []), ...deniedNames])
        : this.deniedToolNames
    return { allowed, denied }
  }

  /** Get tool definitions for the current scope, filtered by allow/deny. */
  getToolDefinitions(): ToolDefinition[] {
    const all = this.registry.materialize().definitions
    const { allowed, denied } = this.effectiveScopes()
    if (!allowed && !denied) return all
    return all.filter((d) => {
      if (denied?.has(d.name)) return false
      if (allowed && !allowed.has(d.name)) return false
      return true
    })
  }

  /** Execute a tool call through the registry. */
  async executeTool(
    call: ToolCall,
    context: { sessionID: string; agent: string; assistantMessageID: string },
  ): Promise<{
    result: unknown
    output?: { structured: unknown; content: ReadonlyArray<{ type: string; text?: string }> }
  }> {
    // Live-scope gate (borrowing; MiniApps package-contract.md:156): the
    // CURRENT scopes are re-read at execution time, so a mid-run denylist
    // change denies the next call of the same tool with an explainable
    // error (PermissionDeniedError — the tool loop surfaces it as a
    // tool-end error the LLM can adapt to) instead of executing it. The
    // denial is about the TOOL as a whole here, so the error's target is
    // the tool name itself.
    const { allowed, denied } = this.effectiveScopes()
    const scopeDenied =
      denied?.has(call.name) === true || (allowed !== undefined && !allowed.has(call.name))
    if (scopeDenied) {
      throw new PermissionDeniedError({
        tool: call.name as ToolName,
        target: call.name,
        callId: call.id,
      })
    }
    const materialization = this.registry.materialize()
    const input: ExecuteInput = {
      sessionID: context.sessionID,
      agent: context.agent,
      assistantMessageID: context.assistantMessageID,
      call: { id: call.id, name: call.name, input: call.input },
    }
    const settlement = await materialization.settle(input)
    return {
      result: settlement.result,
      output: settlement.output
        ? {
            structured: settlement.output.structured,
            content: settlement.output.content.map((c) => ({
              type: c.type,
              text: "text" in c ? c.text : undefined,
            })),
          }
        : undefined,
    }
  }

  /** Chat with tool definitions included. */
  /** Render the tool instructions block from the current definitions. */
  private buildToolInstructions(): string {
    const toolDefs = this.getToolDefinitions()
    return toolDefs.length > 0
      ? `\n\nYou have access to the following tools:\n${toolDefs.map((t) => `- ${t.name}: ${t.description}`).join("\n")}\n\nTo use a tool, respond with a JSON block:\n\`\`\`tool\n{"name": "tool-name", "input": {...}}\n\`\`\``
      : ""
  }

  /** Chat with tool definitions included. */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ToolEnabledResponse> {
    // Compute the tool instructions from the CURRENT scopes. The cache is
    // only valid without a live scope source (borrowing): with one set,
    // the CURRENT allow/deny sets must shape the tool list on every
    // round, or a mid-run scope change would leave a denied tool
    // advertised to the LLM.
    let toolInstructions: string
    if (this.liveToolScopes) {
      toolInstructions = this.buildToolInstructions()
      this.toolInstructionsCache = undefined
    } else {
      if (this.toolInstructionsCache === undefined) {
        this.toolInstructionsCache = this.buildToolInstructions()
      }
      toolInstructions = this.toolInstructionsCache
    }

    const enhancedMessages = messages.map((m, i) =>
      i === 0 && m.role === "system" ? { ...m, content: m.content + toolInstructions } : m,
    )

    // Role-alternation hardening (hermes moa_alternation borrowing): strict
    // alternation templates 400 on adjacent same-role messages; merge them
    // and remember the model needs pre-merging on subsequent calls.
    let response = await this.provider.chat(enhancedMessages, options)
    let lastError: unknown
    if (response === undefined) {
      try {
        response = await this.provider.chat(mergeAdjacentSameRole(enhancedMessages), options)
      } catch (err) {
        lastError = err
      }
      if (response === undefined && lastError) {
        throw lastError
      }
    }

    // Parse tool calls from response
    const toolCalls = this.parseToolCalls(response.content)

    return {
      content: response.content,
      toolCalls,
      model: response.model,
      // Propagate the provider finishReason (previously dropped on the
      // floor): the tool loop gates truncated tool calls on "length" and
      // refusal termination on "refusal" (deepseek chat-demo reply.ts
      // borrowing).
      stopReason: response.finishReason,
      ...(isRefusalFinish(response.finishReason) ? { refused: true } : {}),
      usage: response.usage,
    }
  }

  /** Parse tool calls from LLM response text. */
  private parseToolCalls(text: string): ToolCall[] {
    const toolCalls: ToolCall[] = []
    const regex = /```tool\s*\n([\s\S]*?)\n```/g
    let match

    while ((match = regex.exec(text)) !== null) {
      const parsed = this.tryParseToolJson(match[1])
      if (parsed?.name) {
        const resolved = this.fuzzyMatchTool(parsed.name)
        if (resolved === undefined) {
          // Negative-result gate: no close match. Record the miss as a
          // tool call so the loop surfaces an actionable error (with the
          // available list) instead of executing garbage.
          toolCalls.push({
            id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: parsed.name,
            input: parsed.input ?? {},
          })
          continue
        }
        toolCalls.push({
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: resolved,
          input: parsed.input ?? {},
        })
      }
    }

    return toolCalls
  }

  /**
   * Try to parse tool JSON with auto-repair for common LLM mistakes:
   *  - Trailing commas in objects/arrays
   *  - Single quotes instead of double quotes
   *  - Unquoted keys
   *  - Truncated JSON (missing closing braces)
   */
  private tryParseToolJson(raw: string): { name?: string; input?: unknown } | null {
    // First attempt: direct parse
    try {
      return JSON.parse(raw)
    } catch {
      /* fall through */
    }

    // Repair attempt 1: remove trailing commas
    try {
      const cleaned = raw.replace(/,\s*([}\]])/g, "$1")
      return JSON.parse(cleaned)
    } catch {
      /* fall through */
    }

    // Repair attempt 2: fix single quotes → double quotes
    // Only when the input doesn't already contain double quotes (avoids
    // corrupting strings like "it's a test").
    try {
      if (!raw.includes('"')) {
        const cleaned = raw.replace(/'/g, '"')
        return JSON.parse(cleaned)
      }
    } catch {
      /* fall through */
    }

    // Repair attempt 3: close truncated JSON
    try {
      let fixed = raw.trim()
      // Count open vs close braces/brackets
      const openBraces = (fixed.match(/{/g) ?? []).length
      const closeBraces = (fixed.match(/}/g) ?? []).length
      const openBrackets = (fixed.match(/\[/g) ?? []).length
      const closeBrackets = (fixed.match(/]/g) ?? []).length
      for (let i = 0; i < openBrackets - closeBrackets; i++) fixed += "]"
      for (let i = 0; i < openBraces - closeBraces; i++) fixed += "}"
      return JSON.parse(fixed)
    } catch {
      /* give up */
    }

    return null
  }

  /**
   * Fuzzy match a tool name against registered tools.
   * Uses Levenshtein distance to find the closest match when the LLM
   * misspells a tool name (crewAI pattern).
   *
   * Negative-result gate (hermes borrowing: tool_search 零分/低置信门 —
   * "查无此工具时明确返回无结果"): when nothing matches within the
   * threshold, return undefined and let the loop surface an honest
   * "no such tool" error listing the available tools. Silently executing
   * the misspelled name produced a generic registry error that sent the
   * model into infinite rephrasing hunts.
   */
  private fuzzyMatchTool(name: string): string | undefined {
    const defs = this.getToolDefinitions()
    const known = defs.map((d) => d.name)

    // Exact match
    if (known.includes(name)) return name

    // Case-insensitive match
    const lower = name.toLowerCase()
    const ciMatch = known.find((n) => n.toLowerCase() === lower)
    if (ciMatch) return ciMatch

    // Levenshtein distance ≤ 2
    let bestMatch: string | undefined
    let bestDist = Infinity
    for (const candidate of known) {
      const dist = levenshtein(lower, candidate.toLowerCase())
      if (dist < bestDist && dist <= 2) {
        bestDist = dist
        bestMatch = candidate
      }
    }

    return bestMatch
  }

  /** Stream chat with tool definitions included. */
  async *stream(messages: ChatMessage[], options?: ChatOptions) {
    yield* this.provider.stream(messages, options)
  }

  get id(): string {
    return this.provider.id
  }
  get name(): string {
    return this.provider.name
  }
  get defaultModel(): string {
    return this.provider.defaultModel
  }
  isConfigured(): boolean {
    return this.provider.isConfigured()
  }
}

// ── Tool-Enabled Agent Context ──

export interface ToolAgentContext extends AgentContext {
  /** The tool-enabled provider for making tool-aware LLM calls. */
  toolProvider: ToolEnabledProvider
  /** Session ID for tool execution context. */
  sessionID: string
}

// ── Tool Execution Loop ──

export interface ToolLoopOptions {
  /** Maximum number of tool call rounds (default: 10) */
  maxRounds?: number
  /**
   * Maximum total tool calls across all rounds (default: 30).
   * Acts as a hard budget to prevent runaway tool usage.
   */
  maxToolCalls?: number
  /**
   * When true, a round that produces a new assistant message (i.e. the LLM
   * makes progress) refunds one tool-call from the budget (hermes-agent
   * pattern). Default: false.
   */
  refundOnProgress?: boolean
  /** Callback when a tool is called */
  onToolCall?: (call: ToolCall) => void
  /** Callback when a tool returns a result */
  onToolResult?: (call: ToolCall, result: unknown) => void
  /**
   * Optional emitter for tool.start / tool.end runtime events.
   * When provided, the loop emits structured tool-usage events that the
   * runtime can forward to listeners (telemetry, UI, Prometheus, etc).
   */
  emitEvent?: (event: import("./runtime.js").RuntimeEvent) => void
  /** Workspace + task IDs for the runtime event envelope. */
  workspaceId?: string
  taskId?: string
  /**
   * If a tool call throws `PermissionRequestError` (the runtime gate decided
   * "ask"), the loop emits a `permission-request` event and parks here.
   * The runtime must call back into the resolver (or abort) to unblock.
   * Resolution with "allow" causes the loop to re-execute the same call;
   * "deny" surfaces a tool error so the LLM can adapt.
   *
   * The second argument carries the same metadata the loop already emitted
   * to the UI — the runtime uses it to write the audit-log entry and to
   * surface `permission-resolved` with matching `workspaceId`/`taskId`.
   */
  awaitPermission?: (
    requestId: string,
    meta: { workspaceId: string; taskId: string; tool: string; target: string },
  ) => Promise<"allow" | "deny">
  /**
   * Tool result cache (借鉴 crewAI cache_handler.py).
   *
   * When provided, identical tool+input calls return the cached output
   * without re-executing the tool. Key = `${tool.name}|${stableStringify(input)}`.
   *
   * Use cases:
   *   - Idempotent tools (file reads, web fetches) skip repeat work
   *   - Retries after a transient failure don't re-pay the cost
   *   - "Why did the LLM get the same result twice?" becomes traceable
   *
   * The cache lives for the duration of a single `runToolLoop` call.
   * Cross-loop caching belongs at a higher layer (e.g. an MCP server's
   * own cache).
   */
  toolCache?: Map<string, unknown>
  /**
   * Steering messages (借鉴 openclaw agent-loop.ts:258-389 outer/inner loops).
   *
   * Called between iterations of the inner tool-calling loop. If it
   * returns messages, the loop injects them as user-role messages into
   * the current conversation and continues. Used to let the user (or
   * another agent) inject new instructions WHILE the loop is running
   * without aborting the current turn.
   *
   * The hook is invoked BEFORE each provider.chat() call. Return [] (or
   * undefined) to indicate no steering is pending.
   */
  getSteeringMessages?: () => ChatMessage[]
  /**
   * Follow-up messages (借鉴 openclaw agent-loop.ts:376-382).
   *
   * Called after the tool-calling loop naturally exits (no more tool
   * calls). If it returns messages, the loop performs another full turn
   * with those messages injected at the end of the conversation. Used
   * to let the user queue up follow-up work AFTER the agent stops.
   *
   * Invoked at most once per `runToolLoop` call (after the inner loop
   * exits and before the final response is returned).
   */
  getFollowUpMessages?: () => ChatMessage[]
  /**
   * Per-turn preparation hook (借鉴 openclaw prepareNextTurn).
   *
   * Called before each `provider.chat()` call. Used by callers to push
   * state, clear queues, or stage data. The hook receives no arguments;
   * callers must close over any context they need.
   */
  prepareNextTurn?: () => void
  /**
   * Explicit stop hook (借鉴 openclaw shouldStopAfterTurn).
   *
   * Called after each tool-calling iteration. If it returns true, the
   * loop exits early with the current accumulated state. Used by the
   * caller to enforce external stop signals (e.g. user abort, deadline).
   */
  shouldStopAfterTurn?: () => boolean
  /**
   * Owned files for the current task (借鉴 parallel-feature-development).
   * When set, file-write tools (write, edit) are gated to only allow
   * writes within these directories/files. Writes outside are rejected
   * with an error.
   */
  ownedFiles?: string[]
  /**
   * Tool execution mode (借鉴 pi).
   * - "sequential": each tool call is prepared, executed, and finalized before the next one starts.
   * - "parallel": tool calls are prepared sequentially, then allowed tools execute concurrently.
   *   `tool_execution_end` is emitted in tool completion order after each tool is finalized,
   *   while tool-result message artifacts are emitted later in assistant source order.
   * Default: "sequential" (preserves existing behavior).
   */
  toolExecution?: ToolExecutionMode
  /**
   * Called after each tool-calling iteration completes (minimax-code
   * Extension SPI borrowing). Return a short strategy reminder string to
   * inject it as a user message on the next round (the seam the
   * runaway-guard extension uses); return undefined to observe only.
   */
  onStepEnd?: (
    round: number,
    info: { toolCalls: number; stopReason?: string },
  ) => string | undefined
  /**
   * Called before a tool is executed, after arguments have been validated (借鉴 pi).
   *
   * Return `{ block: true }` to prevent execution. The loop emits an error
   * tool result instead. A blocked result can also set `terminate: true` to
   * participate in the batch early-termination rule.
   */
  beforeToolCall?: (context: BeforeToolCallContext) => BeforeToolCallResult | undefined
  /**
   * Called after a tool finishes executing, before `tool_execution_end` is emitted (借鉴 pi).
   *
   * Return an `AfterToolCallResult` to override parts of the executed tool result:
   * - `content` replaces the full content array
   * - `details` replaces the full details payload
   * - `isError` replaces the error flag
   * - `usage` replaces the tool result usage
   * - `terminate` replaces the early-termination hint
   *
   * Any omitted fields keep their original values.
   */
  afterToolCall?: (
    context: AfterToolCallContext,
  ) => AfterToolCallResult | undefined | Promise<AfterToolCallResult | undefined>
  /**
   * Context-overflow recovery hook (minimax 5b4e0a4 borrowing).
   *
   * When the provider rejects a request as too large
   * (`isLLMRequestOversized`: HTTP 413, `request_too_large`, context-window
   * overflow) BEFORE producing any output, the loop calls this hook once per
   * `runToolLoop` with the exact messages that were rejected. The hook
   * force-compacts and PERSISTS the replacement, then the loop resends the
   * request through the SAME provider.chat call site — the normal before-LLM
   * pipeline (tool instructions, role merging, per-request transforms) is
   * therefore reapplied to the resent request, never bypassed. A second
   * rejection is terminal: the original provider error is rethrown.
   *
   * Return undefined (or throw) when the hook cannot change anything — the
   * loop then surfaces the provider rejection as received. Only compaction
   * belongs here: reminder/append hooks would run twice (once in the normal
   * pipeline, once in recovery) — use `SingleOwnerInjectionGate` to keep
   * single ownership if a reminder must participate.
   */
  contextOverflowRecovery?: (rejected: ChatMessage[]) => Promise<ChatMessage[] | undefined>
  /**
   * Environment snapshot provider (deepseek chat-demo latestReminder
   * borrowing — env-anchor injection).
   *
   * Recomputed before each LLM call. The returned snapshot is dedup-gated:
   * an anchor message is pushed into the live conversation ONLY when the
   * snapshot first appears or its content changed (see
   * `shouldInjectAnchor` in context-anchor.ts) — long loops that cross a
   * day boundary or switch models refresh their anchor automatically,
   * short loops pay nothing after the first round.
   *
   * When omitted (default) no anchor is injected. The runtime wires
   * `defaultEnvSnapshotProvider` from context-anchor.ts.
   */
  envSnapshot?: () => string
  /**
   * (borrowing; Mini-Agent agent.py:201-319) Proactive compaction: BEFORE
   * every LLM send the loop checks BOTH signals — the injected local
   * estimate over the live history AND the last API-reported request
   * total (from the previous response's usage, already in hand) — and
   * either one exceeding `tokenLimit` compacts once, then one-shot
   * debounces the NEXT check (the reported total is stale until the
   * post-compaction response arrives; Mini-Agent _skip_next_token_check).
   *
   * With a `summarizer`, compaction keeps the system head and every real
   * user message and summarizes each user→user execution segment per
   * turn (see compaction.ts summarizePerTurn); a failing summarizer
   * degrades that segment to its raw concatenated text. Without one, the
   * existing truncation compaction applies.
   *
   * Independent of `contextOverflowRecovery`: the passive path keeps its
   * exactly-once-per-run semantics; the proactive path has its own
   * trigger and its own count.
   */
  proactiveCompaction?: {
    /** Either signal above this total triggers compaction before the next send. */
    tokenLimit: number
    /** Injected local token estimator over the current request history. */
    estimateTokens: (messages: readonly ChatMessage[]) => number
    /** Injected per-turn summarizer; omit to keep the truncation compaction. */
    summarizer?: CompactionSummarizer
  }
}

/** Tools that write files and are subject to ownedFiles gating. */
const FILE_WRITE_TOOLS = new Set(["write", "edit"])

/**
 * Structured error for tool calls that were announced by the model but never
 * executed (opencode failUnsettledTools "uncalled" borrowing): streaming
 * parse/budget truncation leaves calls without an execution event. They are
 * settled with this error instead of dangling unanswered into the next
 * round's context.
 */
export const UNCALLED_TOOL_CALL_ERROR =
  "Tool call arguments were not completed and were not executed. Re-issue the tool call with complete arguments."

/**
 * Settle every announced-but-never-executed tool call with a structured
 * error result (opencode INPUT_INCOMPLETE borrowing). The assistant message
 * already contains the tool-call text, so leaving them unanswered would
 * dangle into the next round's context; a settled error tells the model to
 * re-issue the call with complete arguments.
 */
function settleUncalledToolCalls(
  uncalled: readonly ToolCall[],
  currentMessages: ChatMessage[],
  options: ChatOptions & ToolLoopOptions,
  allToolCalls: ToolCall[],
): void {
  for (const call of uncalled) {
    options.emitEvent?.({
      type: "tool-end",
      workspaceId: options.workspaceId ?? "",
      taskId: options.taskId ?? "",
      toolName: call.name,
      ok: false,
      durationMs: 0,
      error: UNCALLED_TOOL_CALL_ERROR,
    })
    options.onToolResult?.(call, { error: UNCALLED_TOOL_CALL_ERROR })
    currentMessages.push({
      role: "user",
      content: `[Tool Result: ${call.name}]\n${JSON.stringify({ error: UNCALLED_TOOL_CALL_ERROR })}`,
    })
    allToolCalls.push(call)
  }
}

// ── Tool Execution Helpers (借鉴 pi) ──

/**
 * Execute tool calls sequentially (借鉴 pi).
 * Each tool is prepared, executed, and finalized before the next one starts.
 * Calls that could not be attempted (budget exhausted mid-round) are
 * returned as unsettled so the loop can settle them with a structured error.
 */
async function executeToolCallsSequential(
  provider: ToolEnabledProvider,
  currentMessages: ChatMessage[],
  toolCalls: ToolCall[],
  options: ChatOptions & ToolLoopOptions,
  round: number,
  allToolCalls: ToolCall[],
  toolBudget: { value: number },
): Promise<ToolCall[]> {
  const unsettled: ToolCall[] = []
  for (const call of toolCalls) {
    if (toolBudget.value <= 0) {
      unsettled.push(call)
      continue
    }
    toolBudget.value--
    const result = await executeSingleToolCall(provider, call, options, round)
    if (result.skip) continue
    currentMessages.push({
      role: "user",
      content: `[Tool Result: ${call.name}]\n${JSON.stringify(result.output, null, 2)}`,
    })
    allToolCalls.push(call)
  }
  return unsettled
}

/**
 * Execute tool calls in parallel (借鉴 pi).
 * Tools are prepared sequentially, then allowed tools execute concurrently.
 * tool_execution_end is emitted in completion order, but tool-result messages
 * are emitted in assistant source order. Calls beyond the budget slice are
 * returned as unsettled so the loop can settle them with a structured error.
 */
async function executeToolCallsParallel(
  provider: ToolEnabledProvider,
  currentMessages: ChatMessage[],
  toolCalls: ToolCall[],
  options: ChatOptions & ToolLoopOptions,
  round: number,
  allToolCalls: ToolCall[],
  toolBudget: { value: number },
): Promise<ToolCall[]> {
  const results: Array<{ call: ToolCall; output: unknown; skip: boolean }> = []

  for (const call of toolCalls) {
    if (toolBudget.value <= 0) break
    toolBudget.value--
  }
  const admitted = (options.maxToolCalls ?? 30) - toolBudget.value

  // Execute all tools concurrently
  const executions = toolCalls
    .slice(0, admitted)
    .map((call) => executeSingleToolCall(provider, call, options, round))
  const settled = await Promise.allSettled(executions)

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i]
    const call = toolCalls[i]
    if (outcome.status === "rejected") {
      results.push({ call, output: { error: String(outcome.reason) }, skip: false })
    } else {
      results.push({ call, output: outcome.value.output, skip: outcome.value.skip })
    }
  }

  // Emit tool results in assistant source order
  for (const { call, output, skip } of results) {
    if (skip) continue
    currentMessages.push({
      role: "user",
      content: `[Tool Result: ${call.name}]\n${JSON.stringify(output, null, 2)}`,
    })
    allToolCalls.push(call)
  }

  // Calls beyond the executed slice were never attempted — the caller
  // settles them with a structured error instead of leaving them dangling.
  return toolCalls.slice(admitted)
}

/**
 * Execute a single tool call with before/after hooks (借鉴 pi).
 * Returns the result output and whether the call was skipped/blocked.
 */
async function executeSingleToolCall(
  provider: ToolEnabledProvider,
  call: ToolCall,
  options: ChatOptions & ToolLoopOptions,
  round: number,
): Promise<{ output: unknown; skip: boolean }> {
  const startedAt = Date.now()

  // beforeToolCall hook (借鉴 pi)
  if (options.beforeToolCall) {
    const beforeResult = options.beforeToolCall({
      assistantMessage: {},
      toolCall: call,
      args: call.input,
      context: {},
    })
    if (beforeResult?.block) {
      const reason = beforeResult.reason ?? "Tool execution was blocked"
      options.emitEvent?.({
        type: "tool-end",
        workspaceId: options.workspaceId ?? "",
        taskId: options.taskId ?? "",
        toolName: call.name,
        ok: false,
        durationMs: Date.now() - startedAt,
        error: reason,
      })
      options.onToolResult?.(call, { error: reason })
      if (beforeResult.terminate) {
        return { output: { error: reason }, skip: true }
      }
      return { output: { error: reason }, skip: false }
    }
  }

  options.onToolCall?.(call)
  options.emitEvent?.({
    type: "tool-start",
    workspaceId: options.workspaceId ?? "",
    taskId: options.taskId ?? "",
    toolName: call.name,
    input: call.input,
  })

  let ok = true
  let errorMessage: string | undefined
  let result: Awaited<ReturnType<typeof provider.executeTool>> | undefined

  // Tool cache lookup (借鉴 crewAI)
  let cacheHit = false
  if (options.toolCache) {
    const cacheKey = `${call.name}|${stableStringify(call.input)}`
    const cached = options.toolCache.get(cacheKey)
    if (cached !== undefined) {
      result = { result: cached } as typeof result
      cacheHit = true
    }
  }

  try {
    // ownedFiles permission gate
    if (options.ownedFiles && options.ownedFiles.length > 0 && FILE_WRITE_TOOLS.has(call.name)) {
      const input = call.input as Record<string, unknown>
      const filePath = typeof input?.path === "string" ? input.path : undefined
      if (filePath) {
        const isOwned = options.ownedFiles.some((prefix) => filePath.startsWith(prefix))
        if (!isOwned) {
          throw new Error(
            `File "${filePath}" is not in task's ownedFiles: [${options.ownedFiles.join(", ")}]`,
          )
        }
      }
    }
    if (!cacheHit) {
      result = await provider.executeTool(call, {
        sessionID: "default",
        agent: "agent",
        assistantMessageID: `msg-${round}`,
      })
    }
  } catch (err) {
    // Explicit deny (with-permission "deny" decision): surface as a tool
    // error so the LLM can adapt — same contract as a user "deny" answer.
    // Before the permission system was wired into the loop this path was
    // unreachable and a deny crashed the whole runToolLoop.
    if (isPermissionDeniedError(err)) {
      const denyMsg = err.message
      options.emitEvent?.({
        type: "tool-end",
        workspaceId: options.workspaceId ?? "",
        taskId: options.taskId ?? "",
        toolName: call.name,
        ok: false,
        durationMs: Date.now() - startedAt,
        error: denyMsg,
      })
      options.onToolResult?.(call, { error: denyMsg })
      return { output: { error: denyMsg }, skip: false }
    }
    if (isPermissionRequestError(err) && options.awaitPermission) {
      const reqErr = err
      options.emitEvent?.({
        type: "permission-request",
        workspaceId: options.workspaceId ?? "",
        taskId: options.taskId ?? "",
        requestId: reqErr.requestId,
        tool: reqErr.tool,
        target: reqErr.target,
        // Raw tool call input — the dashboard's approval card renders it as
        // an embedded diff for edit/write calls (opencode borrowing).
        input: call.input,
      })
      const decision = await options.awaitPermission(reqErr.requestId, {
        workspaceId: options.workspaceId ?? "",
        taskId: options.taskId ?? "",
        tool: reqErr.tool,
        target: reqErr.target,
      })
      // "deny" surfaces a tool error so the LLM can adapt (per the
      // awaitPermission contract) — re-executing would throw
      // PermissionDeniedError and kill the whole loop in sequential mode.
      if (decision === "deny") {
        const denyMsg = `Permission denied for tool "${reqErr.tool}"`
        // (no `ok`/`errorMessage` bookkeeping needed: we return below, and
        // both flags are only consumed on the paths after this branch)
        options.emitEvent?.({
          type: "tool-end",
          workspaceId: options.workspaceId ?? "",
          taskId: options.taskId ?? "",
          toolName: call.name,
          ok: false,
          durationMs: Date.now() - startedAt,
          error: denyMsg,
        })
        options.onToolResult?.(call, { error: denyMsg })
        return { output: { error: denyMsg }, skip: false }
      }
      result = await provider.executeTool(call, {
        sessionID: "default",
        agent: "agent",
        assistantMessageID: `msg-${round}`,
      })
    } else {
      ok = false
      errorMessage = err instanceof Error ? err.message : String(err)
      options.emitEvent?.({
        type: "tool-end",
        workspaceId: options.workspaceId ?? "",
        taskId: options.taskId ?? "",
        toolName: call.name,
        ok: false,
        durationMs: Date.now() - startedAt,
        error: errorMessage,
      })
      throw err
    }
  }

  // Cache write
  if (ok && result && options.toolCache) {
    const cacheKey = `${call.name}|${stableStringify(call.input)}`
    options.toolCache.set(cacheKey, result.result)
  }

  if (!result) {
    return { output: { error: "No result" }, skip: false }
  }

  let output = result.output?.structured ?? result.result

  // afterToolCall hook (借鉴 pi)
  if (options.afterToolCall) {
    // Awaiting sync-or-async results lets extension transformers do IO
    // (the tool-output-budget extension externalizes oversized outputs to
    // a file artifact).
    const afterResult = await options.afterToolCall({
      assistantMessage: {},
      toolCall: call,
      args: call.input,
      result,
      isError: !ok,
      context: {},
    })
    if (afterResult) {
      output = afterResult.content ?? output
    }
  }

  options.onToolResult?.(call, output)
  options.emitEvent?.({
    type: "tool-end",
    workspaceId: options.workspaceId ?? "",
    taskId: options.taskId ?? "",
    toolName: call.name,
    ok: true,
    durationMs: Date.now() - startedAt,
  })

  return { output, skip: false }
}

/**
 * Run a tool execution loop: send messages, execute tool calls, repeat.
 * This is the core agentic loop pattern.
 *
 * `proactiveCompactions` counts the proactive dual-signal compactions
 * performed before sends (borrowing; Mini-Agent agent.py:201-319) — 0
 * when `options.proactiveCompaction` is not configured.
 */
export async function runToolLoop(
  provider: ToolEnabledProvider,
  messages: ChatMessage[],
  options: ChatOptions & ToolLoopOptions = {},
): Promise<{
  response: ToolEnabledResponse
  allToolCalls: ToolCall[]
  proactiveCompactions: number
}> {
  const maxRounds = options.maxRounds ?? 10
  const maxToolCalls = options.maxToolCalls ?? 30
  const refundOnProgress = options.refundOnProgress ?? false
  const allToolCalls: ToolCall[] = []
  const toolBudget = { value: maxToolCalls }
  const currentMessages = [...messages]

  // Context-overflow recovery (minimax 5b4e0a4 borrowing): the rejected
  // request may be force-compacted and resent EXACTLY ONCE per run, through
  // this same provider.chat call site so every request-level transform in
  // the normal before-LLM pipeline is reapplied. A second rejection is final.
  let overflowRecoveryAttempted = false

  // ── Proactive compaction (borrowing; Mini-Agent agent.py:82-84, 193-257) ──
  // Own trigger, own count — separate from the passive overflow-recovery
  // attempt flag above (whose exactly-once-per-run semantics are untouched).
  let skipNextTokenCheck = false
  let lastReportedTotalTokens = 0
  let proactiveCompactions = 0

  /** Double-signal check + one-shot compaction before every LLM send. */
  async function proactiveCompactBeforeSend(): Promise<void> {
    const pc = options.proactiveCompaction
    if (!pc) return
    // One-shot debounce (Mini-Agent _skip_next_token_check): after a
    // compaction the reported total still reflects the PRE-compaction
    // request, so exactly one check is skipped while the next response
    // refreshes it.
    if (skipNextTokenCheck) {
      skipNextTokenCheck = false
      return
    }
    const estimated = pc.estimateTokens(currentMessages)
    if (estimated <= pc.tokenLimit && lastReportedTotalTokens <= pc.tokenLimit) return
    const compacted = await compactProactiveHistory(currentMessages, {
      tokenLimit: pc.tokenLimit,
      estimateTokens: pc.estimateTokens,
      ...(pc.summarizer ? { summarizer: pc.summarizer } : {}),
    })
    // Persist the compaction in the loop's live history (in place, so
    // every later round observes it).
    currentMessages.length = 0
    currentMessages.push(...compacted)
    proactiveCompactions++
    skipNextTokenCheck = true
  }

  async function chatWithOverflowRecovery(): Promise<ToolEnabledResponse> {
    // Proactive dual-signal check before EVERY send (Mini-Agent runs its
    // summary check before each step's request).
    await proactiveCompactBeforeSend()
    try {
      const response = await provider.chat(currentMessages, options)
      // API-reported signal (Mini-Agent api_total_tokens): refreshed per
      // response; the next round's check reads the fresh total.
      if (response.usage) {
        lastReportedTotalTokens =
          response.usage.totalTokens ??
          response.usage.promptTokens + response.usage.completionTokens
      }
      return response
    } catch (err) {
      if (
        !options.contextOverflowRecovery ||
        overflowRecoveryAttempted ||
        !isLLMRequestOversized(err)
      ) {
        throw err
      }
      overflowRecoveryAttempted = true
      let compacted: ChatMessage[] | undefined
      try {
        compacted = await options.contextOverflowRecovery(currentMessages)
      } catch {
        // A failing recovery must not mask the provider rejection it tried
        // to fix — surface the original rejection.
        throw err
      }
      if (!compacted || compacted === currentMessages) throw err
      // Persist the compaction in the loop's live history (in place, so
      // every later round and the resend observe it).
      currentMessages.length = 0
      currentMessages.push(...compacted)
      // Resend exactly once — through the same call site (normal pipeline).
      const resent = await provider.chat(currentMessages, options)
      if (resent.usage) {
        lastReportedTotalTokens =
          resent.usage.totalTokens ?? resent.usage.promptTokens + resent.usage.completionTokens
      }
      return resent
    }
  }

  // Env-anchor injection (deepseek chat-demo latestReminder borrowing):
  // recomputed before EVERY LLM call; the snapshot is dedup-gated
  // (shouldInjectAnchor — chat-demo appendReminder semantics) so an
  // unchanged snapshot is never re-sent. A loop that crosses a day
  // boundary or switches models gets exactly one fresh anchor message;
  // without an envSnapshot provider nothing is injected.
  let lastEnvSnapshot: string | undefined
  const injectEnvAnchor = (): void => {
    if (!options.envSnapshot) return
    const snapshot = options.envSnapshot()
    if (!shouldInjectAnchor(lastEnvSnapshot, snapshot)) return
    lastEnvSnapshot = snapshot
    currentMessages.push({ role: "user", content: formatAnchorMessage(snapshot) })
  }

  // Refusal settlement for the exit-path responses (explicit-stop call and
  // the post-rounds final call) — those bypass the per-round refusal gate
  // below, so settle them here the same way (deepseek chat-demo reply.ts
  // settleReply borrowing).
  const settleIfRefused = (response: ToolEnabledResponse): ToolEnabledResponse =>
    isRefusalFinish(response.stopReason) ? settleRefusal(response) : response

  for (let round = 0; round < maxRounds; round++) {
    // Steering injection (借鉴 openclaw): if external messages are pending,
    // inject them BEFORE the next provider.chat() so the LLM sees them.
    if (options.getSteeringMessages) {
      const steering = options.getSteeringMessages()
      if (steering && steering.length > 0) {
        currentMessages.push(...steering)
      }
    }
    // Per-turn prep hook (借鉴 openclaw prepareNextTurn).
    options.prepareNextTurn?.()
    // Explicit stop hook (借鉴 openclaw shouldStopAfterTurn).
    if (options.shouldStopAfterTurn?.()) {
      injectEnvAnchor()
      const finalResponse = await chatWithOverflowRecovery()
      return { response: settleIfRefused(finalResponse), allToolCalls, proactiveCompactions }
    }

    injectEnvAnchor()
    const response = await chatWithOverflowRecovery()

    // Refusal settlement (deepseek chat-demo reply.ts settleReply borrowing):
    // a refusal is TERMINAL — the partially streamed body is protocol-
    // untrusted, so the loop ends right here: no further tool round, no
    // follow-up injection, no reminder (canContinueAfterRefusal() is false
    // by protocol). The settled response carries refused: true with parsed
    // tool calls cleared; the raw body is preserved for audit.
    if (isRefusalFinish(response.stopReason)) {
      return { response: settleRefusal(response), allToolCalls, proactiveCompactions }
    }

    if (response.toolCalls.length === 0) {
      // Follow-up continuation (pi borrowing): on natural exit with queued
      // follow-ups, push them and RE-ENTER the loop instead of performing a
      // single extra turn — the follow-up response can itself issue tool
      // calls and consume further queued follow-ups, all bounded by the
      // same maxRounds budget.
      if (options.getFollowUpMessages) {
        const followUps = options.getFollowUpMessages()
        if (followUps && followUps.length > 0) {
          currentMessages.push({ role: "assistant", content: response.content }, ...followUps)
          continue
        }
      }
      return { response, allToolCalls, proactiveCompactions }
    }

    // Check budget before executing tool calls
    const droppedByTruncation: ToolCall[] = []
    if (response.toolCalls.length > toolBudget.value) {
      // Truncate to remaining budget; the overflow is settled below.
      droppedByTruncation.push(...response.toolCalls.splice(Math.max(0, toolBudget.value)))
    }
    if (toolBudget.value <= 0) {
      settleUncalledToolCalls(droppedByTruncation, currentMessages, options, allToolCalls)
      return { response, allToolCalls, proactiveCompactions }
    }

    // Execute tool calls
    // Add assistant message once before processing tool calls
    currentMessages.push({
      role: "assistant",
      content: response.content,
    })

    // Truncated message safety (借鉴 pi): when stopReason === "length", the
    // output was cut off by the token limit so every tool call in the
    // message may carry truncated arguments. Fail them all instead of
    // executing potentially incomplete calls.
    if (response.stopReason === "length") {
      for (const call of response.toolCalls) {
        const errorMsg = `Tool call "${call.name}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.`
        options.emitEvent?.({
          type: "tool-end",
          workspaceId: options.workspaceId ?? "",
          taskId: options.taskId ?? "",
          toolName: call.name,
          ok: false,
          durationMs: 0,
          error: errorMsg,
        })
        currentMessages.push({
          role: "user",
          content: `[Tool Result: ${call.name}]\n${JSON.stringify({ error: errorMsg })}`,
        })
        allToolCalls.push(call)
      }
    } else {
      // Determine execution mode
      const execMode: ToolExecutionMode = options.toolExecution ?? "sequential"

      const unsettled =
        execMode === "parallel"
          ? await executeToolCallsParallel(
              provider,
              currentMessages,
              response.toolCalls,
              options,
              round,
              allToolCalls,
              toolBudget,
            )
          : await executeToolCallsSequential(
              provider,
              currentMessages,
              response.toolCalls,
              options,
              round,
              allToolCalls,
              toolBudget,
            )
      // Announced but never attempted (budget truncation or mid-round
      // budget exhaustion): settle with a structured error instead of
      // dangling into the next round.
      settleUncalledToolCalls(
        [...droppedByTruncation, ...unsettled],
        currentMessages,
        options,
        allToolCalls,
      )
    }

    // Refund one tool call if the LLM made progress (hermes-agent pattern)
    if (refundOnProgress && response.toolCalls.length > 0 && toolBudget.value < maxToolCalls) {
      toolBudget.value = Math.min(toolBudget.value + 1, maxToolCalls)
    }

    // Step-end hook (minimax-code Extension SPI, minimal form): observers can
    // detect runaway/looping behaviour and return a strategy reminder that is
    // injected as a user message on the next round — the same seam mcode's
    // runaway-guard extension uses for `agent.steer()`.
    if (options.onStepEnd) {
      const reminder = options.onStepEnd(round, {
        toolCalls: response.toolCalls.length,
        stopReason: response.stopReason,
      })
      if (reminder) {
        currentMessages.push({ role: "user", content: reminder })
      }
    }
  }

  // If we exhausted rounds, return the last response
  injectEnvAnchor()
  const finalResponse = await chatWithOverflowRecovery()

  // Refusal settlement (deepseek chat-demo reply.ts borrowing): a refused
  // post-rounds response is terminal — settle it and return without any
  // follow-up injection (canContinueAfterRefusal() is false by protocol).
  if (isRefusalFinish(finalResponse.stopReason)) {
    return { response: settleRefusal(finalResponse), allToolCalls, proactiveCompactions }
  }

  // Follow-up injection (借鉴 openclaw): if external follow-up messages
  // are pending, do ONE more full turn with them appended. Bounded to a
  // single follow-up so a chatty caller can't loop forever — if more
  // messages accumulate during this turn, they wait for the next call.
  if (options.getFollowUpMessages) {
    const followUps = options.getFollowUpMessages()
    if (followUps && followUps.length > 0) {
      // Continuation gate (deepseek chat-demo reply.ts canContinueReply
      // borrowing): the previous turn becomes the assistant prefix of the
      // follow-up request. A turn whose tool calls were announced but never
      // executed (rounds budget exhausted) is disqualified — exactly like
      // chat-demo's tool_use replies — and an empty body has nothing to
      // append (isUsableReply borrowing).
      const followUpMessages: ChatMessage[] = [...currentMessages]
      if (
        canContinueAsPrefix({
          stopReason: finalResponse.stopReason,
          unsettledToolCalls: finalResponse.toolCalls.length,
          content: finalResponse.content,
        })
      ) {
        followUpMessages.push({ role: "assistant", content: finalResponse.content })
      }
      followUpMessages.push(...followUps)
      const followUpResponse = await provider.chat(followUpMessages, options)
      return { response: followUpResponse, allToolCalls, proactiveCompactions }
    }
  }

  return { response: finalResponse, allToolCalls, proactiveCompactions }
}

// ── Registry Factory ──

/** Create a tool registry with all built-in tools registered. */
export async function createDefaultToolRegistry(): Promise<ToolRegistry> {
  const { BUILTIN_TOOLS } = await import("@max/tools")
  const registry = createToolRegistry()
  registry.register(BUILTIN_TOOLS)
  return registry
}

/**
 * Shared registry promise so every agent in a process reuses one registry
 * (it is stateless per `materialize()` call, so sharing is safe) instead of
 * re-importing the builtin tools per agent.
 */
let sharedRegistryPromise: Promise<ToolRegistry> | undefined
export function getSharedToolRegistry(): Promise<ToolRegistry> {
  sharedRegistryPromise ??= createDefaultToolRegistry()
  return sharedRegistryPromise
}

/**
 * Create the production tool registry: built-in tools gated by the
 * permission system (permission.ts defaults: read/glob/grep allow with
 * secret-path deny patterns; bash/write/edit ask). The permission config
 * is re-read per settle so `PUT /api/permissions` changes apply without a
 * restart.
 */
export async function createPermissionedToolRegistry(): Promise<ToolRegistry> {
  const { withPermission, DEFAULT_PERMISSIONS } = await import("@max/tools")
  const inner = await createDefaultToolRegistry()
  const innerMaterialize = inner.materialize.bind(inner)
  return {
    register: inner.register.bind(inner),
    unregister: inner.unregister.bind(inner),
    has: inner.has.bind(inner),
    get: inner.get.bind(inner),
    list: inner.list.bind(inner),
    materialize(): Materialization {
      return withPermission(innerMaterialize(), async () => {
        try {
          const { loadPermissions } = await import("@max/tools")
          return await loadPermissions()
        } catch {
          return DEFAULT_PERMISSIONS
        }
      })
    },
  }
}

/** Create a tool-enabled provider from a base provider. */
export async function createToolEnabledProvider(provider: Provider): Promise<ToolEnabledProvider> {
  const registry = await getSharedToolRegistry()
  return new ToolEnabledProvider(provider, registry)
}

/**
 * Create a tool-enabled provider backed by the PERMISSION-GATED registry —
 * the production path (bash/write/edit prompt the human; secret paths are
 * denied outright). Tests that exercise tools without a permission layer
 * should use {@link createToolEnabledProvider} instead.
 */
export async function createPermissionedToolProvider(
  provider: Provider,
): Promise<ToolEnabledProvider> {
  const registry = await createPermissionedToolRegistry()
  return new ToolEnabledProvider(provider, registry)
}

// ── Helpers ──

/** Levenshtein distance between two strings. */
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i]![0] = i
  for (let j = 0; j <= n; j++) dp[0]![j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!)
    }
  }
  return dp[m]![n]!
}

/**
 * Deterministic JSON.stringify — sorts object keys so that
 * `{a: 1, b: 2}` and `{b: 2, a: 1}` produce the same string. Used as
 * the tool-cache key suffix so two semantically identical inputs map to
 * the same cache entry regardless of key order.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]"
  }
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  )
}
