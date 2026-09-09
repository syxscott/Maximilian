// Tool integration — bridges @max/tools with AgentRuntime
// Adds tool execution capability to agents without modifying the base Agent class
// 借鉴 pi: beforeToolCall/afterToolCall hooks, parallel execution, truncated message safety

import type { AnyTool, ToolDefinition } from "@max/llm"
import {
  createToolRegistry,
  type ToolRegistry,
  type ExecuteInput,
  isPermissionRequestError,
} from "@max/tools"
import type { Provider, ChatMessage, ChatOptions } from "@max/providers"
import type { AgentContext, Agent } from "./agent.js"
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

  /** Get tool definitions for the current scope, filtered by allow/deny. */
  getToolDefinitions(): ToolDefinition[] {
    const all = this.registry.materialize().definitions
    if (!this.allowedToolNames && !this.deniedToolNames) return all
    return all.filter((d) => {
      if (this.deniedToolNames?.has(d.name)) return false
      if (this.allowedToolNames && !this.allowedToolNames.has(d.name)) return false
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
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ToolEnabledResponse> {
    // Use cached tool instructions if available
    if (this.toolInstructionsCache === undefined) {
      const toolDefs = this.getToolDefinitions()
      this.toolInstructionsCache =
        toolDefs.length > 0
          ? `\n\nYou have access to the following tools:\n${toolDefs.map((t) => `- ${t.name}: ${t.description}`).join("\n")}\n\nTo use a tool, respond with a JSON block:\n\`\`\`tool\n{"name": "tool-name", "input": {...}}\n\`\`\``
          : ""
    }
    const toolInstructions = this.toolInstructionsCache

    const enhancedMessages = messages.map((m, i) =>
      i === 0 && m.role === "system" ? { ...m, content: m.content + toolInstructions } : m,
    )

    const response = await this.provider.chat(enhancedMessages, options)

    // Parse tool calls from response
    const toolCalls = this.parseToolCalls(response.content)

    return {
      content: response.content,
      toolCalls,
      model: response.model,
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
   * Returns the original name if no close match is found.
   */
  private fuzzyMatchTool(name: string): string {
    const defs = this.getToolDefinitions()
    const known = defs.map((d) => d.name)

    // Exact match
    if (known.includes(name)) return name

    // Case-insensitive match
    const lower = name.toLowerCase()
    const ciMatch = known.find((n) => n.toLowerCase() === lower)
    if (ciMatch) return ciMatch

    // Levenshtein distance ≤ 2
    let bestMatch = name
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
  afterToolCall?: (context: AfterToolCallContext) => AfterToolCallResult | undefined
}

/** Tools that write files and are subject to ownedFiles gating. */
const FILE_WRITE_TOOLS = new Set(["write", "edit"])

// ── Tool Execution Helpers (借鉴 pi) ──

/**
 * Execute tool calls sequentially (借鉴 pi).
 * Each tool is prepared, executed, and finalized before the next one starts.
 */
async function executeToolCallsSequential(
  provider: ToolEnabledProvider,
  currentMessages: ChatMessage[],
  toolCalls: ToolCall[],
  options: ChatOptions & ToolLoopOptions,
  round: number,
  allToolCalls: ToolCall[],
  toolBudget: { value: number },
): Promise<void> {
  for (const call of toolCalls) {
    if (toolBudget.value <= 0) break
    toolBudget.value--
    const result = await executeSingleToolCall(provider, call, options, round)
    if (result.skip) continue
    currentMessages.push({
      role: "user",
      content: `[Tool Result: ${call.name}]\n${JSON.stringify(result.output, null, 2)}`,
    })
    allToolCalls.push(call)
  }
}

/**
 * Execute tool calls in parallel (借鉴 pi).
 * Tools are prepared sequentially, then allowed tools execute concurrently.
 * tool_execution_end is emitted in completion order, but tool-result messages
 * are emitted in assistant source order.
 */
async function executeToolCallsParallel(
  provider: ToolEnabledProvider,
  currentMessages: ChatMessage[],
  toolCalls: ToolCall[],
  options: ChatOptions & ToolLoopOptions,
  round: number,
  allToolCalls: ToolCall[],
  toolBudget: { value: number },
): Promise<void> {
  const results: Array<{ call: ToolCall; output: unknown; skip: boolean }> = []

  for (const call of toolCalls) {
    if (toolBudget.value <= 0) break
    toolBudget.value--
  }

  // Execute all tools concurrently
  const executions = toolCalls
    .slice(0, (options.maxToolCalls ?? 30) - toolBudget.value)
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
    const afterResult = options.afterToolCall({
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
 */
export async function runToolLoop(
  provider: ToolEnabledProvider,
  messages: ChatMessage[],
  options: ChatOptions & ToolLoopOptions = {},
): Promise<{ response: ToolEnabledResponse; allToolCalls: ToolCall[] }> {
  const maxRounds = options.maxRounds ?? 10
  const maxToolCalls = options.maxToolCalls ?? 30
  const refundOnProgress = options.refundOnProgress ?? false
  const allToolCalls: ToolCall[] = []
  const toolBudget = { value: maxToolCalls }
  const currentMessages = [...messages]

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
      const finalResponse = await provider.chat(currentMessages, options)
      return { response: finalResponse, allToolCalls }
    }

    const response = await provider.chat(currentMessages, options)

    if (response.toolCalls.length === 0) {
      // Follow-up injection (借鉴 openclaw): check for follow-up messages
      // even on natural exit, not just after maxRounds exhaustion.
      if (options.getFollowUpMessages) {
        const followUps = options.getFollowUpMessages()
        if (followUps && followUps.length > 0) {
          const followUpMessages = [
            ...currentMessages,
            { role: "assistant" as const, content: response.content },
            ...followUps,
          ]
          const followUpResponse = await provider.chat(followUpMessages, options)
          return { response: followUpResponse, allToolCalls }
        }
      }
      return { response, allToolCalls }
    }

    // Check budget before executing tool calls
    if (response.toolCalls.length > toolBudget.value) {
      // Truncate to remaining budget
      response.toolCalls.length = toolBudget.value
    }
    if (toolBudget.value <= 0) {
      return { response, allToolCalls }
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

      if (execMode === "parallel") {
        await executeToolCallsParallel(
          provider,
          currentMessages,
          response.toolCalls,
          options,
          round,
          allToolCalls,
          toolBudget,
        )
      } else {
        await executeToolCallsSequential(
          provider,
          currentMessages,
          response.toolCalls,
          options,
          round,
          allToolCalls,
          toolBudget,
        )
      }
    }

    // Refund one tool call if the LLM made progress (hermes-agent pattern)
    if (refundOnProgress && response.toolCalls.length > 0 && toolBudget.value < maxToolCalls) {
      toolBudget.value = Math.min(toolBudget.value + 1, maxToolCalls)
    }
  }

  // If we exhausted rounds, return the last response
  const finalResponse = await provider.chat(currentMessages, options)

  // Follow-up injection (借鉴 openclaw): if external follow-up messages
  // are pending, do ONE more full turn with them appended. Bounded to a
  // single follow-up so a chatty caller can't loop forever — if more
  // messages accumulate during this turn, they wait for the next call.
  if (options.getFollowUpMessages) {
    const followUps = options.getFollowUpMessages()
    if (followUps && followUps.length > 0) {
      const followUpMessages = [
        ...currentMessages,
        { role: "assistant" as const, content: finalResponse.content },
        ...followUps,
      ]
      const followUpResponse = await provider.chat(followUpMessages, options)
      return { response: followUpResponse, allToolCalls }
    }
  }

  return { response: finalResponse, allToolCalls }
}

// ── Registry Factory ──

/** Create a tool registry with all built-in tools registered. */
export async function createDefaultToolRegistry(): Promise<ToolRegistry> {
  const { BUILTIN_TOOLS } = await import("@max/tools")
  const registry = createToolRegistry()
  registry.register(BUILTIN_TOOLS)
  return registry
}

/** Create a tool-enabled provider from a base provider. */
export async function createToolEnabledProvider(provider: Provider): Promise<ToolEnabledProvider> {
  const registry = await createDefaultToolRegistry()
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
