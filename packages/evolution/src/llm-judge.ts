/**
 * LLM-as-judge pluggable fitness scorer (borrowed from
 * NousResearch/hermes-agent-self-evolution/evolution/core/fitness.py:34-104).
 *
 * Hermes' LLMJudge scores a candidate on three dimensions:
 *   - correctness  (weight 0.5)
 *   - procedure    (weight 0.3)
 *   - conciseness  (weight 0.2)
 * …plus a textual `feedback` string that GEPA can consume reflectively.
 *
 * Maximilian's adaptation: a pluggable `Judge` interface (a function) that
 * the caller passes to `evolve()`. The default implementation is a
 * deterministic marker-based heuristic (matching the previous offline
 * behaviour); callers with a real LLM can pass their own Judge to get
 * LLM-driven scoring without forking the engine.
 *
 * The composite score is:
 *   composite = 0.5*correctness + 0.3*procedure + 0.2*conciseness - lengthPenalty
 *
 * `lengthPenalty` is borrowed from hermes' `fitness.py:91-96`:
 * ramps 0 → 0.3 as artifact size approaches the limit. This is the
 * anti-bloat operator that gives `PROMOTE_MARGIN` real teeth.
 */

import { PROMPT_GROWTH_MAX, PROMPT_MAX_LEN } from "./constraint-gates.js"

export interface JudgeInput {
  candidate: string
  baseline: string
  /** Failure-mode strings from recent metrics. */
  failures: string[]
  /** User feedback notes. */
  feedback: string[]
  /** Score threshold below which a candidate is failing. */
  scoreThreshold: number
  /**
   * Optional rubric context (wshobson/agents plugin-eval borrowing):
   * anchored scoring needs expectations to anchor against — positive and
   * negative trigger cases for the role, and whether the role is a worker
   * (must NOT orchestrate) or an orchestrator.
   */
  rubricContext?: RubricContext
}

export interface RubricContext {
  /** Tasks that should trigger this agent (hit → reward). */
  positives?: string[]
  /** Tasks that should NOT trigger this agent (hit → penalize). */
  negatives?: string[]
  /** "worker" roles are penalized for orchestration language. */
  roleExpectation?: "worker" | "orchestrator"
}

/**
 * Anchored rubric (wshobson/agents plugin-eval eval-judge borrowing):
 * LLM judges score each dimension against explicit anchors instead of
 * vibes. The four dimensions and their anchors:
 *   - trigger F1        1.0 = would trigger on all positives, none of the
 *                         negatives; 0.0 = fires on the wrong tasks
 *   - orchestration     1.0 = worker stays strictly in-role (or an
 *                         orchestrator routes explicitly); 0.0 = worker
 *                         tries to delegate/plan the whole workflow
 *   - output quality    1.0 = concrete, verifiable instructions
 *   - scope calibration 1.0 = scope matches the role's charter exactly
 */
export const RUBRIC_ANCHORS = {
  triggerF1: {
    one: "triggers on every positive case and never on a negative case",
    half: "occasionally misfires on negative cases or misses edge positives",
    zero: "fires on the wrong tasks entirely",
  },
  orchestrationFitness: {
    one: "stays strictly within its role; no delegation beyond its charter",
    half: "occasionally reaches outside its role",
    zero: "tries to orchestrate the whole workflow from a worker seat",
  },
  outputQuality: {
    one: "instructions are concrete, verifiable and testable",
    half: "mostly concrete with a few vague clauses",
    zero: "vague, unverifiable or self-contradictory",
  },
  scopeCalibration: {
    one: "scope matches the charter exactly — nothing more, nothing less",
    half: "scope roughly matches with some drift",
    zero: "scope grossly over- or under-shoots the charter",
  },
} as const

export interface RubricScores {
  /** 0..1 trigger precision/recall against positives/negatives. */
  triggerF1: number
  /** 0..1 — worker stays in role (no orchestration reach-out). */
  orchestrationFitness: number
  /** 0..1 concreteness of instructions. */
  outputQuality: number
  /** 0..1 scope-vs-charter match. */
  scopeCalibration: number
}

export interface JudgeOutput {
  /** 0..1, weighted composite. */
  composite: number
  /** Sub-scores, all 0..1. */
  correctness: number
  procedure: number
  conciseness: number
  /** Subtract 0..0.3 for overlong prompts. */
  lengthPenalty: number
  /** Free-form feedback the engine can record on the decision. */
  feedback: string
  /** Anchored rubric scores when a rubricContext was provided. */
  rubric?: RubricScores
}

export type Judge = (input: JudgeInput) => Promise<JudgeOutput> | JudgeOutput

/** Default offline heuristic judge. Fast, deterministic, no LLM required. */
export const defaultJudge: Judge = (input) => {
  const cand = input.candidate
  const base = input.baseline
  const candLower = cand.toLowerCase()
  const baseLower = base.toLowerCase()

  // Correctness: does the candidate mention any of the failure modes?
  let correctness = 0
  if (input.failures.length === 0) {
    correctness = 0.5
  } else {
    let hits = 0
    for (const f of input.failures) {
      if (candLower.includes(f.toLowerCase().slice(0, 40))) hits += 1
    }
    correctness = Math.min(1, hits / Math.max(1, input.failures.length))
  }

  // Procedure: does the candidate add explicit structure ("# section", "1.")?
  const procedureMarkers = [
    /#\s+\w+/, // markdown heading
    /^\d+\.\s/m, // numbered list
    /-\s+\w+/m, // bullet list
  ]
  const procedureHits = procedureMarkers.filter((re) => re.test(cand)).length
  const procedure = Math.min(1, procedureHits / 2)

  // Conciseness: penalty for being much longer than baseline. 0..1.
  const ratio = cand.length / Math.max(1, base.length)
  const conciseness = ratio <= 1.05 ? 1 : Math.max(0, 1 - (ratio - 1.05) * 2)

  // Length penalty (hermes' anti-bloat operator). Ramps 0 → 0.3 as the
  // candidate approaches PROMPT_MAX_LEN; also penalises overgrowth vs base.
  const growthRatio = cand.length / Math.max(1, base.length)
  const overgrowthPenalty =
    growthRatio > PROMPT_GROWTH_MAX ? Math.min(0.3, (growthRatio - PROMPT_GROWTH_MAX) * 0.5) : 0
  const sizeRatio = cand.length / PROMPT_MAX_LEN
  const sizePenalty = sizeRatio > 0.9 ? Math.min(0.3, (sizeRatio - 0.9) * 3) : 0
  const lengthPenalty = Math.max(overgrowthPenalty, sizePenalty)

  const composite = 0.5 * correctness + 0.3 * procedure + 0.2 * conciseness - lengthPenalty
  const bounded = Math.max(0, Math.min(1, composite))

  // Free-form feedback for the decision reason.
  const reasonParts: string[] = []
  if (correctness < 0.5) reasonParts.push("low failure-mode coverage")
  if (procedure < 0.5) reasonParts.push("weak structure")
  if (conciseness < 0.5) reasonParts.push(`bloated (${(ratio * 100).toFixed(0)}% of base)`)
  if (lengthPenalty > 0) reasonParts.push(`length penalty ${lengthPenalty.toFixed(2)}`)

  const out: JudgeOutput = {
    composite: bounded,
    correctness,
    procedure,
    conciseness,
    lengthPenalty,
    feedback: reasonParts.length > 0 ? reasonParts.join("; ") : "looks balanced",
  }

  if (input.rubricContext) {
    out.rubric = scoreRubric(cand, input.rubricContext)
    if (out.rubric.orchestrationFitness < 0.5) {
      out.feedback += "; rubric: worker reaches outside its role"
    }
    if (out.rubric.triggerF1 < 0.5) {
      out.feedback += "; rubric: weak trigger discrimination"
    }
  }

  return out
}

/**
 * Anchored rubric scoring (wshobson/agents plugin-eval borrowing) —
 * deterministic offline approximation of the four anchored dimensions.
 * Real deployments pass an LLM judge prompted with `RUBRIC_ANCHORS`; the
 * shape of the output stays identical.
 */
function scoreRubric(candidate: string, ctx: RubricContext): RubricScores {
  const lower = candidate.toLowerCase()

  // Trigger F1 against positive/negative cases (substring anchoring).
  const hit = (cases: string[] | undefined) =>
    (cases ?? []).filter((c) => lower.includes(c.toLowerCase().slice(0, 30))).length
  const tp = hit(ctx.positives)
  const fn = Math.max(0, (ctx.positives?.length ?? 0) - tp)
  const fp = hit(ctx.negatives)
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0.5
  const recall = (ctx.positives?.length ?? 0) > 0 ? tp / (tp + fn) : 0.5
  const triggerF1 =
    (ctx.positives?.length ?? 0) + (ctx.negatives?.length ?? 0) === 0
      ? 0.5
      : (2 * (precision * recall)) / Math.max(precision + recall, 1e-9)

  // Orchestration fitness: a worker must not talk like an orchestrator.
  const orchestrationMarkers = [
    /delegate\s+to\s+(other\s+)?agents/,
    /\bspawn\s+subagents?\b/,
    /commander\b/,
    /\bre-?plan\b/,
    /\bdispatch\s+tasks?\b/,
  ]
  const orchestrationHits = orchestrationMarkers.filter((re) => re.test(lower)).length
  const orchestrationFitness =
    ctx.roleExpectation === "worker" ? Math.max(0, 1 - orchestrationHits * 0.5) : 1 // orchestrators are allowed to orchestrate

  // Output quality: concrete, verifiable instruction markers.
  const concreteMarkers = [/\bmust\b/, /\bverify\b/, /\btest\b/, /\bcriteria\b/, /\bacceptance\b/]
  const outputQuality = Math.min(1, concreteMarkers.filter((re) => re.test(lower)).length / 3)

  // Scope calibration: charter keywords (goal-ish nouns) vs body length drift.
  const scopeCalibration = Math.max(0, Math.min(1, 1 - Math.max(0, candidate.length / 4000 - 0.25)))

  return { triggerF1, orchestrationFitness, outputQuality, scopeCalibration }
}

/** Scale a 0..1 composite to 0..10 (matches the existing `reviewScore` scale). */
export function toReviewScore(j: JudgeOutput): number {
  return Math.round(j.composite * 10 * 100) / 100
}
