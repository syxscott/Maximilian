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

export interface AgentContext {
  /** Read access to prior results in the same workspace. */
  priorResults: Result[]
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
    this.id = id ?? `agent-${randomUUID().slice(0, 8)}`
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
   */
  setModelOverride(provider: string, model: string): void {
    this.modelOverride = { provider, model }
  }

  /** Get the current model override, if any. */
  getModelOverride(): { provider: string; model: string } | undefined {
    return this.modelOverride
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
   * Submit a result. Default: identity. Subclasses may add post-processing.
   */
  async submitResult(result: Result): Promise<Result> {
    return result
  }

  /** Append to short-term memory. */
  remember(message: ChatMessage): void {
    this.memory.push(message)
  }

  /** Read short-term memory. */
  recall(): ChatMessage[] {
    return [...this.memory]
  }

  /** Build the message list for an LLM call: system + memory + user. */
  protected buildMessages(userMessage: string): ChatMessage[] {
    const tail = [this.memoryPrelude, this.skillsPrelude].filter((s) => s.length > 0).join("\n")
    const systemContent =
      tail.length > 0 ? `${this.manifest.systemPrompt}\n${tail}` : this.manifest.systemPrompt
    return [
      { role: "system", content: systemContent },
      ...this.memory,
      { role: "user", content: userMessage },
    ]
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

  /** Snapshot for UI display. */
  toInstance(currentTaskId?: string, status: AgentInstance["status"] = "idle"): AgentInstance {
    return {
      id: this.id,
      manifest: this.manifest,
      status,
      currentTaskId,
      createdAt: this.createdAt,
    }
  }
}
