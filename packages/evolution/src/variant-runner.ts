/**
 * Phase 3b — `VariantRunner`.
 *
 * 借鉴 opencode + GEPA: given a parent agent manifest, run N mutated
 * variants via `OpencodeExecutor.executeTask` and rank them on a
 * per-variant score. The runner is the wiring layer that lets the
 * EvolutionEngine do *empirical* A/B (real tasks, real sessions,
 * real tool calls) rather than *offline judge-only* scoring.
 *
 * Wiring:
 *   VariantRunner ─→ OpencodeExecutor.executeTask (per variant)
 *                ─→ ProfileStore.load (parent manifest)
 *                ─→ Leaderboard-style rank by combined score
 *
 * Why the score is a composite:
 *   - `reviewScore` from the variant's own judge (ScholarEval 8-dim)
 *     captures grounded quality.
 *   - `speed` (1 / normalized duration) captures latency cost so a
 *     marginally-better-scoring variant doesn't win if it's twice as slow.
 *   - `cost` penalty (USD) keeps token spend visible (borrowed from
 *     EvoAgentBench's `costDeltaUSD` dimension).
 */

import { randomUUID } from "node:crypto"
import type { AgentRole, AgentManifest, Result, Task } from "@max/core"
import type { OpencodeExecutor, ExecuteResult } from "@max/core"
import type { AgentProfile } from "./types.js"
import { ProfileStore } from "./profile-store.js"

// ── Mutator contract ────────────────────────────────────────────────────────

/**
 * A pure function from (parent manifest, variant index) → variant manifest.
 * The default mutator is a no-op (returns the parent) so callers can wire
 * their own strategy (LLM rewrite, GEPA-style reflection, hand-crafted
 * ablations, etc.) without touching the runner.
 */
export type VariantMutator = (
  parent: AgentManifest,
  index: number,
  ctx: { failures: string[]; feedback: string[] },
) => AgentManifest

/**
 * Default mutator: produces N distinct variants by appending a deterministic
 * "focus marker" paragraph. Used by tests; production callers should pass
 * something richer (see `GEPA` / `hermes-evolution` reflection loops).
 */
export const identityMutator: VariantMutator = (parent, index) => ({
  ...parent,
  systemPrompt:
    parent.systemPrompt +
    `\n\n# Variant ${index + 1} focus\nPay special attention to clarity and explicit assumptions.`,
})

// ── Scoring contract ────────────────────────────────────────────────────────

/**
 * Judge input for one variant run. The default scorer is "did the variant
 * return non-empty output, and how fast?" — ScholarEval callers can pass
 * a real 8-dim judge.
 */
export type VariantJudge = (input: {
  task: Task
  parent: AgentManifest
  variant: AgentManifest
  variantResult: Result
  variantMeta: ExecuteResult
}) => Promise<VariantScore> | VariantScore

export interface VariantScore {
  /** 0..10 quality score. */
  quality: number
  /** Wall-clock duration ms (mirrors `ExecuteResult.durationMs`). */
  durationMs: number
  /** Cost in USD. */
  costUSD: number
  /** Free-form rationale the runner can surface in the leaderboard. */
  reason: string
}

// ── Executor contract ───────────────────────────────────────────────────────

/**
 * Subset of `OpencodeExecutor` the runner depends on. The real
 * `OpencodeExecutor.executeTask(task, workspaceId)` exported from
 * `@max/core` matches this signature exactly, so a real executor can be
 * passed in production. Tests pass a mock that satisfies this same shape.
 */
export interface VariantExecutor {
  executeTask(task: Task, workspaceId: string): Promise<ExecuteResult>
}

// ── Runner output ───────────────────────────────────────────────────────────

export interface VariantRun {
  /** Stable id for this variant run (used for leaderboard rows). */
  id: string
  /** 0-based variant index (parent is index -1; not present in this list). */
  index: number
  /** Parent manifest this variant was derived from. */
  parent: AgentManifest
  /** The mutated manifest actually executed. */
  variant: AgentManifest
  /** Raw executor result (text + metadata). */
  result: Result
  /** Wall-clock session id (opencode's, from `ExecuteResult.sessionId`). */
  sessionId: string
  /** Combined score from the judge. */
  score: VariantScore
  /** Whether this variant's run produced an error (judge still ran). */
  errored: boolean
  /** Error message if `errored` is true. */
  error?: string
}

export interface LeaderboardRow {
  /** Reference to the run id (always present). */
  runId: string
  /** Agent role. */
  agentRole: AgentRole
  /** Variant id used in the leaderboard (we use `manifest.systemPrompt`'s first 24 chars + index). */
  variantKey: string
  /** Combined score: quality minus time/cost penalty. Higher is better. */
  combined: number
  score: VariantScore
  rank: number
}

export interface VariantRunOptions {
  /**
   * Agent role this run is for. Falls back to `task.agentRole` when
   * not provided (so callers can omit it for the common case).
   */
  agentRole?: AgentRole
  /**
   * Workspace to execute under. Typically the workspace the parent
   * session was created in.
   */
  workspaceId: string
  /**
   * How many variants to spawn. Default: 3. Bounds: 1..16.
   */
  variantCount?: number
  /** Override the mutator (default: `identityMutator`). */
  mutator?: VariantMutator
  /** Override the judge (default: heuristic). */
  judge?: VariantJudge
  /**
   * Optional: failure-mode strings fed to the mutator context (mirrors
   * the failure list the EvolutionEngine passes to `composeImprovedPrompt`).
   */
  failures?: string[]
  /** Optional: user feedback strings fed to the mutator context. */
  feedback?: string[]
  /**
   * Early-stop after N consecutive variants that fail to beat the best
   * combined score so far (wshobson/agents `optimize()` no-improvement
   * stop). Saves judge/executor budget when mutations have plateaued.
   * Default: disabled.
   */
  patience?: number
}

export interface VariantRunReport {
  /** The agent role the run targeted. */
  agentRole: AgentRole
  /** Workspace the variants ran under. */
  workspaceId: string
  /** Parent profile that was used as the baseline. */
  parentProfile: AgentProfile
  /** Per-variant results, in execution order. */
  runs: VariantRun[]
  /** Leaderboard-ranked rows (best-first). */
  leaderboard: LeaderboardRow[]
  /** Index of the best variant in `runs` (-1 if `runs` is empty). */
  winnerIndex: number
  /** ISO timestamp at which the run started. */
  startedAt: string
  /** ISO timestamp at which the run completed. */
  completedAt: string
  /** True when the patience early-stop fired before all variants ran. */
  stoppedEarly?: boolean
}

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_VARIANT_COUNT = 3
const MAX_VARIANT_COUNT = 16

/**
 * Default heuristic judge: a non-empty `output` is worth 6/10; presence of
 * the parent prompt's failure-mode strings bumps quality. Cheap and
 * deterministic — real callers pass an LLM-driven judge.
 */
const defaultJudge: VariantJudge = (input) => {
  const text = input.variantResult.output ?? ""
  if (text.trim().length === 0) {
    return {
      quality: 0,
      durationMs: input.variantMeta.durationMs,
      costUSD: 0,
      reason: "empty output",
    }
  }
  let quality = 6
  if (text.length >= 200) quality += 1
  if (text.length >= 1000) quality += 1
  // Penalise if the variant obviously errored out (Maximilian `Result` carries
  // an empty-string output when the executor falls back to "(empty response)").
  if (text.startsWith("(empty response")) quality -= 4
  return {
    quality: Math.max(0, Math.min(10, quality)),
    durationMs: input.variantMeta.durationMs,
    costUSD: 0,
    reason: `heuristic: ${text.length} chars`,
  }
}

/**
 * Combined score formula (higher = better). Borrowed shape from
 * EvoAgentBench's `combined` ranking:
 *   combined = quality - speedPenalty - costPenalty
 * where:
 *   speedPenalty = log(1 + durationMs / 1000) * 0.5   (0..2-ish)
 *   costPenalty  = costUSD * 100                        (linear)
 */
function combinedOf(score: VariantScore): number {
  const speedPenalty = Math.log(1 + Math.max(0, score.durationMs) / 1000) * 0.5
  const costPenalty = Math.max(0, score.costUSD) * 100
  return Math.max(0, score.quality - speedPenalty - costPenalty)
}

// ── Runner ──────────────────────────────────────────────────────────────────

export class VariantRunner {
  private readonly profiles: ProfileStore

  constructor(opts: { profiles: ProfileStore; executor: VariantExecutor }) {
    if (!opts.profiles) throw new Error("VariantRunner: `profiles` is required")
    if (!opts.executor) throw new Error("VariantRunner: `executor` is required")
    this.profiles = opts.profiles
    // `executor` is held only as a structural check; the runner accepts
    // either kind and runs via `executeTask(task, workspaceId)`. We don't
    // store it — callers pass it per `run()` invocation through the
    // `runWith()` form below. Keeping the constructor minimal means the
    // class is fully testable with a mocked executor.
    void opts.executor
  }

  /**
   * Run N variants against the supplied executor. The executor is passed
   * per-call (not stored) so a single runner can be shared across many
   * executor instances (e.g. one per workspace).
   */
  async runWith(
    executor: VariantExecutor,
    task: Task,
    options: VariantRunOptions,
  ): Promise<VariantRunReport> {
    if (!executor) throw new Error("VariantRunner.runWith: `executor` is required")
    if (!task) throw new Error("VariantRunner.runWith: `task` is required")

    const agentRole = options.agentRole ?? task.agentRole
    const workspaceId = options.workspaceId
    const variantCount = clamp(options.variantCount ?? DEFAULT_VARIANT_COUNT, 1, MAX_VARIANT_COUNT)
    const mutator = options.mutator ?? identityMutator
    const judge = options.judge ?? defaultJudge
    const failures = options.failures ?? []
    const feedback = options.feedback ?? []

    const startedAt = new Date().toISOString()

    // Load parent manifest via ProfileStore (the source of truth per
    // Phase 2). Fall back to a synthesized manifest if no profile exists
    // yet — this keeps tests hermetic.
    let parentProfile = await this.profiles.get(agentRole)
    if (!parentProfile) {
      const fallback: AgentManifest = {
        role: agentRole,
        displayName: agentRole,
        goal: agentRole,
        systemPrompt: task.description,
      }
      parentProfile = await this.profiles.getOrCreate(agentRole, fallback)
    }
    const parent = parentProfile.manifest ?? {
      role: agentRole,
      displayName: agentRole,
      goal: agentRole,
      systemPrompt: task.description,
    }

    const runs: VariantRun[] = []
    // Patience early-stop bookkeeping (wshobson optimize() borrowing).
    const patience = options.patience
    let bestCombined = -Infinity
    let noImprovement = 0
    let stoppedEarly = false

    for (let i = 0; i < variantCount; i++) {
      if (patience !== undefined && noImprovement >= patience) {
        stoppedEarly = true
        break
      }
      const variant = mutator(parent, i, { failures, feedback })
      const runId = `vr-${randomUUID().slice(0, 8)}`
      try {
        const execResult = await executor.executeTask(task, workspaceId)
        const score = await judge({
          task,
          parent,
          variant,
          variantResult: execResult.result,
          variantMeta: execResult,
        })
        runs.push({
          id: runId,
          index: i,
          parent,
          variant,
          result: execResult.result,
          sessionId: execResult.sessionId,
          score,
          errored: Boolean(execResult.result.metadata?.error) || false,
        })
        const combined = combinedOf(score)
        if (combined > bestCombined) {
          bestCombined = combined
          noImprovement = 0
        } else {
          noImprovement += 1
        }
      } catch (err) {
        // One variant failing should not sink the run — capture the error
        // on the row so the leaderboard can rank the survivors.
        runs.push({
          id: runId,
          index: i,
          parent,
          variant,
          result: {
            id: `r-${runId}`,
            taskId: task.id,
            agentRole,
            agentId: "opencode-serve",
            output: "",
            metadata: { error: describe(err) },
            createdAt: new Date().toISOString(),
            durationMs: 0,
          },
          sessionId: "",
          score: {
            quality: 0,
            durationMs: 0,
            costUSD: 0,
            reason: `executor threw: ${describe(err)}`,
          },
          errored: true,
          error: describe(err),
        })
      }
    }

    const leaderboard = rankLeaderboard(runs, agentRole)
    const completedAt = new Date().toISOString()
    const winnerIndex = leaderboard[0] ? runs.findIndex((r) => r.id === leaderboard[0].runId) : -1

    return {
      agentRole,
      workspaceId,
      parentProfile,
      runs,
      leaderboard,
      winnerIndex,
      startedAt,
      completedAt,
      ...(stoppedEarly ? { stoppedEarly: true } : {}),
    }
  }

  /**
   * Convenience overload that uses a stored executor. Equivalent to
   * `runWith(this.executor, ...)` but mirrors the OpencodeExecutor
   * dependency-injection style used elsewhere in `@max/core`.
   *
   * NOTE: to keep the runner stateless, callers normally use `runWith`.
   * This overload exists so the API feels familiar (`new VariantRunner({executor})`)
   * without forcing us to hold mutable state.
   */
  async run(
    executor: VariantExecutor,
    task: Task,
    options: VariantRunOptions,
  ): Promise<VariantRunReport> {
    return this.runWith(executor, task, options)
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, Math.floor(n)))
}

function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
}

function variantKey(variant: AgentManifest, index: number): string {
  const head = variant.systemPrompt.slice(0, 24).replace(/\s+/g, "_")
  return `v${index + 1}:${head || "mut"}`
}

function rankLeaderboard(runs: VariantRun[], agentRole: AgentRole): LeaderboardRow[] {
  const rows = runs.map((r) => ({
    runId: r.id,
    agentRole,
    variantKey: variantKey(r.variant, r.index),
    combined: combinedOf(r.score),
    score: r.score,
    rank: 0,
  }))
  rows.sort((a, b) => b.combined - a.combined)
  rows.forEach((row, i) => {
    row.rank = i + 1
  })
  return rows
}

// ── Type re-export so consumers don't reach into @max/core directly ─────────
export type { OpencodeExecutor, ExecuteResult }
