/**
 * 6.X — MetaOrchestrator
 *
 * Ties the meta-system loop together. Invoked periodically (or
 * on-demand) after AutonomyOrchestrator.observe() completes:
 *
 *   1. Discover new capabilities from user requests / failure patterns
 *   2. For each proposal: register in CapabilityRegistry (proposed → experimental → active)
 *   3. Birth agents for active capabilities (AgentBirthEngine)
 *   4. Evaluate retirements (AgentRetirementEngine)
 *   5. MetaAgent decides create / delete / merge / split
 *   6. TeamOptimizer suggests team adjustments
 *   7. GovernanceEngine checks limits
 *   8. Each step records an OrganizationEvent
 *
 * Phase 8 — every birth / retirement / promotion / merge / split decision
 * is wrapped in a Proposal and routed through ProposalPipeline.simulateDelta
 * before any mutation. SafeRollout controls shadow / canary / full modes.
 * When `pipeline` is NOT provided, the orchestrator falls back to the
 * Phase 6-7 direct-mutation path (back-compat for existing tests).
 */

import { CapabilityRegistry } from "./capability-registry.js"
import { getLogger, metaCycleDuration } from "@max/telemetry"

const log = getLogger("meta-system:orchestrator")
import { CapabilityDiscoveryEngine, type DiscoverySignal } from "./capability-discovery.js"
import { AgentBirthEngine } from "./agent-birth.js"
import { AgentRetirementEngine } from "./agent-retirement.js"
import { MetaAgent } from "./meta-agent.js"
import { TeamOptimizer } from "./team-optimizer.js"
import { OrganizationMemory } from "./organization-memory.js"
import { GovernanceEngine } from "./governance.js"
import type {
  AgentChangePlan,
  AgentBirthResult,
  RetirementDecision,
  TeamOptimizerHint,
  CapabilityRecord,
  CapabilityProposal,
  GovernanceVerdict,
  Proposal,
  SimulationDelta,
  DecisionScore,
  TelemetrySink,
} from "./types.js"
import type { BenchmarkBridge } from "./simulation.js"
import type { ExecutionRecord } from "@max/autonomy"
import type { TeamGraph, AgentBlueprint } from "@max/dags"
import {
  ProposalPipeline,
  fromAgentChange,
  fromTeamHint,
  createProposal,
} from "./proposal-pipeline.js"
import { SafeRollout, type RolloutResult } from "./safe-rollout.js"
import type { PendingProposalStore } from "./pending-proposal-store.js"
import { TruthAudit, recordProposalOutcome } from "./truth-audit.js"
import type { TruthMeasurement, TruthVerification, TruthReport } from "./types.js"

export interface MetaOrchestratorDeps {
  registry: CapabilityRegistry
  discovery: CapabilityDiscoveryEngine
  birth: AgentBirthEngine
  retirement: AgentRetirementEngine
  metaAgent: MetaAgent
  teamOptimizer: TeamOptimizer
  orgMemory: OrganizationMemory
  governance: GovernanceEngine
  /** Phase 8 — optional ProposalPipeline. When wired, mutations go through pipeline. */
  pipeline?: ProposalPipeline
  /** Phase 8 — optional SafeRollout. When wired (with pipeline), controls apply vs. shadow. */
  rollout?: SafeRollout
  /** Phase 8 — explicit save hook called only after pipeline+rollout approval. */
  manualSaveBlueprint?: (bp: AgentBlueprint) => Promise<void>
  /** Phase 8 — explicit retire hook called only after pipeline+rollout approval. */
  manualRetireBlueprint?: (blueprintId: string) => Promise<void>
  /** Phase 9 — bridge to real benchmark quality data for promotion decisions. */
  benchmarkBridge?: BenchmarkBridge
  /** Phase 10 — telemetry for recording evolution traces. */
  telemetry?: TelemetrySink
  /** Phase 11 — store for proposals pending human approval. */
  pendingStore?: PendingProposalStore
  /** Phase 8.7 — optional TruthAudit for prediction-vs-reality verification. */
  truthAudit?: TruthAudit
}

export interface MetaCycleInput {
  recentExecutions: ExecutionRecord[]
  blueprints: AgentBlueprint[]
  graphs: TeamGraph[]
  discoverySignals: DiscoverySignal[]
}

export interface Phase8ProposalTrace {
  proposal: Proposal
  simulation: SimulationDelta
  score: DecisionScore
  rollout?: RolloutResult
  pipelineApproved: boolean
  /** Phase 11 — true when HITL gate paused this proposal for human review. */
  hitlPaused?: boolean
}

export interface MetaCycleResult {
  proposals: CapabilityProposal[]
  activated: CapabilityRecord[]
  births: AgentBirthResult[]
  retirements: RetirementDecision[]
  changePlan: AgentChangePlan
  teamHint: TeamOptimizerHint
  governance: GovernanceVerdict
  blockedBy: string[]
  recorded: number
  /** Phase 8 — every proposal that ran through the pipeline during this cycle. */
  proposalsPhase8?: Phase8ProposalTrace[]
}

export class MetaOrchestrator {
  constructor(private deps: MetaOrchestratorDeps) {}

  async cycle(input: MetaCycleInput): Promise<MetaCycleResult> {
    const cycleStart = Date.now()
    const usePhase8 = !!this.deps.pipeline
    const proposalsPhase8: Phase8ProposalTrace[] = []

    // Phase 7 — early governance check (before any mutations).
    const knownIds = (await this.deps.registry.listAll()).map((c) => c.id)
    const discovery = await this.deps.discovery.discover(input.discoverySignals, knownIds)
    const allCapabilities = await this.deps.registry.listAll()
    const baselineVerdict = this.deps.governance.check({
      graphs: input.graphs,
      capabilities: allCapabilities,
      blueprints: input.blueprints,
    })
    const blockedBy: string[] = []
    if (!baselineVerdict.allowed) {
      blockedBy.push(baselineVerdict.reason)
      await this.deps.orgMemory.record("governance_violation", "system", {
        reason: baselineVerdict.reason,
        stage: "pre_mutation",
      })
    }

    // 1. Discover / propose — proposals are always allowed (advisory).
    for (const p of discovery.proposals) {
      try {
        await this.deps.registry.propose({
          capabilityId: p.capabilityId,
          displayName: p.displayName,
          description: p.rationale,
          proposalId: p.id,
        })
        await this.deps.orgMemory.record("capability_proposed", p.capabilityId, {
          proposalId: p.id,
          source: p.source,
        })
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
      }
    }

    // 2. Activate: proposed → experimental → active.
    const reloadedCapabilities = await this.deps.registry.listAll()
    const activated: CapabilityRecord[] = []
    if (!blockedBy.some((r) => r.includes("maxCapabilities"))) {
      for (const c of reloadedCapabilities) {
        let current = c
        if (current.status === "proposed") {
          current = await this.deps.registry.transition(c.id, "experimental")
          await this.deps.orgMemory.record("capability_promoted", c.id, {
            from: "proposed",
            to: "experimental",
          })
        }
        if (current.status === "experimental") {
          // Final gate: re-check maxCapabilities before reaching "active".
          const projected = await this.deps.registry.listByStatus("active")
          const maxCaps = this.deps.governance.getConfig().maxCapabilities
          if (projected.length >= maxCaps) {
            blockedBy.push(
              `maxCapabilities: ${projected.length}/${maxCaps} reached, further promotions blocked`,
            )
            break
          }
          // Phase 8 — promotion goes through pipeline like any other proposal.
          // Pipeline score decides approval; governance (maxCapabilities) is
          // a separate pre-check above.
          if (usePhase8 && this.deps.pipeline) {
            const promotionProposal = createProposal({
              action: "promote",
              subject: c.id,
              rationale: `Promote ${c.id} to active (maxCapabilities=${maxCaps})`,
              source: "meta_agent",
            })
            const trace = await this.runPromotionProposal(promotionProposal)
            proposalsPhase8.push(trace)
            if (trace.pipelineApproved && trace.rollout?.applied) {
              current = await this.deps.registry.transition(c.id, "active")
              await this.deps.orgMemory.record("capability_promoted", c.id, {
                from: "experimental",
                to: "active",
              })
              activated.push(current)
            }
          } else {
            current = await this.deps.registry.transition(c.id, "active")
            await this.deps.orgMemory.record("capability_promoted", c.id, {
              from: "experimental",
              to: "active",
            })
            activated.push(current)
          }
        }
      }
    }

    // 3. Birth agents for newly active capabilities.
    const births: AgentBirthResult[] = []
    let birthBudget = baselineVerdict.currentCounts.agents
    const maxAgents = this.deps.governance.getConfig().maxAgents
    if (!blockedBy.some((r) => r.includes("maxAgents"))) {
      for (const c of activated) {
        if (birthBudget >= maxAgents) {
          blockedBy.push(
            `maxAgents: ${birthBudget}/${maxAgents} reached, ${activated.length - births.length} pending births skipped`,
          )
          break
        }
        // Phase 8 — birth goes through pipeline + rollout.
        if (usePhase8 && this.deps.pipeline) {
          const birthProposal = createProposal({
            action: "birth",
            subject: c.id,
            rationale: `Birth agent for capability ${c.id}`,
            source: "meta_agent",
          })
          let birthResult: AgentBirthResult | undefined
          const trace = await this.runProposal(birthProposal, async () => {
            birthResult = await this.deps.birth.birth(c)
            if (this.deps.manualSaveBlueprint) {
              const bp = birthResultToBlueprint(birthResult)
              await this.deps.manualSaveBlueprint(bp)
            }
          })
          proposalsPhase8.push(trace)
          if (trace.rollout?.applied && birthResult) {
            births.push(birthResult)
            birthBudget++
            await this.deps.orgMemory.record("agent_born", birthResult.blueprintId, {
              role: birthResult.role,
              capability: c.id,
            })
          }
        } else {
          const result = await this.deps.birth.birth(c)
          births.push(result)
          birthBudget++
          await this.deps.orgMemory.record("agent_born", result.blueprintId, {
            role: result.role,
            capability: c.id,
          })
        }
      }
    }

    // 4. Retirement evaluation.
    const activeBlueprintIds = input.blueprints.filter((b) => !b.retiredAt).map((b) => b.id)
    const retirements = await this.deps.retirement.evaluateAll(
      activeBlueprintIds,
      input.recentExecutions,
    )
    for (const r of retirements) {
      // Phase 8 — retire goes through pipeline when wired.
      if (usePhase8 && this.deps.pipeline) {
        const retireProposal = createProposal({
          action: "retire",
          subject: r.blueprintId,
          rationale: `Retire ${r.blueprintId}: ${r.reason}`,
          source: "meta_agent",
        })
        const trace = await this.runProposal(retireProposal, async () => {
          if (this.deps.manualRetireBlueprint) {
            await this.deps.manualRetireBlueprint(r.blueprintId)
          }
        })
        proposalsPhase8.push(trace)
        if (!trace.rollout?.applied) continue
      }
      await this.deps.orgMemory.record("agent_retired", r.blueprintId, {
        role: r.role,
        reason: r.reason,
      })
    }

    // 5. MetaAgent decision (create / delete / merge / split).
    const proposals = discovery.proposals.map((p) => ({
      capabilityId: p.capabilityId,
      evidenceCount: p.evidence.length,
    }))
    const executionStats: Record<
      string,
      { avgScore: number; avgDurationMs: number; usageCount: number; failureRate: number }
    > = {}
    const byRole = new Map<string, ExecutionRecord[]>()
    for (const e of input.recentExecutions) {
      const arr = byRole.get(e.agentRole) ?? []
      arr.push(e)
      byRole.set(e.agentRole, arr)
    }
    for (const [role, execs] of byRole) {
      const scored = execs.map((e) => e.review?.score).filter((s): s is number => s !== undefined)
      const durations = execs.map((e) => e.durationMs ?? 0).filter((d) => d > 0)
      const failures = execs.filter((e) => e.status === "failed").length
      executionStats[role] = {
        avgScore: scored.length > 0 ? scored.reduce((a, b) => a + b, 0) / scored.length : 0,
        avgDurationMs:
          durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
        usageCount: execs.length,
        failureRate: execs.length > 0 ? failures / execs.length : 0,
      }
    }
    const changePlan = this.deps.metaAgent.decide({
      capabilities: reloadedCapabilities,
      retirements,
      proposals,
      executionStats,
    })

    if (usePhase8 && this.deps.pipeline) {
      // Phase 8 path: each MetaAgent decision becomes a Proposal.
      for (const d of changePlan.decisions) {
        const prop = fromAgentChange(d)
        const trace = await this.runProposal(prop)
        proposalsPhase8.push(trace)
        if (!(trace.pipelineApproved && trace.rollout?.applied)) continue

        if (d.action === "delete") {
          await this.deps.orgMemory.record("agent_retired", d.agentRole, { reason: d.reason })
        } else if (d.action === "merge") {
          await this.deps.orgMemory.record("agent_merged", d.agentRole, { target: d.targetRole })
        } else if (d.action === "split") {
          await this.deps.orgMemory.record("agent_split", d.agentRole, { target: d.targetRole })
        } else if (d.action === "create") {
          if (birthBudget >= maxAgents) {
            blockedBy.push(`maxAgents: create decision '${d.agentRole}' rejected`)
            continue
          }
          birthBudget++
          await this.deps.orgMemory.record("agent_born", d.agentRole, { reason: d.reason })
        }
      }
    } else {
      // Phase 6-7 path: direct recording (no pipeline gating).
      // merge/split actions require DigitalTwin apply() to actually mutate
      // the blueprint graph (retire subject, link/clone target). Without
      // DIGITAL_TWIN_ENABLED, we'd be writing orgMemory events without
      // changing the graph — a silent drift between recorded state and
      // reality. Reject explicitly so the caller can re-run with the
      // simulation engine enabled (Phase 8+ path).
      for (const d of changePlan.decisions) {
        if (d.action === "delete") {
          await this.deps.orgMemory.record("agent_retired", d.agentRole, { reason: d.reason })
        } else if (d.action === "merge") {
          blockedBy.push(
            `merge/split requires DIGITAL_TWIN_ENABLED: merge '${d.agentRole}' → '${d.targetRole ?? "?"}' rejected`,
          )
          await this.deps.orgMemory.record("proposal_rejected_by_human", d.agentRole, {
            target: d.targetRole,
            reason: "DIGITAL_TWIN_ENABLED required for real mutation",
            kind: "merge",
          })
        } else if (d.action === "split") {
          blockedBy.push(
            `merge/split requires DIGITAL_TWIN_ENABLED: split '${d.agentRole}' → '${d.targetRole ?? "?"}' rejected`,
          )
          await this.deps.orgMemory.record("proposal_rejected_by_human", d.agentRole, {
            target: d.targetRole,
            reason: "DIGITAL_TWIN_ENABLED required for real mutation",
            kind: "split",
          })
        } else if (d.action === "create") {
          if (birthBudget >= maxAgents) {
            blockedBy.push(`maxAgents: create decision '${d.agentRole}' rejected`)
            continue
          }
          birthBudget++
          await this.deps.orgMemory.record("agent_born", d.agentRole, { reason: d.reason })
        }
      }
    }

    // 6. TeamOptimizer.
    const teamHint = await this.deps.teamOptimizer.suggest({
      graph: input.graphs[0] ?? {
        id: "g-empty",
        nodes: [],
        edges: [],
        capabilities: [],
        createdAt: new Date().toISOString(),
        status: "draft",
      },
      executions: input.recentExecutions,
    })

    if (usePhase8 && this.deps.pipeline) {
      // Phase 8 — convert hint suggestions to proposals, run through pipeline.
      const hintProposals = fromTeamHint(teamHint)
      let applied = 0
      for (const prop of hintProposals) {
        const trace = await this.runProposal(prop)
        proposalsPhase8.push(trace)
        if (trace.pipelineApproved && trace.rollout?.applied) applied++
      }
      await this.deps.orgMemory.record("team_optimized", teamHint.id, {
        suggestions: teamHint.suggestions.length,
        estimatedCost: teamHint.estimatedCost,
        proposalsRouted: hintProposals.length,
        proposalsApplied: applied,
        rolloutMode: this.deps.rollout?.getMode() ?? "n/a",
      })
    } else {
      // Phase 7 — direct materialization.
      const hintsApplied = await this.deps.teamOptimizer.applyHint(teamHint)
      await this.deps.orgMemory.record("team_optimized", teamHint.id, {
        suggestions: teamHint.suggestions.length,
        estimatedCost: teamHint.estimatedCost,
        blueprintsModified: hintsApplied,
      })
    }

    // 7. Final governance check — include births that were successfully applied.
    const finalCaps = await this.deps.registry.listAll()
    const birthBlueprints = births.map(birthResultToBlueprint)
    const allBlueprints = [...input.blueprints, ...birthBlueprints]
    const governance = this.deps.governance.check({
      graphs: input.graphs,
      capabilities: finalCaps,
      blueprints: allBlueprints,
    })
    if (!governance.allowed && !blockedBy.includes(governance.reason)) {
      blockedBy.push(governance.reason)
    }
    if (!governance.allowed) {
      await this.deps.orgMemory.record("governance_violation", "system", {
        reason: governance.reason,
        stage: "final",
        counts: governance.currentCounts,
      })
    }

    const events = await this.deps.orgMemory.listAll()

    const result = {
      proposals: discovery.proposals,
      activated,
      births,
      retirements,
      changePlan,
      teamHint,
      governance,
      blockedBy: Array.from(new Set(blockedBy)),
      recorded: events.length,
      ...(usePhase8 ? { proposalsPhase8 } : {}),
    }
    // Phase 9 — SLO-5: observe the cycle duration. Buckets [1, 5, 10,
    // 30, 60, 120, 300, 600] match the SLO target (P95 ≤ 60s) so
    // dashboards can compute the burn rate.
    metaCycleDuration.observe((Date.now() - cycleStart) / 1000)
    return result
  }

  /**
   * Phase 8.7 — record a prediction-vs-actual measurement against the
   * orchestrator's TruthAudit (if wired). Returns the recorded measurement
   * or null when no TruthAudit is configured.
   */
  recordTruthMeasurement(input: Omit<TruthMeasurement, "recordedAt">): TruthMeasurement | null {
    if (!this.deps.truthAudit) return null
    return this.deps.truthAudit.recordMeasurement(input)
  }

  /**
   * Phase 8.7 — verify a single proposal's prediction against the
   * accumulated measurements. Returns null when TruthAudit is not wired
   * or when no measurements exist yet for the proposal.
   */
  verifyTruth(proposalId: string): TruthVerification | null {
    if (!this.deps.truthAudit) return null
    return this.deps.truthAudit.verify(proposalId)
  }

  /**
   * Phase 8.7 — generate a global calibration report. Returns null when
   * TruthAudit is not wired.
   */
  async truthReport(): Promise<TruthReport | null> {
    if (!this.deps.truthAudit) return null
    return this.deps.truthAudit.report()
  }

  /**
   * Run a proposal through the pipeline + rollout (when wired).
   * Returns a trace; rollout is undefined if no rollout is configured.
   * @param onApplied - Called inside applyMutation when rollout approves.
   */
  private async runProposal(
    proposal: Proposal,
    onApplied?: () => Promise<void>,
  ): Promise<Phase8ProposalTrace> {
    const pipeline = this.deps.pipeline!
    const rollout = this.deps.rollout

    try {
      const result = await pipeline.run(proposal)

      // Phase 11 — HITL gate: check if proposal needs human approval.
      const hitlVerdict = this.deps.governance.checkProposal({
        proposal: result.proposal,
        score: result.score,
      })

      if (hitlVerdict.status === "pending_human" && this.deps.pendingStore) {
        await this.deps.pendingStore.save({
          proposal: result.proposal,
          simulation: result.simulation,
          score: result.score,
        })
        result.proposal.status = "pending_human"

        if (this.deps.telemetry) {
          await this.deps.telemetry.recordEvolution({
            proposalId: result.proposal.id,
            proposalType: result.proposal.action,
            subject: result.proposal.subject,
            simulatedScores: {
              costDelta: result.simulation.costDelta,
              latencyDeltaMs: result.simulation.latencyDeltaMs,
              qualityDelta: result.simulation.qualityDelta,
              riskDelta: result.simulation.riskDelta,
              utility: result.score.utility,
            },
            governanceVerdict: { allowed: true, reason: hitlVerdict.reason },
            rolloutStatus: "skipped",
            approved: false,
          })
        }

        return {
          proposal: result.proposal,
          simulation: result.simulation,
          score: result.score,
          rollout: undefined,
          pipelineApproved: true,
          hitlPaused: true,
        }
      }

      let rolloutResult: RolloutResult | undefined
      if (rollout) {
        rolloutResult = await rollout.apply({
          proposal: result.proposal,
          applyMutation: async () => {
            if (onApplied) await onApplied()
          },
          record: async (p, mode, applied) => {
            await this.deps.orgMemory.record("team_optimized", p.id, {
              proposalId: p.id,
              action: p.action,
              subject: p.subject,
              rolloutMode: mode,
              applied,
              utility: result.score.utility,
            })
          },
          canaryKey: proposal.subject,
        })
      }

      // Phase 10 — record rollout outcome trace if telemetry is wired.
      if (this.deps.telemetry) {
        await this.deps.telemetry.recordEvolution({
          proposalId: result.proposal.id,
          proposalType: result.proposal.action,
          subject: result.proposal.subject,
          simulatedScores: {
            costDelta: result.simulation.costDelta,
            latencyDeltaMs: result.simulation.latencyDeltaMs,
            qualityDelta: result.simulation.qualityDelta,
            riskDelta: result.simulation.riskDelta,
            utility: result.score.utility,
          },
          governanceVerdict: {
            allowed: result.approved,
            reason: result.rejectionReason ?? "approved",
          },
          rolloutStatus: rolloutResult?.applied ? "applied" : (rolloutResult?.mode ?? "skipped"),
          approved: result.approved,
        })
      }

      // Phase 8.7 — auto-record TruthMeasurement so the closed-loop
      // (prediction-vs-reality) accumulates even when no external code calls
      // recordTruthMeasurement. Without this wiring, TruthAudit stayed cold
      // and the calibration report stayed empty in production. See report
      // H1/H2 in the project review.
      //
      // Note: at this point we have the *prediction* (SimulationDelta) but
      // not the *actual* outcome (which needs post-rollout executions). We
      // intentionally do NOT record a TruthMeasurement here — doing so with
      // predicted==actual would poison the calibration report with 100%
      // false-positive accuracy. Future cycles must call
      // `recordTruthMeasurement` with real `actual` deltas (or hook
      // ReplayEngine into the cycle to compute them).
      if (rolloutResult?.applied) {
        // Record the prediction only (no actual) so the calibration report
        // knows we have an open prediction waiting to be resolved. Use
        // sampleSize=0 so verdict correctly reports "insufficient_data".
        recordProposalOutcome({
          truthAudit: this.deps.truthAudit,
          proposalId: result.proposal.id,
          proposalAction: result.proposal.action,
          simulation: {
            costDelta: result.simulation.costDelta,
            latencyDeltaMs: result.simulation.latencyDeltaMs,
            qualityDelta: result.simulation.qualityDelta,
            riskDelta: result.simulation.riskDelta,
          },
          actual: {
            // Empty actuals → truth-audit treats as insufficient_data.
            costDelta: 0,
            latencyDeltaMs: 0,
            qualityDelta: 0,
            riskDelta: 0,
          },
          sampleSize: 0,
        })
      }

      return {
        proposal: result.proposal,
        simulation: result.simulation,
        score: result.score,
        rollout: rolloutResult,
        pipelineApproved: result.approved,
      }
    } catch (err) {
      log.error({ err, action: proposal.action, subject: proposal.subject }, "runProposal failed")
      // Return a safe "failed" trace so the cycle continues.
      return {
        proposal: { ...proposal, status: "rejected" },
        simulation: {
          costDelta: 0,
          latencyDeltaMs: 0,
          qualityDelta: 0,
          riskDelta: 0,
          simulatedAt: new Date().toISOString(),
        },
        score: {
          proposalId: proposal.id,
          qualityGain: 0,
          latencyPenalty: 0,
          costPenalty: 0,
          riskPenalty: 0,
          utility: 0,
          approved: false,
          reason: `pipeline error: ${String(err)}`,
        },
        rollout: undefined,
        pipelineApproved: false,
      }
    }
  }

  /**
   * Phase 9 — Promotion now uses real benchmark quality data via
   * BenchmarkBridge. The pipeline score decides approval based on
   * actual quality deltas, not a hardcoded override.
   *
   * Falls back to auto-approve only when no benchmark bridge is
   * configured (legacy behavior for systems without benchmarks).
   */
  private async runPromotionProposal(proposal: Proposal): Promise<Phase8ProposalTrace> {
    const pipeline = this.deps.pipeline!
    const rollout = this.deps.rollout

    try {
      const result = await pipeline.run(proposal)

      // Phase 11 — HITL gate for promotions.
      const hitlVerdict = this.deps.governance.checkProposal({
        proposal: result.proposal,
        score: result.score,
      })

      if (hitlVerdict.status === "pending_human" && this.deps.pendingStore) {
        await this.deps.pendingStore.save({
          proposal: result.proposal,
          simulation: result.simulation,
          score: result.score,
        })
        result.proposal.status = "pending_human"

        if (this.deps.telemetry) {
          await this.deps.telemetry.recordEvolution({
            proposalId: result.proposal.id,
            proposalType: result.proposal.action,
            subject: result.proposal.subject,
            simulatedScores: {
              costDelta: result.simulation.costDelta,
              latencyDeltaMs: result.simulation.latencyDeltaMs,
              qualityDelta: result.simulation.qualityDelta,
              riskDelta: result.simulation.riskDelta,
              utility: result.score.utility,
            },
            governanceVerdict: { allowed: true, reason: hitlVerdict.reason },
            rolloutStatus: "skipped",
            approved: false,
          })
        }

        return {
          proposal: result.proposal,
          simulation: result.simulation,
          score: result.score,
          rollout: undefined,
          pipelineApproved: true,
          hitlPaused: true,
        }
      }

      // Phase 9 — when benchmark bridge is available, the pipeline
      // produces real quality deltas, so we trust its score.
      // Without bridge, fall back to auto-approve (legacy).
      const hasBridge = !!this.deps.benchmarkBridge
      const approved = hasBridge ? result.approved : true

      let rolloutResult: RolloutResult | undefined
      if (rollout) {
        rolloutResult = await rollout.apply({
          proposal: { ...result.proposal, status: approved ? "approved" : "rejected" },
          applyMutation: async () => {},
          record: async (p, mode, applied) => {
            await this.deps.orgMemory.record("capability_promoted", p.subject, {
              proposalId: p.id,
              rolloutMode: mode,
              applied,
              utility: result.score.utility,
              note: hasBridge
                ? `benchmark-gated: utility=${result.score.utility}, approved=${approved}`
                : "auto-approved: no benchmark bridge configured",
            })
          },
          canaryKey: proposal.subject,
        })
      }

      // Phase 10 — record rollout outcome trace if telemetry is wired.
      if (this.deps.telemetry) {
        await this.deps.telemetry.recordEvolution({
          proposalId: result.proposal.id,
          proposalType: result.proposal.action,
          subject: result.proposal.subject,
          simulatedScores: {
            costDelta: result.simulation.costDelta,
            latencyDeltaMs: result.simulation.latencyDeltaMs,
            qualityDelta: result.simulation.qualityDelta,
            riskDelta: result.simulation.riskDelta,
            utility: result.score.utility,
          },
          governanceVerdict: {
            allowed: approved,
            reason: result.rejectionReason ?? "approved",
          },
          rolloutStatus: rolloutResult?.applied ? "applied" : (rolloutResult?.mode ?? "skipped"),
          approved,
        })
      }

      // Phase 8.7 — auto-record TruthMeasurement for promotion path.
      // Same policy as runProposal(): record the prediction only when the
      // rollout actually applied, with sampleSize=0 so the measurement
      // stays "insufficient_data" until a real `actual` is recorded via
      // recordTruthMeasurement. Never record predicted==actual here —
      // fabricated actuals would poison the calibration report.
      if (approved && rolloutResult?.applied) {
        recordProposalOutcome({
          truthAudit: this.deps.truthAudit,
          proposalId: result.proposal.id,
          proposalAction: result.proposal.action,
          simulation: {
            costDelta: result.simulation.costDelta,
            latencyDeltaMs: result.simulation.latencyDeltaMs,
            qualityDelta: result.simulation.qualityDelta,
            riskDelta: result.simulation.riskDelta,
          },
          actual: {
            // Empty actuals → truth-audit treats as insufficient_data.
            costDelta: 0,
            latencyDeltaMs: 0,
            qualityDelta: 0,
            riskDelta: 0,
          },
          sampleSize: 0,
        })
      }

      return {
        proposal: { ...result.proposal, status: approved ? "approved" : "rejected" },
        simulation: result.simulation,
        score: result.score,
        rollout: rolloutResult,
        pipelineApproved: approved,
      }
    } catch (err) {
      log.error({ err, subject: proposal.subject }, "runPromotionProposal failed")
      return {
        proposal: { ...proposal, status: "rejected" },
        simulation: {
          costDelta: 0,
          latencyDeltaMs: 0,
          qualityDelta: 0,
          riskDelta: 0,
          simulatedAt: new Date().toISOString(),
        },
        score: {
          proposalId: proposal.id,
          qualityGain: 0,
          latencyPenalty: 0,
          costPenalty: 0,
          riskPenalty: 0,
          utility: 0,
          approved: false,
          reason: `pipeline error: ${String(err)}`,
        },
        rollout: undefined,
        pipelineApproved: false,
      }
    }
  }
}

/**
 * Convert AgentBirthResult → AgentBlueprint. Used by MetaOrchestrator
 * to drive manualSaveBlueprint after Phase 8 pipeline approval.
 */
export function birthResultToBlueprint(result: AgentBirthResult): AgentBlueprint {
  return {
    id: result.blueprintId,
    role: result.role,
    displayName: result.displayName,
    goal: `Deliver ${result.displayName} work for parent capability ${result.parentCapability}`,
    systemPrompt: result.systemPrompt,
    capabilities: result.capabilities,
    tools: [],
    preferredModels: [],
    constraints: {
      outputFormat: result.constraints.outputFormat,
      maxTokens: result.constraints.maxTokens,
      temperature: result.constraints.temperature,
    },
    personality: {} as AgentBlueprint["personality"],
    voice: {} as AgentBlueprint["voice"],
    version: result.version,
    parentId: result.parentCapability,
    createdAt: result.createdAt,
    updatedAt: result.createdAt,
    stats: {
      totalTasks: 0,
      totalSuccesses: 0,
      avgScore: 0,
      avgExecutionTimeMs: 0,
    },
    metadata: { parentCapability: result.parentCapability },
  }
}
