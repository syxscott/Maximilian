// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * GoalJudge — goal-completion judging with a four-verdict closed set
 * (hermes-agent goal_judge borrowing).
 *
 * Hermes gates task completion behind an auxiliary-model judge that returns
 * a structured verdict + reason, treats the judge as INJECTABLE
 * infrastructure (the LLM is wired in later; the gate works without it),
 * validates the reply, and fails CLOSED to a conservative verdict when the
 * judge is unusable — an unevaluatable run must never be scored as done.
 *
 * Maximilian adapts this for the meta-system's evaluation lifecycle:
 *   - the verdict set is achieved | partially_achieved | failed | blocked
 *   - the judge function is a parameter (`GoalJudgeFn`); an LLM judge can
 *     be plugged in later without changing callers
 *   - injected verdicts are schema-validated; an invalid reply falls back
 *     to a deterministic keyword judge rather than being trusted
 *   - `goalJudgementToTruthMeasurement` maps a verdict onto the
 *     TruthMeasurement quality axis so TruthAudit can track whether the
 *     meta-system's goal predictions stay calibrated (blocked verdicts are
 *     NOT measurable — they carry no quality claim and would poison the
 *     sample mean with a fake zero)
 */

import { z } from "zod"
import type { ProposalAction } from "./types.js"
import type { TruthAudit } from "./truth-audit.js"
import type { TruthMeasurement } from "./types.js"

/** Closed verdict set (hermes verdict vocabulary, remapped to goal semantics). */
export const GOAL_VERDICTS = ["achieved", "partially_achieved", "failed", "blocked"] as const

export type GoalVerdict = (typeof GOAL_VERDICTS)[number]

export const GoalJudgementSchema = z.object({
  verdict: z.enum(GOAL_VERDICTS),
  /** Why this verdict — required so a judgement is always auditable. */
  reason: z.string().min(1),
  /** Judge self-assessed confidence, 0..1. */
  confidence: z.number().min(0).max(1),
})
export type GoalJudgementCore = z.infer<typeof GoalJudgementSchema>

/** A validated judgement, stamped with which judge produced it. */
export interface GoalJudgement extends GoalJudgementCore {
  /** "judge" = the injected judge replied validly; "fallback" = keyword judge. */
  source: "judge" | "fallback"
}

/** Evidence a judge sees: the goal plus what actually happened. */
export interface GoalEvidence {
  /** Execution records (task outcomes, log excerpts). */
  records?: string[]
  /** Artifact summaries (diffs, test output, deliverable descriptions). */
  artifacts?: string[]
  /** Structured blocker note (e.g. from an explicit block/escalation flow). */
  blockedReason?: string
}

export interface GoalJudgeInput {
  goal: string
  evidence: GoalEvidence
}

/** Injectable judge. LLM-backed implementations go here; may be sync. */
export type GoalJudgeFn = (input: GoalJudgeInput) => Promise<GoalJudgementCore> | GoalJudgementCore

/** A validated judgement plus whether the input was even evaluable. */
export interface GoalJudgeResult extends GoalJudgement {
  /** False when the goal/evidence could not be evaluated at all. */
  evaluated: boolean
}

function fallback(verdict: GoalVerdict, reason: string, confidence: number): GoalJudgeResult {
  return { verdict, reason, confidence, source: "fallback", evaluated: true }
}

function unevaluable(reason: string): GoalJudgeResult {
  return { verdict: "blocked", reason, confidence: 0, source: "fallback", evaluated: false }
}

/**
 * Judge a goal against evidence. `judge` is optional infrastructure: when
 * provided, its reply is schema-validated and any invalid reply falls back
 * to the deterministic keyword judge (a broken judge must not be trusted,
 * but it also must not wedge the pipeline — hermes fail-closed borrowing).
 */
export async function judgeGoal(
  input: GoalJudgeInput,
  judge?: GoalJudgeFn,
): Promise<GoalJudgeResult> {
  const goal = typeof input.goal === "string" ? input.goal.trim() : ""
  if (goal.length === 0) {
    return unevaluable("empty goal — nothing to evaluate")
  }

  if (judge) {
    try {
      const raw = await judge(input)
      const parsed = GoalJudgementSchema.safeParse(raw)
      if (parsed.success) {
        return { ...parsed.data, source: "judge", evaluated: true }
      }
      // Invalid reply: fail over to the keyword judge, keeping the reason
      // auditable (WHY the injected judge was not trusted).
      const issue = parsed.error.issues[0]?.message ?? "invalid shape"
      const fb = keywordGoalJudge(input)
      return {
        ...fb,
        evaluated: true,
        reason: `invalid judge reply (${issue}); keyword fallback: ${fb.reason}`,
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      const fb = keywordGoalJudge(input)
      return {
        ...fb,
        evaluated: true,
        reason: `judge threw (${detail}); keyword fallback: ${fb.reason}`,
      }
    }
  }
  return { ...keywordGoalJudge(input), evaluated: true }
}

// ---------------------------------------------------------------------------
// Deterministic keyword fallback judge
// ---------------------------------------------------------------------------

/** Explicit-block signals outrank completion claims (hermes blocked borrowing). */
const BLOCKED_PATTERNS = [
  /\bblocked\b/i,
  /\bunachievable\b/i,
  /\bcannot proceed\b/i,
  /\bwaiting (?:on|for) (?:a )?(?:human|user|reviewer|input|approval|permission)\b/i,
  /\bmissing (?:permission|credential|dependency|approval)\b/i,
  /\bneeds (?:human|operator) (?:input|decision)\b/i,
]

const ACHIEVED_PATTERNS = [
  /\ball (?:the )?(?:acceptance )?criteria (?:are |were )?met\b/i,
  /\bachieved\b/i,
  /\bcompleted\b/i,
  /\bpassed\b/i,
  /\bsucceeded\b/i,
]

const PARTIAL_PATTERNS = [
  /\bpartially\b/i,
  /\bpart(?:ial| of the)?\b/i,
  /\bremaining\b/i,
  /\bstill (?:todo|outstanding|pending)\b/i,
  /\bin progress\b/i,
  /\bnot all\b/i,
]

const FAILED_PATTERNS = [
  /\bfailed\b/i,
  /\bcould ?n[o']t\b/i,
  /\b(unmet|not met)\b/i,
  /\bthrew? (?:an )?(?:error|exception)\b/i,
]

function matches(text: string, patterns: RegExp[]): number {
  return patterns.filter((p) => p.test(text)).length
}

/**
 * Deterministic, offline judge used for tests and as the fail-safe when no
 * (or a broken) judge is injected. Precedence: explicit blockedReason or
 * block markers → blocked; then achieved/partial/failed marker counts.
 * Confidence is a fixed, monotone function of the marker evidence — no
 * randomness, same input always yields the same judgement.
 */
export function keywordGoalJudge(input: GoalJudgeInput): GoalJudgement {
  const evidence = input.evidence ?? {}
  const records = evidence.records ?? []
  const artifacts = evidence.artifacts ?? []
  const blocked = typeof evidence.blockedReason === "string" ? evidence.blockedReason.trim() : ""

  const text = [...records, ...artifacts].join("\n")
  if (text.trim().length === 0 && blocked.length === 0) {
    return {
      verdict: "blocked",
      reason: "no evidence to evaluate (no records or artifacts)",
      confidence: 0,
      source: "fallback",
    }
  }

  if (blocked.length > 0 || matches(text, BLOCKED_PATTERNS) > 0) {
    const detail = blocked.length > 0 ? blocked : "evidence reports a blocker"
    return {
      verdict: "blocked",
      reason: detail,
      confidence: blocked.length > 0 ? 0.9 : 0.7,
      source: "fallback",
    }
  }

  const achieved = matches(text, ACHIEVED_PATTERNS)
  const partial = matches(text, PARTIAL_PATTERNS)
  const failed = matches(text, FAILED_PATTERNS)

  if (achieved > 0 && failed === 0 && partial === 0) {
    return {
      verdict: "achieved",
      reason: `achievement markers only (${achieved} matched)`,
      confidence: Math.min(0.9, 0.7 + (achieved - 1) * 0.05),
      source: "fallback",
    }
  }
  if (achieved > 0 || partial > 0) {
    // Achievement claimed alongside remaining work or failures.
    const mix =
      achieved > 0 ? "achievement with remaining work or failures" : "progress without completion"
    return {
      verdict: "partially_achieved",
      reason: `${mix} (achieved=${achieved}, partial=${partial}, failed=${failed})`,
      confidence: 0.6,
      source: "fallback",
    }
  }
  if (failed > 0) {
    return {
      verdict: "failed",
      reason: `failure markers only (${failed} matched)`,
      confidence: Math.min(0.9, 0.7 + (failed - 1) * 0.05),
      source: "fallback",
    }
  }
  return {
    verdict: "failed",
    reason: "no recognizable outcome markers in evidence",
    confidence: 0.3,
    source: "fallback",
  }
}

// ---------------------------------------------------------------------------
// Goal-state + TruthMeasurement mappings
// ---------------------------------------------------------------------------

/** Terminal verdicts close the goal lifecycle; partial keeps it open. */
export function verdictIsTerminal(verdict: GoalVerdict): boolean {
  return verdict !== "partially_achieved"
}

/**
 * Map a verdict onto the TruthMeasurement quality axis (0 = nothing, 1 =
 * fully delivered). blocked maps to 0 numerically but is NOT measurable —
 * `goalJudgementToTruthMeasurement` returns null for it so a blocked run
 * never enters TruthAudit's sample mean as a fake zero.
 */
export const GOAL_VERDICT_QUALITY_DELTA: Record<GoalVerdict, number> = {
  achieved: 1,
  partially_achieved: 0.5,
  failed: 0,
  blocked: 0,
}

export interface GoalTruthOptions {
  proposalId: string
  proposalAction: ProposalAction
  /** What the plan predicted (defaults to 1: the goal is achievable in full). */
  predictedQualityDelta?: number
}

/**
 * Build the input for `TruthAudit.recordMeasurement` from a judgement.
 * Returns null for blocked verdicts (no quality claim to calibrate against).
 */
export function goalJudgementToTruthMeasurement(
  judgement: GoalJudgement,
  opts: GoalTruthOptions,
): Omit<TruthMeasurement, "recordedAt"> | null {
  if (judgement.verdict === "blocked") return null
  return {
    proposalId: opts.proposalId,
    proposalAction: opts.proposalAction,
    predicted: {
      costDelta: 0,
      latencyDeltaMs: 0,
      qualityDelta: opts.predictedQualityDelta ?? 1,
      riskDelta: 0,
    },
    actual: {
      costDelta: 0,
      latencyDeltaMs: 0,
      qualityDelta: GOAL_VERDICT_QUALITY_DELTA[judgement.verdict],
      riskDelta: 0,
    },
    sampleSize: 1,
  }
}

/**
 * Record a judgement's quality outcome into a TruthAudit. Blocked verdicts
 * are skipped (returning null) — a blocked goal says nothing about quality.
 */
export function recordGoalJudgement(
  truthAudit: TruthAudit,
  judgement: GoalJudgement,
  opts: GoalTruthOptions,
): TruthMeasurement | null {
  const measurement = goalJudgementToTruthMeasurement(judgement, opts)
  if (measurement === null) return null
  return truthAudit.recordMeasurement(measurement)
}
