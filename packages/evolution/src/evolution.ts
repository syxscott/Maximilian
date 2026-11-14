/**
 * Phase 6 — Agent Evolution.
 *
 *   shouldEvolve(profile, recent)
 *     → true if profile.totalTasks >= MIN_SAMPLES
 *         AND (mean(recent.reviewScore) < SCORE_THRESHOLD
 *              OR acceptanceRate(recent) < ACCEPTANCE_THRESHOLD)
 *
 *   evolve(profile, ...)
 *     1. compose an "improved" system prompt that addresses the failure modes
 *     2. validate it against constraint gates (size, growth, role marker,
 *        secret leak) — borrowed from hermes-evolution/evolution/core/constraints.py
 *     3. register it as the next version (v1 → v2, etc.)
 *     4. score via pluggable Judge (default: offline heuristic; LLM
 *        callers can pass their own)
 *     5. promote if newScore > oldScore + MARGIN, else archive
 *
 * The "A/B" evaluation is now pluggable: the default `defaultJudge` is a
 * deterministic offline heuristic; a real LLM can be passed as `judge` to
 * the engine constructor for live re-scoring.
 *
 * All persisted text passes through `scrubSecrets` (hermes-evolution
 * SECRET_PATTERNS) before being written to `goodExample` / `userFeedback`.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import type { AgentRole, AgentManifest } from "@max/core"
import {
  AgentVersionSchema,
  type AgentProfile,
  type AgentVersion,
  type EvolutionDecision,
  type MetricRecord,
} from "./types.js"
import { ProfileStore } from "./profile-store.js"
import type { MetricsStoreLike } from "./metrics-store.js"
import { readModifyWriteAtomic, writeFileAtomic } from "./atomic.js"
import { validateCandidate, type GateResult } from "./constraint-gates.js"
import { lintPromptShape, summarizeViolations, type LintViolation } from "./artifact-lint.js"
import { scrubSecrets, containsSecret } from "./secret-scrub.js"
import { defaultJudge, toReviewScore, type Judge, type JudgeInput } from "./llm-judge.js"
import { resolveFamilyRow, type EvolutionDecisionShipGate } from "./ship-gates.js"
import { EvolutionBudgetGate } from "./budget-gate.js"

export const SCORE_THRESHOLD = 6.0
export const ACCEPTANCE_THRESHOLD = 0.5
export const MIN_SAMPLES = 10
export const AB_SAMPLE_SIZE = 3
export const PROMOTE_MARGIN = 0.5

export interface EvolutionConfig {
  scoreThreshold: number
  acceptanceThreshold: number
  minSamples: number
  abSampleSize: number
  promoteMargin: number
}

export const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
  scoreThreshold: SCORE_THRESHOLD,
  acceptanceThreshold: ACCEPTANCE_THRESHOLD,
  minSamples: MIN_SAMPLES,
  abSampleSize: AB_SAMPLE_SIZE,
  promoteMargin: PROMOTE_MARGIN,
}

/**
 * Judge budget (backtest.md:18-55 borrowing): before a cycle starts, the
 * estimated judge cost is checked against the limit; over budget → no new
 * case starts. The spent total persists in durable state via
 * {@link EvolutionBudgetGate}.
 */
export interface EvolutionBudgetOptions {
  /** Total budget for judge calls (same unit as estimates, e.g. tokens). */
  limit: number
  /** Estimated cost of ONE judge invocation. Default: 1000. */
  estimatePerJudgeCall?: number | ((input: JudgeInput) => number)
  /** State file (default: <rootDir>/evolution-state.json). */
  statePath?: string
}

export const DEFAULT_JUDGE_CALL_ESTIMATE = 1000

export interface EvolutionEngineOptions {
  /** Pluggable judge for A/B scoring. Default: `defaultJudge` (offline). */
  judge?: Judge
  /** Judge budget gate (backtest.md borrowing). Unset → unbounded. */
  budget?: EvolutionBudgetOptions
}

export class EvolutionEngine {
  private readonly judge: Judge
  private readonly budget: EvolutionBudgetGate | undefined
  private readonly budgetOptions: EvolutionBudgetOptions | undefined

  constructor(
    private rootDir: string,
    private metrics: MetricsStoreLike,
    private profiles: ProfileStore,
    private config: EvolutionConfig = DEFAULT_EVOLUTION_CONFIG,
    opts: EvolutionEngineOptions = {},
  ) {
    this.judge = opts.judge ?? defaultJudge
    this.budgetOptions = opts.budget
    this.budget = opts.budget
      ? new EvolutionBudgetGate({
          statePath: opts.budget.statePath ?? path.join(rootDir, "evolution-state.json"),
          limit: opts.budget.limit,
        })
      : undefined
  }

  private versionsDir(role: string): string {
    return path.join(this.rootDir, "agent-versions", role)
  }

  private versionFile(role: string, id: string): string {
    return path.join(this.versionsDir(role), `${id}.json`)
  }

  private decisionsFile(role: string): string {
    return path.join(this.versionsDir(role), "decisions.json")
  }

  private failedVersionsDir(role: string): string {
    return path.join(this.versionsDir(role), "failed")
  }

  async listVersions(role: AgentRole): Promise<AgentVersion[]> {
    try {
      const entries = await fs.readdir(this.versionsDir(role))
      const versions: AgentVersion[] = []
      for (const e of entries) {
        if (!e.endsWith(".json") || e === "decisions.json") continue
        const raw = await fs.readFile(path.join(this.versionsDir(role), e), "utf-8")
        versions.push(AgentVersionSchema.parse(JSON.parse(raw)))
      }
      return versions.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
      throw err
    }
  }

  async getCurrentVersion(role: AgentRole): Promise<AgentVersion | undefined> {
    const all = await this.listVersions(role)
    return all[all.length - 1]
  }

  static shouldEvolve(
    profile: AgentProfile,
    recent: MetricRecord[],
    config: EvolutionConfig = DEFAULT_EVOLUTION_CONFIG,
  ): boolean {
    if (recent.length < config.minSamples) return false
    const scored = recent.filter((r) => r.reviewScore !== undefined)
    if (scored.length === 0) return false
    const meanScore = scored.reduce((a, r) => a + (r.reviewScore ?? 0), 0) / scored.length
    if (meanScore < config.scoreThreshold) return true
    const accepted = recent.filter((r) => r.userAccepted !== undefined)
    if (accepted.length === 0) return false
    const acceptRate = accepted.filter((r) => r.userAccepted).length / accepted.length
    return acceptRate < config.acceptanceThreshold
  }

  async evolve(role: AgentRole, currentManifest: AgentManifest): Promise<EvolutionDecision> {
    const profile = await this.profiles.getOrCreate(role, currentManifest)
    const recent = (await this.metrics.listForRole(role)).slice(-this.config.abSampleSize * 2)
    const current = await this.getCurrentVersion(role)

    const failures = recent.filter(
      (r) => r.error || (r.reviewScore !== undefined && r.reviewScore < this.config.scoreThreshold),
    )
    const feedback = profile.memory.userFeedback.slice(-5).map((e) => e.content)

    // 1. Compose candidate prompt (scrub secrets in feedback first).
    const safeFeedback = feedback.map((f) => scrubSecrets(f))
    const basePrompt = current?.manifest.systemPrompt ?? currentManifest.systemPrompt
    const newSystemPrompt = composeImprovedPrompt(
      basePrompt,
      failures,
      safeFeedback,
      this.config.scoreThreshold,
    )
    const newId = nextVersionId(profile.versions)

    // 2. Constraint gates — borrowed from hermes-evolution/constraints.py,
    //    then the shape-contract lint (hermes c240e65399: a loose prompt
    //    contract accumulated 100k-char artifacts and 443 reference
    //    fragments; candidates that reference incidents instead of stating
    //    rules are rejected before they can be promoted).
    const gate = validateCandidate({
      newSystemPrompt,
      baseSystemPrompt: basePrompt,
    })
    const lint: LintViolation[] = gate.ok ? lintPromptShape({ text: newSystemPrompt }) : []
    if (!gate.ok || lint.length > 0) {
      const rejectReason = !gate.ok
        ? `Constraint gate rejected: ${gate.code} — ${gate.reason}`
        : `Shape lint rejected: ${summarizeViolations(lint)}`
      // Write the rejected candidate to a sibling `failed/` dir for
      // postmortem (mirrors hermes' `evolved_FAILED.md`).
      await fs.mkdir(this.failedVersionsDir(role), { recursive: true })
      const failedPath = path.join(this.failedVersionsDir(role), `${newId}.json`)
      await writeFileAtomic(
        failedPath,
        JSON.stringify(
          {
            id: newId,
            agentRole: role,
            gate,
            lint,
            newSystemPrompt,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      )

      const decision: EvolutionDecision = withShipGate({
        id: `evo-${randomUUID().slice(0, 8)}`,
        agentRole: role,
        fromVersion: current?.id ?? "v0",
        toVersion: newId,
        outcome: "discarded",
        oldAvgScore: 0,
        newAvgScore: 0,
        triggeredAt: new Date().toISOString(),
        reason: rejectReason,
      })
      // Also persist a "stub" AgentVersion under the canonical version file
      // so listVersions and consumers can find it. The `reason` carries the
      // gate detail; `stats.avgScore = 0` indicates "not yet evaluated".
      const rejectedStub: AgentVersion = AgentVersionSchema.parse({
        id: newId,
        agentRole: role,
        manifest: { ...currentManifest, systemPrompt: currentManifest.systemPrompt },
        createdAt: new Date().toISOString(),
        reason: rejectReason.slice(0, 240),
        stats: { totalTasks: 0, avgScore: 0 },
      })
      await fs.mkdir(this.versionsDir(role), { recursive: true })
      await writeFileAtomic(this.versionFile(role, newId), JSON.stringify(rejectedStub, null, 2))
      await this.appendDecision(role, decision)
      return decision
    }

    // 3. Budget gate (backtest.md:18-55 borrowing): estimate the judge
    //    cost BEFORE starting the cycle — over budget, no new case starts
    //    (no candidate is scored, only the refusal is logged).
    const failureStrings = extractFailureModeStrings(failures, this.config.scoreThreshold)
    if (this.budget && this.budgetOptions) {
      const perCall = estimateJudgeCallCost(
        this.budgetOptions.estimatePerJudgeCall,
        basePrompt,
        failureStrings,
        safeFeedback,
        this.config.scoreThreshold,
      )
      // Conservative estimate: old + new + one noise-calibration repeat.
      const estimate = perCall * 3
      const headroom = await this.budget.ensureHeadroom(estimate)
      if (!headroom) {
        const remaining = await this.budget.remaining()
        const newId2 = newId
        await fs.mkdir(this.versionsDir(role), { recursive: true })
        const refusedStub: AgentVersion = AgentVersionSchema.parse({
          id: newId2,
          agentRole: role,
          manifest: { ...currentManifest, systemPrompt: currentManifest.systemPrompt },
          createdAt: new Date().toISOString(),
          reason: `budget_exhausted: estimated ${estimate} > remaining ${remaining} — no new case started`,
          stats: { totalTasks: 0, avgScore: 0 },
        })
        await writeFileAtomic(this.versionFile(role, newId2), JSON.stringify(refusedStub, null, 2))
        const decision: EvolutionDecision = withShipGate({
          id: `evo-${randomUUID().slice(0, 8)}`,
          agentRole: role,
          fromVersion: current?.id ?? "v0",
          toVersion: newId2,
          outcome: "discarded",
          oldAvgScore: 0,
          newAvgScore: 0,
          triggeredAt: new Date().toISOString(),
          reason: `Budget exhausted: estimated judge cost ${estimate} exceeds remaining ${remaining} — stopped before starting a new case.`,
        })
        await this.appendDecision(role, decision)
        return decision
      }
    }

    const candidate: AgentVersion = AgentVersionSchema.parse({
      id: newId,
      agentRole: role,
      manifest: { ...currentManifest, systemPrompt: newSystemPrompt },
      createdAt: new Date().toISOString(),
      reason:
        failures.length > 0
          ? `Addressed ${failures.length} recent failure(s) and ${feedback.length} feedback note(s)`
          : "Heuristic improvement",
      stats: { totalTasks: 0, avgScore: 0 },
    })

    await fs.mkdir(this.versionsDir(role), { recursive: true })
    await writeFileAtomic(this.versionFile(role, newId), JSON.stringify(candidate, null, 2))

    // 4. A/B scoring via the pluggable Judge (default heuristic, or LLM).
    const oldJudge = await this.judge({
      candidate: basePrompt,
      baseline: basePrompt,
      failures: failureStrings,
      feedback: safeFeedback,
      scoreThreshold: this.config.scoreThreshold,
    })

    // Noise calibration (backtest.md:54 borrowing): "A model review is not
    // deterministic. When the budget allows, run the baseline twice on the
    // same cases and count the flips; a candidate has to beat that noise."
    // Only a judge that DECLARES itself non-deterministic (LLM path) pays
    // for the repeat; the deterministic default judge keeps zero noise and
    // the margin behaviour is unchanged.
    let observedFlipNoise = 0
    let judgeCalls = 1
    if (oldJudge.nonDeterministic === true) {
      const baselineRepeat = await this.judge({
        candidate: basePrompt,
        baseline: basePrompt,
        failures: failureStrings,
        feedback: safeFeedback,
        scoreThreshold: this.config.scoreThreshold,
      })
      observedFlipNoise = Math.abs(toReviewScore(baselineRepeat) - toReviewScore(oldJudge))
      judgeCalls += 1
    }

    const newJudge = await this.judge({
      candidate: newSystemPrompt,
      baseline: basePrompt,
      failures: failureStrings,
      feedback: safeFeedback,
      scoreThreshold: this.config.scoreThreshold,
    })
    judgeCalls += 1

    if (this.budget && this.budgetOptions) {
      const perCall = estimateJudgeCallCost(
        this.budgetOptions.estimatePerJudgeCall,
        basePrompt,
        failureStrings,
        safeFeedback,
        this.config.scoreThreshold,
      )
      await this.budget.charge(perCall * judgeCalls)
    }

    // Convert 0..1 composite → 0..10 review score.
    const oldScore = toReviewScore(oldJudge)
    const newScore = toReviewScore(newJudge)
    const deltaScore = newScore - oldScore

    // 5. Promote if new > old + margin. The margin is max(config, observed
    //    flip noise) so a non-deterministic judge must be beaten by more
    //    than its own noise; the length penalty is added on top so
    //    overlong candidates pay an extra cost (Hermes anti-bloat).
    const effectiveMargin =
      Math.max(this.config.promoteMargin, observedFlipNoise) + newJudge.lengthPenalty
    const promoted = newScore > oldScore + effectiveMargin

    if (promoted) {
      candidate.stats.avgScore = newScore
      await writeFileAtomic(this.versionFile(role, newId), JSON.stringify(candidate, null, 2))

      if (current) {
        const retired: AgentVersion = { ...current, retiredAt: new Date().toISOString() }
        await writeFileAtomic(this.versionFile(role, current.id), JSON.stringify(retired, null, 2))
      }

      const updatedProfile: AgentProfile = {
        ...profile,
        currentVersion: newId,
        versions: [...profile.versions, newId],
        manifest: { ...currentManifest, systemPrompt: newSystemPrompt },
      }
      await this.profiles.save(updatedProfile)
    } else {
      // Also persist the candidate in the main versions dir so consumers
      // (tests, leaderboard, decision-log) can find it via listVersions.
      // The `retiredAt` field marks it as "considered, not promoted".
      const rejected: AgentVersion = {
        ...candidate,
        stats: { totalTasks: 0, avgScore: newScore },
        reason: candidate.reason + " (discarded: score did not exceed old + margin)",
      }
      await writeFileAtomic(this.versionFile(role, newId), JSON.stringify(rejected, null, 2))
      // Also write a copy to failed/ for postmortem (gate detail + judge).
      await fs.mkdir(this.failedVersionsDir(role), { recursive: true })
      const failedPath = path.join(this.failedVersionsDir(role), `${newId}.json`)
      await writeFileAtomic(
        failedPath,
        JSON.stringify(
          {
            id: newId,
            agentRole: role,
            gate: {
              ...gate,
              ok: false,
              reason: `score ${newScore.toFixed(2)} ≤ old ${oldScore.toFixed(2)} + margin ${effectiveMargin.toFixed(2)}`,
            },
            newSystemPrompt,
            judge: newJudge,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      )
    }

    const reasonParts: string[] = [
      `judge composite ${newJudge.composite.toFixed(2)} (correctness ${newJudge.correctness.toFixed(2)}, procedure ${newJudge.procedure.toFixed(2)}, conciseness ${newJudge.conciseness.toFixed(2)})`,
    ]
    if (newJudge.lengthPenalty > 0) {
      reasonParts.push(`length penalty ${newJudge.lengthPenalty.toFixed(2)}`)
    }
    if (observedFlipNoise > 0) {
      reasonParts.push(
        `baseline flip noise ${observedFlipNoise.toFixed(2)} (margin widened to beat it)`,
      )
    }
    if (newJudge.feedback) {
      reasonParts.push(newJudge.feedback)
    }
    reasonParts.push(
      `Δ ${deltaScore >= 0 ? "+" : ""}${deltaScore.toFixed(2)} (margin ${effectiveMargin.toFixed(2)})`,
    )

    const decision: EvolutionDecision = withShipGate({
      id: `evo-${randomUUID().slice(0, 8)}`,
      agentRole: role,
      fromVersion: current?.id ?? "v0",
      toVersion: newId,
      outcome: promoted ? "promoted" : "discarded",
      oldAvgScore: oldScore,
      newAvgScore: newScore,
      triggeredAt: new Date().toISOString(),
      reason: promoted
        ? `Promoted: ${reasonParts.join("; ")}.`
        : `Discarded: ${reasonParts.join("; ")}.`,
    })

    await this.appendDecision(role, decision)
    return decision
  }

  private async appendDecision(role: AgentRole, decision: EvolutionDecision): Promise<void> {
    await readModifyWriteAtomic<EvolutionDecision[]>(this.decisionsFile(role), [], (existing) => [
      ...existing,
      decision,
    ])
  }

  /** Public helper: scrub a text blob before persisting to memory. */
  static scrubText(text: string): string {
    return containsSecret(text) ? scrubSecrets(text) : text
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Ship-gate stamp for the decision row (cbm-mcp 7209ae12 borrowing):
 * every decision IS a prompt_rewrite artifact, so the row carries its
 * family's gate state. A family below its held-out audit bar still yields
 * the decision — the row is degraded instead.
 */
function withShipGate<D extends EvolutionDecision>(decision: D): D {
  const row = resolveFamilyRow("prompt_rewrite", undefined)
  const shipGate: EvolutionDecisionShipGate = {
    family: row.family,
    shipped: row.shipped,
    ...(row.degradation ? { degradation: row.degradation } : {}),
  }
  return { ...decision, shipGate }
}

function nextVersionId(versions: string[]): string {
  const nums = versions
    .map((v) => /^v(\d+)$/.exec(v)?.[1])
    .filter((x): x is string => !!x)
    .map((x) => parseInt(x, 10))
  const max = nums.length > 0 ? Math.max(...nums) : 0
  return `v${max + 1}`
}

/** Resolve the per-call cost estimate (flat default when unset). */
function estimateJudgeCallCost(
  estimate: number | ((input: JudgeInput) => number) | undefined,
  basePrompt: string,
  failures: string[],
  feedback: string[],
  scoreThreshold: number,
): number {
  if (typeof estimate === "function") {
    return estimate({
      candidate: basePrompt,
      baseline: basePrompt,
      failures,
      feedback,
      scoreThreshold,
    })
  }
  return estimate ?? DEFAULT_JUDGE_CALL_ESTIMATE
}

/**
 * Compose a new system prompt by appending explicit guidance derived from
 * observed failure modes. Deterministic and offline-friendly; a real LLM can
 * later replace this with a higher-quality rewrite.
 */
function composeImprovedPrompt(
  base: string,
  failures: MetricRecord[],
  feedback: string[],
  scoreThreshold: number,
): string {
  const parts: string[] = [base.trim()]

  const failureModes = extractFailureModeStrings(failures, scoreThreshold)
  if (failureModes.length > 0) {
    parts.push(
      `\n# Failure modes observed in past runs (avoid these)\n` +
        failureModes.map((m, i) => `${i + 1}. ${m}`).join("\n"),
    )
  }
  if (feedback.length > 0) {
    parts.push(`\n# User feedback to honor\n` + feedback.map((f, i) => `${i + 1}. ${f}`).join("\n"))
  }
  parts.push(
    `\n# Output discipline\n` +
      `- Be explicit about every assumption you make.\n` +
      `- If a contract with another agent exists, mirror it exactly.\n` +
      `- Prefer working code over clever code.`,
  )
  return parts.join("\n")
}

function extractFailureModeStrings(failures: MetricRecord[], scoreThreshold: number): string[] {
  const modes: string[] = []
  for (const f of failures) {
    if (f.error) modes.push(`Avoid runtime error: ${f.error.slice(0, 120)}`)
    if (f.reviewScore !== undefined && f.reviewScore < scoreThreshold) {
      modes.push(`Last scored ${f.reviewScore}/10 — be more thorough.`)
    }
  }
  return modes.slice(0, 6)
}

/**
 * Estimate an average score for a given prompt against a set of past
 * records. Kept for backward compatibility — the new `evolve` uses the
 * pluggable Judge instead. Kept exported via `estimateAvgScore` for any
 * external callers.
 */
function estimateAvgScore(prompt: string, recent: MetricRecord[]): number {
  if (recent.length === 0) return 5
  const lower = prompt.toLowerCase()
  const baseAvg =
    recent
      .filter((r) => r.reviewScore !== undefined)
      .reduce((a, r) => a + (r.reviewScore ?? 0), 0) /
    Math.max(1, recent.filter((r) => r.reviewScore !== undefined).length)

  let bonus = 0
  const markers = ["failure", "avoid", "assumption", "thorough", "feedback", "discipline"]
  for (const m of markers) {
    if (lower.includes(m)) bonus += 0.4
  }
  bonus = Math.min(bonus, 2.0)
  return Math.min(10, baseAvg + bonus)
}

export { estimateAvgScore }
export type { GateResult }
