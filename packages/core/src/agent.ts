/**
 * Agent — generic execution unit.
 *
 * Every concrete agent (frontend, backend, review) is constructed from a
 * manifest + a provider. They all share this base class so we never write
 * per-agent frameworks.
 */

import { randomUUID } from "node:crypto"
import type { Provider, ChatMessage } from "@max/providers"
import type { AgentInstance, AgentManifest, Result, Task } from "./types.js"

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default maximum short-term memory messages (approximate token budget). */
const DEFAULT_MAX_MEMORY_MESSAGES = 200
/** Default maximum system/memory text length (characters). */
const DEFAULT_MAX_TEXT_LENGTH = 80_000

// ── Types ────────────────────────────────────────────────────────────────────

export interface AgentContext {
  /** Read access to prior results in the same workspace. */
  priorResults: readonly Result[]
  /**
   * Abort signal for the owning workspace. The runtime sets this from the
   * workspace's AbortController so agents can short-circuit long-running
   * LLM calls when the workspace is aborted (user cancel, SIGTERM, etc.).
   * Agents that ignore this will still be unblocked at the runtime level
   * via a Promise.race, but passing it to provider.chat() actually
   * cancels the in-flight HTTP request.
   */
  signal?: AbortSignal
}

export abstract class Agent {
  abstract readonly manifest: AgentManifest

  protected _provider: Provider
  protected memory: ChatMessage[] = []
  /** Long-term memory prelude injected from AgentMemoryStore.toPrelude(). */
  protected memoryPrelude: string = ""
  /** Skills prelude injected when the runtime has a skill source. */
  protected skillsPrelude: string = ""

  /**
   * Per-task model override set by the runtime's ModelRouter. When present,
   * subclasses should prefer this provider+model pair over the default
   * `this._provider` when making LLM calls.
   */
  protected modelOverride?: { provider: string; model: string }

  readonly id: string
  readonly createdAt: string

  /** Expose provider so external callers (e.g. RolePlaying) can send chat messages. */
  get provider(): Provider {
    return this._provider
  }

  constructor(provider: Provider, id?: string) {
    this._provider = provider
    // Use full UUID to avoid collision at scale (birthday problem ~tens of thousands).
    this.id = id ?? `agent-${randomUUID()}`
    this.createdAt = new Date().toISOString()
  }

  /** Set long-term memory prelude (from AgentMemoryStore.toPrelude()). */
  setMemoryPrelude(prelude: string): void {
    this.memoryPrelude = prelude
  }

  /**
   * Set a per-task skills prelude. The runtime calls this with the result
   * of `matchSkillsByTrigger(skills, task.description)` rendered as a
   * short bulleted list, so the agent's system prompt contains a hint
   * about which skills (if any) apply. Empty string clears the prelude.
   */
  setSkillsPrelude(prelude: string): void {
    this.skillsPrelude = prelude
  }

  /**
   * Set a per-task model override. When the runtime's ModelRouter selects
   * a different provider/model for this task, it calls this method so the
   * agent can prefer the override when making LLM calls.
   *
   * Returns the previous override, if any.
   */
  setModelOverride(provider: string, model: string): { provider: string; model: string } | undefined {
    const prev = this.modelOverride
    this.modelOverride = { provider, model }
    return prev
  }

  /** Get the current model override, if any. Returns a copy. */
  getModelOverride(): { provider: string; model: string } | undefined {
    return this.modelOverride ? { ...this.modelOverride } : undefined
  }

  /**
   * Clear any per-task model override. Call this at the start of each new
   * task to prevent stale overrides from leaking across workspaces.
   */
  clearModelOverride(): void {
    this.modelOverride = undefined
  }

  /**
   * Resolve the model string to pass to ChatOptions.
   * Returns the per-task override (set by ModelRouter or
   * evolutionAwareFactory) when present, otherwise undefined — which
   * makes the Provider fall back to its `defaultModel`.
   *
   * Concrete agents should call this and merge the result into their
   * ChatOptions so the router/evolution choice actually reaches the
   * LLM call instead of being silently dropped.
   */
  protected getEffectiveModel(): string | undefined {
    return this.modelOverride?.model
  }

  /**
   * Resolve the effective provider to use for LLM calls.
   * Returns the override provider when set, otherwise the default provider.
   */
  protected getEffectiveProvider(): Provider {
    // When a model override is set and the override provider is available,
    // the caller should use a registry to resolve it. Here we return the
    // default provider; concrete agents that need to switch providers must
    // inject a provider registry at construction time.
    return this._provider
  }

  /**
   * Receive a task. Agents may prepare state here (load memory, plan, etc.).
   */
  async receiveTask(_task: Task, _ctx: AgentContext): Promise<void> {
    // Default: no-op. Subclasses override.
  }

  /**
   * Execute the task and produce a Result.
   */
  abstract execute(task: Task, ctx: AgentContext): Promise<Result>

  /**
   * Submit a result. Default: validates then returns. Subclasses may add post-processing.
   */
  async submitResult(result: Result): Promise<Result> {
    // Basic validation — subclasses can override with stricter schemas.
    if (!result || typeof result !== "object") {
      throw new Error("submitResult: result must be a non-null object")
    }
    return Object.freeze({ ...result })
  }

  /**
   * Append to short-term memory with automatic truncation.
   * Rejects system-role messages to prevent prompt injection via memory.
   * Only assistant, user, and tool roles are accepted.
   */
  remember(message: ChatMessage): void {
    // Reject system-role injection: callers can inject a second system prompt
    // that overrides or conflicts with the trusted manifest system prompt.
    if (message.role === "system") {
      throw new Error("remember: system-role messages are not allowed in agent memory")
    }
    // Freeze the incoming message to prevent external mutation of memory.
    const frozen = Object.freeze({ ...message })
    this.memory.push(frozen)
    this.pruneMemory()
  }

  /** Read short-term memory. Returns a defensive copy. */
  recall(): readonly ChatMessage[] {
    return [...this.memory]
  }

  /**
   * Evict the oldest memory entries when the limit is exceeded.
   * Subclasses can override `maxMemoryMessages` to adjust the budget.
   */
  protected pruneMemory(): void {
    const limit = DEFAULT_MAX_MEMORY_MESSAGES
    while (this.memory.length > limit) {
      this.memory.shift()
    }
  }

  /**
   * Build the message list for an LLM call: system + memory + user.
   * Applies token/character budgets to prevent context-window exhaustion.
   */
  protected buildMessages(userMessage: string): ChatMessage[] {
    const tail = [this.memoryPrelude, this.skillsPrelude]
      .filter((s) => typeof s === "string" && s.length > 0)
      .join("\n")

    let systemContent = this.manifest.systemPrompt
    if (tail.length > 0) {
      systemContent = `${systemContent}\n${truncate(tail, DEFAULT_MAX_TEXT_LENGTH)}`
    }

    const memoryText = this.memory.map((m) => {
      return `[${m.role}] ${truncate(m.content, DEFAULT_MAX_TEXT_LENGTH)}`
    }).join("\n")

    const messages: ChatMessage[] = [
      { role: "system", content: systemContent },
      ...this.memory.map((m) => Object.freeze({ ...m })),
    ]

    // Truncate the user message to prevent provider rejection.
    const safeUser = truncate(userMessage, DEFAULT_MAX_TEXT_LENGTH)
    messages.push({ role: "user", content: safeUser })

    return messages
  }

  /**
   * Build the chat message list for a tool-enabled execution. Default falls
   * back to `buildMessages(task.description)`. Subclasses can override to
   * include prior results, plan context, or any per-task framing.
   */
  buildChatMessages(task: Task, _ctx: AgentContext): ChatMessage[] {
    return this.buildMessages(task.description)
  }

  /**
   * Clear short-term memory. Call this between tasks or at workspace teardown.
   */
  clearMemory(): void {
    this.memory.length = 0
  }

  /**
   * Optional hook: when the runtime has `enableToolLoop: true` and an agent
   * returns a `ToolEnabledProvider` from this method, the runtime routes
   * the task through `runToolLoop` so `tool-start` / `tool-end` events are
   * emitted. Default: no tool provider, so the runtime falls through to
   * `execute()` like before — keeps backwards compatibility for agents that
   * don't use tools.
   */
  getToolProvider(): import("./tool-integration.js").ToolEnabledProvider | undefined {
    return undefined
  }

  /** Snapshot for UI display. Returns a frozen copy. */
  toInstance(currentTaskId?: string, status: AgentInstance["status"] = "idle"): AgentInstance {
    return {
      id: this.id,
      manifest: Object.freeze({ ...this.manifest }),
      status,
      ...(currentTaskId !== undefined && { currentTaskId }),
      createdAt: this.createdAt,
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Truncates a string to at most `maxLen` characters, appending an ellipsis marker. */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, Math.max(0, maxLen - 3)) + "..."
}
