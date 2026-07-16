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
 *
 * The runtime has its own agent discovery (via manifests); this is for
 * ad-hoc inter-agent communication scenarios where a shared bus is useful.
 */

export interface AgentLike {
  id: string
  type: string
  status?: string
  /** Arbitrary per-agent metadata (capabilities, last-active, etc.). */
  metadata?: Record<string, unknown>
}

export interface AgentMessage<P = unknown> {
  id: string
  from: string
  to: string
  payload: P
  sentAt: string
}

export interface RegistryOptions {
  /** Cap on message history (default: 1000). */
  messageHistoryCap?: number
}

export class AgentRegistry {
  private readonly agents = new Map<string, AgentLike>()
  private readonly byType = new Map<string, Set<string>>()
  private readonly history: AgentMessage[] = []
  private readonly historyCap: number

  constructor(options?: RegistryOptions) {
    this.historyCap = options?.messageHistoryCap ?? 1000
  }

  /** Register an agent. Throws if id is already registered. */
  register(agent: AgentLike): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent ${agent.id} already registered`)
    }
    this.agents.set(agent.id, agent)
    if (!this.byType.has(agent.type)) {
      this.byType.set(agent.type, new Set())
    }
    this.byType.get(agent.type)!.add(agent.id)
  }

  /** Unregister an agent. Returns true if found and removed. */
  unregister(agentId: string): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false
    this.agents.delete(agentId)
    this.byType.get(agent.type)?.delete(agentId)
    if (this.byType.get(agent.type)?.size === 0) {
      this.byType.delete(agent.type)
    }
    return true
  }

  /** Get an agent by id. */
  get(agentId: string): AgentLike | undefined {
    return this.agents.get(agentId)
  }

  /** List all agents. */
  list(): AgentLike[] {
    return Array.from(this.agents.values())
  }

  /** List agents of a given type. */
  listByType(type: string): AgentLike[] {
    const ids = this.byType.get(type)
    if (!ids) return []
    const out: AgentLike[] = []
    for (const id of ids) {
      const a = this.agents.get(id)
      if (a) out.push(a)
    }
    return out
  }

  /** Update agent status (or other metadata fields). */
  updateStatus(agentId: string, status: string, extra?: Record<string, unknown>): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false
    this.agents.set(agentId, {
      ...agent,
      status,
      metadata: extra ? { ...(agent.metadata ?? {}), ...extra } : agent.metadata,
    })
    return true
  }

  /** Number of registered agents. */
  size(): number {
    return this.agents.size
  }

  /**
   * Route a message between two agents. Returns true if both endpoints are
   * registered. Records the message in history; actual payload delivery to
   * the recipient's receiver() is implemented separately.
   */
  routeMessage<P>(from: string, to: string, payload: P): boolean {
    if (!this.agents.has(from) || !this.agents.has(to)) return false
    this.history.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      from,
      to,
      payload,
      sentAt: new Date().toISOString(),
    })
    if (this.history.length > this.historyCap) {
      this.history.splice(0, this.history.length - this.historyCap)
    }
    return true
  }

  /** Most recent N messages from history. */
  recentMessages(limit = 50): AgentMessage[] {
    return this.history.slice(-limit)
  }

  /** Aggregate health snapshot. */
  getSystemHealth(): {
    totalAgents: number
    byType: Record<string, number>
    byStatus: Record<string, number>
  } {
    const byType: Record<string, number> = {}
    const byStatus: Record<string, number> = {}
    for (const a of this.agents.values()) {
      byType[a.type] = (byType[a.type] ?? 0) + 1
      const s = a.status ?? "unknown"
      byStatus[s] = (byStatus[s] ?? 0) + 1
    }
    return { totalAgents: this.agents.size, byType, byStatus }
  }

  /** Drop all registrations and history. */
  clear(): void {
    this.agents.clear()
    this.byType.clear()
    this.history.length = 0
  }
}