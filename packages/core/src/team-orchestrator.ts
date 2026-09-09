/**
 * TeamOrchestrator — Teams-First multi-agent orchestration engine.
 *
 * Borrowed from `Yeachan-Heo/oh-my-claudecode` teams-first architecture:
 *   - Each team has a leader + specialists sharing team memory
 *   - Leaders decompose tasks and delegate across teams via inter-team delegation
 *   - Readable IDs (adjective-color-animal) for debuggable delegation traces
 *   - Compaction hook re-injects delegation context when memory compresses
 *   - Fallback chain across teams; escalate to human when all exhausted
 *
 * Maximilian adapts this as an in-memory orchestrator on top of AgentRegistry
 * (no new HTTP layer) with EventBus-typed lifecycle events.
 */

import { AgentRegistry } from "./orchestration/agent-registry.js"
import { EventBus } from "./event-bus.js"

// ── Types ─────────────────────────────────────────────────────────────────

export interface FactRecord {
  id: string
  content: string
  /** Epoch-ms; older facts are candidates for summarization during compaction. */
  observedAt: number
}

export interface DecisionRecord {
  id: string
  rationale: string
  decidedAt: string
}

export interface TeamMemory {
  facts: FactRecord[]
  decisions: DecisionRecord[]
  modifiedFiles: string[]
  openQuestions: string[]
  lastUpdated: string
}

export interface Team {
  id: string
  name: string
  leaderId: string
  specialistIds: string[]
  memory: TeamMemory
  maxConcurrentDelegations?: number
  /** Optional capability tags used by findCapableTeam for task routing. */
  capabilities?: string[]
}

export interface DelegationRequest {
  id: string
  fromTeamId: string
  toTeamId: string
  taskId: string
  taskDescription: string
  context: Record<string, unknown>
  createdAt: string
  traceId?: string
  /** Tracks delegation hops to prevent unbounded recursion. */
  depth?: number
}

export interface DelegationResult {
  delegationId: string
  success: boolean
  result?: unknown
  error?: string
  attempts: number
  attemptedTeams: string[]
  durationMs: number
}

export interface TeamOrchestratorOptions {
  teams: Team[]
  maxDelegationDepth?: number
  delegationTTLMs?: number
  emitEvents?: boolean
  /** When compacting, keep this most-recent number of facts verbatim; summarize older ones. */
  compactKeepRecent?: number
}

export type TeamOrchestratorEvent =
  | { type: "team:delegation-created"; team: string; delegation: string }
  | { type: "team:delegation-complete"; delegation: string; result: unknown }
  | { type: "team:delegation-failed"; delegation: string; error: string }
  | { type: "team:escalation"; reason: string; attemptedTeams: string[] }

// ── Readable ID generator ─────────────────────────────────────────────────

const ADJECTIVES = [
  "elegant", "fierce", "gentle", "brave", "clever", "mighty", "noble",
  "rapid", "silent", "vivid", "witty", "bold", "calm", "dapper",
  "epic", "fancy", "golden", "happy", "iron", "jolly", "keen",
]
const COLORS = [
  "blue", "crimson", "amber", "emerald", "silver", "violet", "indigo",
  "gold", "coral", "teal", "ruby", "jade", "plume", "azure",
]
const ANIMALS = [
  "tiger", "falcon", "panther", "lynx", "orca", "wolf", "eagle",
  "fox", "bear", "hawk", "otter", "raven", "crane", "stoat",
]

/** Generate a readable `adjective-color-animal` ID for traceable delegations. */
export function generateReadableId(): string {
  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!
  return `${pick(ADJECTIVES)}-${pick(COLORS)}-${pick(ANIMALS)}`
}

// ── Helpers ───────────────────────────────────────────────────────────────

function emptyMemory(): TeamMemory {
  return {
    facts: [],
    decisions: [],
    modifiedFiles: [],
    openQuestions: [],
    lastUpdated: new Date().toISOString(),
  }
}

// ── TeamOrchestrator ──────────────────────────────────────────────────────

export class TeamOrchestrator {
  private readonly teams = new Map<string, Team>()
  private readonly maxDelegationDepth: number
  private readonly delegationTTLMs: number
  private readonly emitEvents: boolean
  private readonly compactKeepRecent: number
  private readonly registry: AgentRegistry
  private readonly eventBus: EventBus<TeamOrchestratorEvent>
  /** Tracks active delegations per team for concurrent-limit enforcement. */
  private readonly activeDelegations = new Map<string, number>()
  /** Tracks started delegation IDs for TTL-based expiry. */
  private readonly delegationStartTimes = new Map<string, number>()

  constructor(
    opts: TeamOrchestratorOptions,
    registry: AgentRegistry = new AgentRegistry(),
    eventBus: EventBus<TeamOrchestratorEvent> = new EventBus<TeamOrchestratorEvent>(),
  ) {
    const dd = opts.maxDelegationDepth
    this.maxDelegationDepth =
      Number.isSafeInteger(dd) && dd !== undefined && dd > 0 ? dd : 3

    const ttl = opts.delegationTTLMs
    this.delegationTTLMs =
      Number.isSafeInteger(ttl) && ttl !== undefined && ttl > 0 ? ttl : 30_000

    this.emitEvents = opts.emitEvents ?? true

    const kr = opts.compactKeepRecent
    this.compactKeepRecent =
      Number.isSafeInteger(kr) && kr !== undefined && kr > 0 ? kr : 5

    this.registry = registry
    this.eventBus = eventBus

    for (const team of opts.teams) {
      // Reference-copy (not deep): callers can seed orchestrator with a Team
      // object and continue mutating it for introspection. This also matches
      // the in-memory registry pattern where `AgentLike` instances are frozen
      // on registration; here we honor external ownership of Team state.
      this.teams.set(team.id, { ...team })
      this.activeDelegations.set(team.id, 0)
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Delegate a task from one team to another. On success, updates source team
   * memory with modified files and a decision record. On failure, falls back
   * through candidate teams and finally escalates when all are exhausted.
   */
  async delegate(req: DelegationRequest): Promise<DelegationResult> {
    const startMs = Date.now()
    const traceId = req.traceId ?? req.id
    const depth = req.depth ?? 0

    const fromTeam = this.teams.get(req.fromTeamId)
    if (!fromTeam) {
      return this.finishFailure(req, startMs, [], `unknown source team: ${req.fromTeamId}`)
    }

    // Depth guard — prevents cross-team cycles from recursing unboundedly.
    if (depth >= this.maxDelegationDepth) {
      return this.finishFailure(
        req,
        startMs,
        [],
        `max delegation depth (${this.maxDelegationDepth}) exceeded at depth ${depth}`,
      )
    }

    // Concurrency guard — source team already saturated with in-flight delegations.
    const maxConcurrent = fromTeam.maxConcurrentDelegations ?? Infinity
    const inFlight = this.activeDelegations.get(req.fromTeamId) ?? 0
    if (inFlight >= maxConcurrent) {
      return this.finishFailure(
        req,
        startMs,
        [],
        `source team "${req.fromTeamId}" reached maxConcurrentDelegations (${maxConcurrent})`,
      )
    }

    // TTL guard — drop stale delegations rather than process them.
    const ageMs = startMs - new Date(req.createdAt).getTime()
    if (ageMs > this.delegationTTLMs) {
      return this.finishFailure(
        req,
        startMs,
        [],
        `delegation "${req.id}" expired (age ${ageMs}ms > TTL ${this.delegationTTLMs}ms)`,
      )
    }

    this.emit({ type: "team:delegation-created", team: req.fromTeamId, delegation: req.id })
    this.activeDelegations.set(req.fromTeamId, (this.activeDelegations.get(req.fromTeamId) ?? 0) + 1)
    this.delegationStartTimes.set(req.id, startMs)

    try {
      const result = await this.attemptDelegateWithFallback(req, fromTeam, depth, traceId)
      if (result.success) {
        return result
      }
      // Failed but no fallback succeeded → escalate.
      this.emit({
        type: "team:escalation",
        reason: result.error ?? "all teams exhausted",
        attemptedTeams: result.attemptedTeams,
      })
      return result
    } finally {
      this.activeDelegations.set(
        req.fromTeamId,
        Math.max(0, (this.activeDelegations.get(req.fromTeamId) ?? 1) - 1),
      )
      this.delegationStartTimes.delete(req.id)
    }
  }

  addFact(teamId: string, fact: string): void {
    const team = this.teams.get(teamId)
    if (!team) throw new Error(`unknown team: ${teamId}`)
    const now = Date.now()
    const record: FactRecord = {
      id: `fact-${now}-${team.memory.facts.length}`,
      content: fact,
      observedAt: now,
    }
    team.memory.facts.push(record)
    team.memory.lastUpdated = new Date(now).toISOString()
  }

  addDecision(teamId: string, decision: DecisionRecord): void {
    const team = this.teams.get(teamId)
    if (!team) throw new Error(`unknown team: ${teamId}`)
    team.memory.decisions.push(decision)
    team.memory.lastUpdated = new Date().toISOString()
  }

  /**
   * Serialize team memory into LLM-injectable text. Sections are ordered for
   * prompt stability: decisions first (highest signal), then facts, files,
   * open questions.
   */
  getTeamContext(teamId: string): string {
    const team = this.teams.get(teamId)
    if (!team) return ""
    const m = team.memory
    const lines: string[] = []
    lines.push(`# Team: ${team.name} (${team.id})`)
    if (m.decisions.length > 0) {
      lines.push("## Decisions")
      for (const d of m.decisions) lines.push(`- ${d.rationale}`)
    }
    if (m.facts.length > 0) {
      lines.push("## Facts")
      for (const f of m.facts) lines.push(`- ${f.content}`)
    }
    if (m.modifiedFiles.length > 0) {
      lines.push("## Modified Files")
      for (const f of m.modifiedFiles) lines.push(`- ${f}`)
    }
    if (m.openQuestions.length > 0) {
      lines.push("## Open Questions")
      for (const q of m.openQuestions) lines.push(`- ${q}`)
    }
    return lines.join("\n")
  }

  /**
   * Compact team memory by summarizing older facts into a single digest.
   * Recent facts (last N by observedAt) are preserved verbatim so fresh
   * context survives compaction. Returns the previous snapshot.
   */
  async compactMemory(teamId: string): Promise<TeamMemory> {
    const team = this.teams.get(teamId)
    if (!team) throw new Error(`unknown team: ${teamId}`)
    const before: TeamMemory = {
      facts: [...team.memory.facts],
      decisions: [...team.memory.decisions],
      modifiedFiles: [...team.memory.modifiedFiles],
      openQuestions: [...team.memory.openQuestions],
      lastUpdated: team.memory.lastUpdated,
    }
    const sorted = [...team.memory.facts].sort((a, b) => a.observedAt - b.observedAt)
    if (sorted.length <= this.compactKeepRecent) return before
    const toFold = sorted.slice(0, sorted.length - this.compactKeepRecent)
    const keep = sorted.slice(sorted.length - this.compactKeepRecent)
    const summary: FactRecord = {
      id: `compact-summary-${Date.now()}`,
      content: `[compacted ${toFold.length} older facts: ${toFold.map((f) => f.content).join("; ")}]`,
      observedAt: toFold[toFold.length - 1]!.observedAt,
    }
    team.memory.facts = [summary, ...keep]
    team.memory.lastUpdated = new Date().toISOString()
    return before
  }

  /**
   * Find a team whose capabilities overlap the task description. Returns the
   * first matching team; undefined if no team advertises a matching tag.
   *
   * Uses word-boundary regex so "ui" doesn't match "build" — a capability only
   * counts when it appears as its own token in the task description. This keeps
   * dispatch predictable without pulling in an NLP dependency.
   */
  findCapableTeam(taskDescription: string): Team | undefined {
    for (const team of this.teams.values()) {
      const caps = team.capabilities
      if (!caps) continue
      for (const c of caps) {
        // Escape regex metacharacters in the capability tag, then match as a
        // whole word (Unicode-aware \b boundary against surrounding non-word
        // chars or string ends).
        const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        const pattern = new RegExp(`(?:^|\\W)${escaped}(?:\\W|$)`, "i")
        if (pattern.test(taskDescription)) return team
      }
    }
    return undefined
  }

  dispose(): void {
    this.teams.clear()
    this.activeDelegations.clear()
    this.delegationStartTimes.clear()
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private async attemptDelegateWithFallback(
    req: DelegationRequest,
    sourceTeam: Team,
    depth: number,
    traceId: string,
  ): Promise<DelegationResult> {
    const startMs = Date.now()
    const attemptedTeams: string[] = []
    let lastError = "no candidate team"

    // Primary target first, then all *other* teams as fallbacks (stable order).
    // Skip the source team: an exhausted delegation should not bounce back to
    // the originating team (which is why the user asked for help in the first
    // place — it'd be a trivial cycle).
    const candidates = [
      req.toTeamId,
      ...Array.from(this.teams.keys()).filter((id) => id !== req.toTeamId && id !== req.fromTeamId),
    ]
    for (const candidateId of candidates) {
      attemptedTeams.push(candidateId)
      const target = this.teams.get(candidateId)
      if (!target) {
        lastError = `unknown target team: ${candidateId}`
        continue
      }
      // Verify target leader is registered in the registry.
      const leader = this.registry.get(target.leaderId)
      if (!leader) {
        lastError = `leader "${target.leaderId}" of team "${candidateId}" not in registry`
        continue
      }
      try {
        const payload = {
          taskId: req.taskId,
          taskDescription: req.taskDescription,
          context: req.context,
          traceId,
          depth: depth + 1,
        }
        // Encode the target-team into the messageId so fallback attempts to
        // different teams don't get silenced by routeMessage's idempotency
        // cache (which otherwise caches the previous delegation.id and returns
        // the prior false result without dispatching).
        const isPrimary = candidateId === req.toTeamId
        const messageId = isPrimary ? req.id : `${req.id}:${candidateId}`
        // Route via the source team *leader* (not team id) so the registry's
        // sender lookup matches a registered agent.
        const ok = await this.registry.routeMessage(
          sourceTeam.leaderId,
          target.leaderId,
          payload,
          messageId,
        )
        if (!ok) {
          lastError = `registry delivery failed to leader "${target.leaderId}"`
          continue
        }
        // Record decision + a fact referencing the delegation in source memory.
        sourceTeam.memory.decisions.push({
          id: `dec-${Date.now()}`,
          rationale: `delegated task "${req.taskId}" to team "${candidateId}" via ${req.id}`,
          decidedAt: new Date().toISOString(),
        })
        sourceTeam.memory.lastUpdated = new Date().toISOString()
        this.emit({
          type: "team:delegation-complete",
          delegation: req.id,
          result: { toTeamId: candidateId, leaderId: target.leaderId },
        })
        return {
          delegationId: req.id,
          success: true,
          result: { toTeamId: candidateId, leaderId: target.leaderId },
          attempts: attemptedTeams.length,
          attemptedTeams,
          durationMs: Math.max(0, Date.now() - startMs),
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        continue
      }
    }

    this.emit({ type: "team:delegation-failed", delegation: req.id, error: lastError })
    return {
      delegationId: req.id,
      success: false,
      error: lastError,
      attempts: attemptedTeams.length,
      attemptedTeams,
      durationMs: Math.max(0, Date.now() - startMs),
    }
  }

  private finishFailure(
    req: DelegationRequest,
    startMs: number,
    attemptedTeams: string[],
    reason: string,
  ): DelegationResult {
    if (attemptedTeams.length > 0) {
      this.emit({ type: "team:delegation-failed", delegation: req.id, error: reason })
    }
    return {
      delegationId: req.id,
      success: false,
      error: reason,
      attempts: 0,
      attemptedTeams,
      durationMs: Math.max(0, Date.now() - startMs),
    }
  }

  private emit(event: TeamOrchestratorEvent): void {
    if (!this.emitEvents) return
    try {
      this.eventBus.publish(event)
    } catch {
      // EventBus isolates errors; we additionally swallow at the source.
    }
  }
}

export type {
  FactRecord as TeamFactRecord,
  DecisionRecord as TeamDecisionRecord,
}
