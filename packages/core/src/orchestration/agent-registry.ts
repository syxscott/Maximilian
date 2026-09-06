/**
 * AgentRegistry — type-keyed registry with Reliable message routing between agents with delivery confirmation (借鉴 Kosmos agents/registry.py).
 *
 * Kosmos's AgentRegistry maintains a central map of agent_id → agent and
 * routes messages between them via `send_message()`. It also tracks agents
 * by `agent_type` for type-based lookups and exposes a system-health view.
 *
 * Maximilian adapts this as a generic, dependency-free registry for any
 * "agent-like" object (anything with an id, type, and optional status).
 * It supports:
 *   - register / unregister / get / list
 *   - type-keyed grouping (listByType)
 *   - bounded message history (ring buffer)
 *   - system health snapshot (counts by status)
 *   - lifecycle hooks (dispose) on removal
 *
 * The runtime has its own agent discovery (via manifests); this is for
 * ad-hoc inter-agent communication scenarios where a shared bus is useful.
 */

import { randomUUID } from "node:crypto"
import { deriveSubagentScope, type PermissionScope } from "@max/tools/permission"

// ── Types ─────────────────────────────────────────────────────────────────

/** Optional lifecycle hook invoked during unregister/clear. */
export interface AgentLifecycleHook {
  /** Called before the agent is removed. Implementations should cancel timers, close sockets, etc. */
  dispose?(): Promise<void> | void
}

export interface AgentLike extends AgentLifecycleHook {
  id: string
  type: string
  status?: string
  /** Arbitrary per-agent metadata (capabilities, last-active, etc.). */
  metadata?: Record<string, unknown>
  /** 消息接收处理器 */
  receiver?: (from: string, payload: unknown) => Promise<void> | void
  /**
   * 借鉴 opencode - agent/subagent-permissions
   * 父 agent 的 id;子 agent 在 register 时会自动 derive scope。
   */
  parentId?: string
  /**
   * 借鉴 opencode - subagent scope 收窄声明(子 agent 注册时使用)
   */
  narrowScope?: Partial<PermissionScope>
  /**
   * 借鉴 opencode - 派生出的实际生效 scope;由 registerWithScope 计算后回填
   */
  scope?: PermissionScope
}

export interface AgentMessage<P = unknown> {
  id: string
  from: string
  to: string
  payload: unknown
  sentAt: string
  delivered: boolean
  error?: string
}

export interface RegistryOptions {
  /** Cap on message history (default: 1000). Must be a non-negative integer. */
  messageHistoryCap?: number
  /** Maximum number of registered agents (default: 10000). */
  maxAgents?: number
  /** Maximum metadata byte size per agent (default: 64 KiB). */
  maxMetadataBytes?: number
  /** TTL in ms for idempotency deduplication (default: 60000). */
  idempotencyTtlMs?: number
}

// ── AgentRegistry ────────────────────────────────────────────────────────────

export class AgentRegistry {
  private readonly agents = new Map<string, Readonly<AgentLike>>()
  private readonly byType = new Map<string, Set<string>>()
  private readonly history: AgentMessage[] = []
  private readonly historyCap: number
  private readonly maxAgents: number
  private readonly maxMetadataBytes: number
  private readonly deliveryTimeoutMs = 5_000
  private readonly idempotencyTtlMs: number

  // Bounded TTL cache for idempotency: messageId → expiry timestamp.
  private readonly _processedIds = new Map<string, { delivered: boolean; expiresAt: number }>()

  constructor(options?: RegistryOptions) {
    const hc = options?.messageHistoryCap
    this.historyCap = Number.isSafeInteger(hc) && hc !== undefined && hc >= 0 ? hc : 1000

    const ma = options?.maxAgents
    this.maxAgents = Number.isSafeInteger(ma) && ma !== undefined && ma > 0 ? ma : 10_000

    const mmb = options?.maxMetadataBytes
    this.maxMetadataBytes = Number.isSafeInteger(mmb) && mmb !== undefined && mmb > 0 ? mmb : 65_536

    const ittl = options?.idempotencyTtlMs
    this.idempotencyTtlMs =
      Number.isSafeInteger(ittl) && ittl !== undefined && ittl > 0 ? ittl : 60_000
  }

  /** Register an agent. Throws if id is already registered or limit reached. */
  register(agent: AgentLike): void {
    if (typeof agent.id !== "string" || agent.id.trim().length === 0) {
      throw new Error("Agent id must be a non-empty string")
    }
    if (typeof agent.type !== "string" || agent.type.trim().length === 0) {
      throw new Error("Agent type must be a non-empty string")
    }
    if (this.agents.size >= this.maxAgents) {
      throw new Error(`Agent limit reached (${this.maxAgents})`)
    }
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent ${agent.id} already registered`)
    }
    if (agent.metadata) {
      const size = new Blob([JSON.stringify(agent.metadata)]).size
      if (size > this.maxMetadataBytes) {
        throw new Error(`Agent metadata exceeds ${this.maxMetadataBytes} bytes`)
      }
    }
    // 借鉴 opencode - subagent-permissions: 若指定 parentId,自动 derive scope
    let derivedScope: PermissionScope | undefined
    if (agent.parentId) {
      const parent = this.agents.get(agent.parentId)
      if (!parent) {
        throw new Error(`Parent agent ${agent.parentId} not found (借鉴 opencode)`)
      }
      // 父级若还没有 scope(根 agent),赋予默认 scope
      const parentScope = parent.scope ?? {
        allowedTools: [],
        forbiddenPaths: [],
        requireApproval: false,
      }
      derivedScope = deriveSubagentScope(parentScope, agent.narrowScope ?? {})
    }
    // Store a frozen copy to prevent caller mutation of registered state.
    const frozen: Readonly<AgentLike> = Object.freeze({
      ...agent,
      scope: derivedScope ?? agent.scope,
    })
    this.agents.set(agent.id, frozen)
    if (!this.byType.has(agent.type)) {
      this.byType.set(agent.type, new Set())
    }
    this.byType.get(agent.type)!.add(agent.id)
  }

  /** Unregister an agent. Calls dispose() hook before removal. Returns true if found and removed. */
  async unregister(agentId: string): Promise<boolean> {
    const agent = this.agents.get(agentId)
    if (!agent) return false

    // Call the lifecycle dispose hook before removing the agent.
    try {
      if (agent.dispose) {
        const result = agent.dispose()
        if (result && typeof result.then === "function") {
          await result
        }
      }
    } catch {
      // Dispose errors are logged but do not block removal.
    }

    this.agents.delete(agentId)
    this.byType.get(agent.type)?.delete(agentId)
    if (this.byType.get(agent.type)?.size === 0) {
      this.byType.delete(agent.type)
    }
    return true
  }

  /** Get an agent by id. Returns a frozen copy. */
  get(agentId: string): AgentLike | undefined {
    const a = this.agents.get(agentId)
    return a ? Object.freeze({ ...a }) : undefined
  }

  /** List all agents. Returns frozen copies. */
  list(): AgentLike[] {
    return Array.from(this.agents.values()).map((a) => Object.freeze({ ...a }))
  }

  /** List agents of a given type. Returns frozen copies. */
  listByType(type: string): AgentLike[] {
    const ids = this.byType.get(type)
    if (!ids) return []
    const out: AgentLike[] = []
    for (const id of ids) {
      const a = this.agents.get(id)
      if (a) out.push(Object.freeze({ ...a }))
    }
    return out
  }

  /** Update agent status (or other metadata fields). Returns frozen updated copy. */
  updateStatus(agentId: string, status: string, extra?: Record<string, unknown>): boolean {
    const existing = this.agents.get(agentId)
    if (!existing) return false
    const updated: Readonly<AgentLike> = Object.freeze({
      ...existing,
      status,
      metadata: extra
        ? Object.freeze({ ...(existing.metadata ?? {}), ...extra })
        : existing.metadata,
    })
    this.agents.set(agentId, updated)
    return true
  }

  /** Number of registered agents. */
  size(): number {
    return this.agents.size
  }

  /**
   * Route a message between two agents. Returns true only if both endpoints are
   * registered and the message was delivered successfully.
   *
   * If `messageId` is supplied, the call is idempotent: duplicate sends within
   * `idempotencyTtlMs` return the original delivery result without re-delivering.
   */
  async routeMessage<P>(
    from: string,
    to: string,
    payload: P,
    messageId?: string,
  ): Promise<boolean> {
    // ── Idempotency check ─────────────────────────────────────────────────────
    const msgId = messageId ?? randomUUID()
    const now = Date.now()
    const prior = this._processedIds.get(msgId)
    if (prior !== undefined) {
      // Within TTL window — return the original delivery outcome
      // (delivered=true|false) rather than a misleading `false`. We
      // also skip re-recording the message in history so retries don't
      // pollute the audit trail.
      return prior.delivered
    }
    // Clean up expired entries on every call (amortized O(1) if bounded).
    if (this._processedIds.size > 100_000) {
      for (const [key, entry] of this._processedIds) {
        if (entry.expiresAt < now) this._processedIds.delete(key)
      }
    }

    const sender = this.agents.get(from)
    const recipient = this.agents.get(to)
    if (!sender || !recipient) return false

    const sentAt = new Date().toISOString()
    // Freeze the payload to prevent post-send mutation. structuredClone
    // throws DataCloneError on non-cloneable values (functions, DOM
    // nodes, WeakMap, etc.) — convert the failure into a delivery
    // failure rather than letting the whole routeMessage reject.
    let frozenPayload: unknown
    try {
      frozenPayload = Object.freeze(structuredClone(payload))
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      // History wasn't pushed yet (we record below), so just bail with
      // a clear error.
      throw new Error(`AgentRegistry.routeMessage: payload is not cloneable: ${reason}`)
    }

    // Record delivery attempt before delivery so failures are visible in history.
    const entry: AgentMessage = {
      id: msgId,
      from,
      to,
      payload: frozenPayload,
      sentAt,
      delivered: false,
    }
    this.history.push(entry)
    if (this.history.length > this.historyCap) {
      this.history.splice(0, this.history.length - this.historyCap)
    }

    // Mark as processed for idempotency. The entry stores the
    // delivery outcome so a retry within the TTL can return the same
    // boolean the original attempt produced.
    this._processedIds.set(msgId, {
      delivered: false,
      expiresAt: now + this.idempotencyTtlMs,
    })

    if (recipient.receiver) {
      try {
        const result = recipient.receiver(from, frozenPayload)
        if (result && typeof result.then === "function") {
          // Cap delivery time to prevent hung receivers from blocking routing.
          // The AbortController signals the receiver so it can cancel its
          // own work — otherwise the underlying promise keeps running
          // after timeout and accumulates orphan handlers.
          const controller = new AbortController()
          const timeoutPromise = new Promise<null>((_, reject) => {
            const timer = setTimeout(() => {
              controller.abort()
              reject(new Error("delivery timeout"))
            }, this.deliveryTimeoutMs)
            // Don't keep the event loop alive just for the timer.
            if (typeof timer.unref === "function") timer.unref()
          })
          // Attach the abort signal to the receiver when it accepts one.
          if ("signal" in recipient && (recipient as { signal?: unknown }).signal !== undefined) {
            ;(recipient as { signal: AbortSignal }).signal = controller.signal
          }
          try {
            await Promise.race([result, timeoutPromise])
          } finally {
            controller.abort()
          }
        }
        entry.delivered = true
        this._processedIds.set(msgId, {
          delivered: true,
          expiresAt: now + this.idempotencyTtlMs,
        })
        return true
      } catch (err) {
        entry.error = err instanceof Error ? err.message : String(err)
        entry.delivered = false
        this._processedIds.set(msgId, {
          delivered: false,
          expiresAt: now + this.idempotencyTtlMs,
        })
        return false
      }
    }
    entry.delivered = true
    return true
  }

  /** Most recent N messages from history. Returns frozen copies. */
  recentMessages(limit = 50): AgentMessage[] {
    const n = Number.isSafeInteger(limit) && limit >= 0 ? limit : 50
    return this.history.slice(-n).map((m) => Object.freeze({ ...m }))
  }

  /** Aggregate health snapshot using null-prototype objects. */
  getSystemHealth(): {
    totalAgents: number
    byType: Record<string, number>
    byStatus: Record<string, number>
  } {
    const byType = Object.create(null) as Record<string, number>
    const byStatus = Object.create(null) as Record<string, number>
    for (const a of this.agents.values()) {
      // Defensively access type/status since agent objects are externally supplied.
      const t = typeof a.type === "string" && a.type.length > 0 ? a.type : "unknown"
      const s = typeof a.status === "string" && a.status.length > 0 ? a.status : "unknown"
      byType[t] = (byType[t] ?? 0) + 1
      byStatus[s] = (byStatus[s] ?? 0) + 1
    }
    return { totalAgents: this.agents.size, byType, byStatus }
  }

  /** Drop all registrations and history. Calls dispose() on every agent first. */
  async clear(): Promise<void> {
    for (const agent of this.agents.values()) {
      try {
        if (agent.dispose) {
          const result = agent.dispose()
          if (result && typeof result.then === "function") {
            await result
          }
        }
      } catch {
        // Dispose errors do not block clearing.
      }
    }
    this.agents.clear()
    this.byType.clear()
    this.history.length = 0
    this._processedIds.clear()
  }
}
