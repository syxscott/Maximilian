/**
 * ScholarEval — 8-dimension peer-review style evaluation (借鉴 Kosmos scholar_eval.py).
 *
 * Kosmos's ScholarEval scores findings on 8 weighted dimensions:
 *   rigor (0.25), impact (0.20), novelty (0.15), reproducibility (0.15),
 *   clarity (0.10), coherence (0.10), limitations (0.03), ethics (0.02).
 *
 * Thresholds: overall >= 0.75 AND rigor >= 0.70 to pass.
 *
 * Maximilian adapts this as a Result-quality validator. Each Result's output
 * is scored on the 8 dimensions; below-threshold Results can be flagged
 * for stall detection or auto-replanning.
 *
 * Scoring is heuristic (keyword-based) rather than LLM-based to keep
 * validation cheap and deterministic. For higher fidelity, callers can
 * pass an LLM scorer via `customScorers` that overrides the defaults.
 */

export const SCHOLAR_DIMENSIONS = [
  "rigor",
  "impact",
  "novelty",
  "reproducibility",
  "clarity",
  "coherence",
  "limitations",
  "ethics",
] as const

export type ScholarDimension = (typeof SCHOLAR_DIMENSIONS)[number]

/** Default weights sum to 1.0; mirror Kosmos scholar_eval.py:28-50. */
export const DEFAULT_WEIGHTS: Record<ScholarDimension, number> = {
  rigor: 0.25,
  impact: 0.20,
  novelty: 0.15,
  reproducibility: 0.15,
  clarity: 0.10,
  coherence: 0.10,
  limitations: 0.03,
  ethics: 0.02,
}

export const PASS_THRESHOLDS = {
  overall: 0.75,
  rigor: 0.70,
} as const

export interface ScholarEvalScore {
  /** Per-dimension scores in [0, 1]. */
  perDimension: Record<ScholarDimension, number>
  /** Weighted overall score in [0, 1]. */
  overall: number
  /** True if overall >= 0.75 AND rigor >= 0.70. */
  passed: boolean
  /** Which thresholds (if any) failed. */
  failureReasons: string[]
}

/** Optional custom scorer overrides — replace heuristic with LLM judge. */
export type DimensionScorer = (output: string) => number

export interface ScholarEvalOptions {
  weights?: Partial<Record<ScholarDimension, number>>
  thresholds?: { overall?: number; rigor?: number }
  /** Override per-dimension scorer (default: heuristic). */
  scorers?: Partial<Record<ScholarDimension, DimensionScorer>>
}

export function evaluateScholar(output: string, options?: ScholarEvalOptions): ScholarEvalScore {
  const weights = { ...DEFAULT_WEIGHTS, ...options?.weights }
  const thresholds = {
    overall: options?.thresholds?.overall ?? PASS_THRESHOLDS.overall,
    rigor: options?.thresholds?.rigor ?? PASS_THRESHOLDS.rigor,
  }
  const perDimension = {} as Record<ScholarDimension, number>
  for (const dim of SCHOLAR_DIMENSIONS) {
    const scorer = options?.scorers?.[dim] ?? heuristicScorers[dim]
    perDimension[dim] = clamp01(scorer(output))
  }
  const overall = weightedSum(perDimension, weights)
  const failureReasons: string[] = []
  if (overall < thresholds.overall) failureReasons.push(`overall ${overall.toFixed(2)} < ${thresholds.overall}`)
  if (perDimension.rigor < thresholds.rigor) failureReasons.push(`rigor ${perDimension.rigor.toFixed(2)} < ${thresholds.rigor}`)
  return {
    perDimension,
    overall,
    passed: failureReasons.length === 0,
    failureReasons,
  }
}

// ─── Default heuristic scorers ──────────────────────────────────────

const heuristicScorers: Record<ScholarDimension, DimensionScorer> = {
  // Rigor: present quantifiers, citations, statistical language → higher.
  rigor: (text) => keywordScore(text, ["evidence", "data", "study", "experiment", "analysis", "p<", "p =", "n =", "ci", "sample size", "statistical"], 0.2, 0.9),
  // Impact: presence of magnitude words + downstream language.
  impact: (text) => keywordScore(text, ["significant", "important", "implications", "applications", "advance", "novel", "improvement", "outperforms"], 0.3, 0.9),
  // Novelty: presence of "new", "first", "previously unknown".
  novelty: (text) => keywordScore(text, ["new", "novel", "first", "previously", "unprecedented", "introduce"], 0.4, 0.9),
  // Reproducibility: presence of steps, commands, code, configurations.
  reproducibility: (text) => keywordScore(text, ["step", "command", "run", "install", "configure", "```", "npm", "pnpm", "pytest", "test", "make"], 0.2, 0.9),
  // Clarity: text length + paragraph structure.
  clarity: (text) => clarityScore(text),
  // Coherence: paragraph + transition words.
  coherence: (text) => keywordScore(text, ["however", "therefore", "thus", "because", "consequently", "additionally", "furthermore"], 0.4, 0.85),
  // Limitations: explicit discussion of caveats.
  limitations: (text) => keywordScore(text, ["limitation", "caveat", "however", "but", "weakness", "future work", "not yet", "scope"], 0.5, 0.85),
  // Ethics: presence of safety/privacy/ethics language.
  ethics: (text) => keywordScore(text, ["privacy", "consent", "bias", "fairness", "harm", "safety", "ethical", "responsible"], 0.7, 0.8),
}

function keywordScore(text: string, keywords: string[], baseScore: number, maxScore: number): number {
  if (!text) return 0
  const lower = text.toLowerCase()
  let hits = 0
  for (const kw of keywords) {
    if (lower.includes(kw)) hits++
  }
  if (hits === 0) return baseScore
  // Each keyword hit adds up to 0.1 toward max.
  const bonus = Math.min(hits / keywords.length, 1) * (maxScore - baseScore)
  return clamp01(baseScore + bonus)
}

function clarityScore(text: string): number {
  if (!text) return 0
  const length = text.length
  // Too short → low clarity (presumed incomplete).
  if (length < 60) return 0.3
  // Healthy 200-2000 chars → high clarity.
  if (length >= 200 && length <= 2000) return 0.85
  // Long but not too long → OK.
  if (length <= 5000) return 0.7
  // Very long → start penalizing.
  return 0.5
}

function weightedSum(scores: Record<ScholarDimension, number>, weights: Record<ScholarDimension, number>): number {
  let sum = 0
  let weightTotal = 0
  for (const dim of SCHOLAR_DIMENSIONS) {
    sum += scores[dim] * weights[dim]
    weightTotal += weights[dim]
  }
  return weightTotal > 0 ? sum / weightTotal : 0
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}