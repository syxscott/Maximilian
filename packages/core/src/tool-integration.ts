// Tool integration — bridges @max/tools with AgentRuntime
// Adds tool execution capability to agents without modifying the base Agent class

import type { AnyTool, ToolDefinition } from "@max/llm"
import { createToolRegistry, type ToolRegistry, type ExecuteInput, isPermissionRequestError } from "@max/tools"
import type { Provider, ChatMessage, ChatOptions } from "@max/providers"
import type { AgentContext, Agent } from "./agent.js"

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
}

export interface ToolEnabledResponse {
  content: string
  toolCalls: ToolCall[]
  model: string
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

  constructor(
    private provider: Provider,
    private registry: ToolRegistry,
  ) {}

  /** Get tool definitions for the current scope. */
  getToolDefinitions(): ToolDefinition[] {
    return this.registry.materialize().definitions
  }

  /** Execute a tool call through the registry. */
  async executeTool(
    call: ToolCall,
    context: { sessionID: string; agent: string; assistantMessageID: string },
  ): Promise<{ result: unknown; output?: { structured: unknown; content: ReadonlyArray<{ type: string; text?: string }> } }> {
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
      output: settlement.output ? {
        structured: settlement.output.structured,
        content: settlement.output.content.map(c => ({ type: c.type, text: "text" in c ? c.text : undefined })),
      } : undefined,
    }
  }

  /** Chat with tool definitions included. */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ToolEnabledResponse> {
    // Inject tool definitions into the system message
    const toolDefs = this.getToolDefinitions()
    const toolInstructions = toolDefs.length > 0
      ? `\n\nYou have access to the following tools:\n${toolDefs.map((t) => `- ${t.name}: ${t.description}`).join("\n")}\n\nTo use a tool, respond with a JSON block:\n\`\`\`tool\n{"name": "tool-name", "input": {...}}\n\`\`\``
      : ""

    const enhancedMessages = messages.map((m, i) =>
      i === 0 && m.role === "system"
        ? { ...m, content: m.content + toolInstructions }
        : m,
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
    } catch { /* fall through */ }

    // Repair attempt 1: remove trailing commas
    try {
      const cleaned = raw.replace(/,\s*([}\]])/g, "$1")
      return JSON.parse(cleaned)
    } catch { /* fall through */ }

    // Repair attempt 2: fix single quotes → double quotes
    // Only when the input doesn't already contain double quotes (avoids
    // corrupting strings like "it's a test").
    try {
      if (!raw.includes('"')) {
        const cleaned = raw.replace(/'/g, '"')
        return JSON.parse(cleaned)
      }
    } catch { /* fall through */ }

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
    } catch { /* give up */ }

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

  get id(): string { return this.provider.id }
  get name(): string { return this.provider.name }
  get defaultModel(): string { return this.provider.defaultModel }
  isConfigured(): boolean { return this.provider.isConfigured() }
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
  let toolBudget = maxToolCalls
  let currentMessages = [...messages]

  for (let round = 0; round < maxRounds; round++) {
    const response = await provider.chat(currentMessages, options)

    if (response.toolCalls.length === 0) {
      return { response, allToolCalls }
    }

    // Check budget before executing tool calls
    if (response.toolCalls.length > toolBudget) {
      // Truncate to remaining budget
      response.toolCalls.length = toolBudget
    }
    if (toolBudget <= 0) {
      return { response, allToolCalls }
    }

    // Execute tool calls
    // Add assistant message once before processing tool calls
    currentMessages.push({
      role: "assistant",
      content: response.content,
    })
    for (const call of response.toolCalls) {
      if (toolBudget <= 0) break
      toolBudget--

      options.onToolCall?.(call)
      if (options.emitEvent && options.workspaceId && options.taskId) {
        options.emitEvent({
          type: "tool-start",
          workspaceId: options.workspaceId,
          taskId: options.taskId,
          toolName: call.name,
          input: call.input,
        })
      }

      const startedAt = Date.now()
      let ok = true
      let errorMessage: string | undefined
      let result: Awaited<ReturnType<typeof provider.executeTool>>
      try {
        result = await provider.executeTool(call, {
          sessionID: "default",
          agent: "agent",
          assistantMessageID: `msg-${round}`,
        })
      } catch (err) {
        // Permission gate: the user (or default policy) said "ask". Park the
        // call until the runtime's awaitPermission promise resolves. If no
        // awaitPermission is provided, treat it as a deny to keep the loop
        // bounded.
        if (isPermissionRequestError(err) && options.awaitPermission) {
          const reqErr = err
          options.emitEvent?.({
            type: "permission-request",
            workspaceId: options.workspaceId ?? "",
            taskId: options.taskId ?? "",
            requestId: reqErr.requestId,
            tool: reqErr.tool,
            target: reqErr.target,
          })
          const decision = await options.awaitPermission(reqErr.requestId, {
            workspaceId: options.workspaceId ?? "",
            taskId: options.taskId ?? "",
            tool: reqErr.tool,
            target: reqErr.target,
          })
          if (decision === "deny") {
            // Re-run through the gate once with the user's "deny" intent. The
            // PermissionDeniedError will surface here, fall through to the
            // generic catch and be reported as a tool error so the LLM sees
            // the message in its tool-result stream.
            result = await provider.executeTool(call, {
              sessionID: "default",
              agent: "agent",
              assistantMessageID: `msg-${round}`,
            })
          } else {
            // Re-execute with the new (presumably allow) config.
            result = await provider.executeTool(call, {
              sessionID: "default",
              agent: "agent",
              assistantMessageID: `msg-${round}`,
            })
          }
        } else {
          ok = false
          errorMessage = err instanceof Error ? err.message : String(err)
          if (options.emitEvent && options.workspaceId && options.taskId) {
            options.emitEvent({
              type: "tool-end",
              workspaceId: options.workspaceId,
              taskId: options.taskId,
              toolName: call.name,
              ok: false,
              durationMs: Date.now() - startedAt,
              error: errorMessage,
            })
          }
          throw err
        }
      }

      options.onToolResult?.(call, result.result)
      allToolCalls.push(call)

      if (options.emitEvent && options.workspaceId && options.taskId) {
        options.emitEvent({
          type: "tool-end",
          workspaceId: options.workspaceId,
          taskId: options.taskId,
          toolName: call.name,
          ok: true,
          durationMs: Date.now() - startedAt,
        })
      }

      // Add tool result to messages
      currentMessages.push({
        role: "user",
        content: `[Tool Result: ${call.name}]\n${JSON.stringify(result.output?.structured ?? result.result, null, 2)}`,
      })
    }

    // Refund one tool call if the LLM made progress (hermes-agent pattern)
    if (refundOnProgress && response.toolCalls.length > 0 && toolBudget < maxToolCalls) {
      toolBudget = Math.min(toolBudget + 1, maxToolCalls)
    }
  }

  // If we exhausted rounds, return the last response
  const finalResponse = await provider.chat(currentMessages, options)
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
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!)
    }
  }
  return dp[m]![n]!
}
