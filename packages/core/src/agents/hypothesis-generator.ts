/**
 * HypothesisGenerator — structured hypothesis generation (借鉴 Kosmos agents/hypothesis_generator.py).
 *
 * Kosmos's HypothesisGeneratorAgent generates multiple testable hypotheses
 * from a research question, optionally using literature context. It scores
 * novelty, testability, and feasibility.
 *
 * Maximilian adapts this as a pluggable generator that:
 *   - Takes a research question + optional context (literature, prior findings)
 *   - Calls a user-supplied `generateFn` to produce hypothesis statements
 *   - Scores each hypothesis on testability, novelty, and clarity heuristics
 *   - Returns structured Hypothesis objects with scores + rationales
 *
 * The actual hypothesis text comes from the LLM (via callback). This module
 * only handles structuring, scoring, and filtering.
 */

export interface Hypothesis {
  id: string
  statement: string
  rationale?: string
  testable: boolean
  testabilityScore: number
  noveltyScore: number
  clarityScore: number
  overallScore: number
  relatedFindings: string[]
  createdAt: string
}

export interface HypothesisGeneratorOptions {
  /** Number of hypotheses to generate (default: 3). */
  numHypotheses?: number
  /** Minimum novelty score (0-1, default: 0.3). */
  minNoveltyScore?: number
  /** Existing findings to mark as related + dedupe against. */
  existingFindings?: string[]
  /** Existing hypotheses to dedupe against. */
  existingHypotheses?: string[]
}

export interface GeneratorContext {
  researchQuestion: string
  domain?: string
  literatureContext?: string[]
  relatedFindings?: string[]
  numRequested: number
}

export type GenerateFn = (ctx: GeneratorContext) => Promise<string[]>

/**
 * Generate hypotheses from a research question.
 *
 * @param researchQuestion  The research question or topic.
 * @param generateFn        Async function that returns hypothesis statements.
 * @param options           Generation options.
 */
export async function generateHypotheses(
  researchQuestion: string,
  generateFn: GenerateFn,
  options?: HypothesisGeneratorOptions & { domain?: string; literatureContext?: string[] },
): Promise<Hypothesis[]> {
  const num = options?.numHypotheses ?? 3
  const minNovelty = options?.minNoveltyScore ?? 0.3
  const existingHyp = options?.existingHypotheses ?? []
  const existingFindings = options?.existingFindings ?? []

  const statements = await generateFn({
    researchQuestion,
    domain: options?.domain,
    literatureContext: options?.literatureContext,
    relatedFindings: existingFindings,
    numRequested: num,
  })

  const results: Hypothesis[] = []
  for (const statement of statements.slice(0, num)) {
    const dedup = noveltyAgainstCorpus(statement, [...existingHyp, ...results.map((r) => r.statement)])
    const noveltyScore = dedup
    const testability = testabilityScore(statement)
    const clarity = clarityScore(statement)
    const overall = (testability + noveltyScore + clarity) / 3

    if (noveltyScore < minNovelty) continue

    results.push({
      id: `hyp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      statement,
      rationale: undefined,
      testable: testability >= 0.5,
      testabilityScore: testability,
      noveltyScore,
      clarityScore: clarity,
      overallScore: overall,
      relatedFindings: existingFindings,
      createdAt: new Date().toISOString(),
    })
  }
  return results
}

/** Score how testable a hypothesis is (has measurable variables?). */
export function testabilityScore(statement: string): number {
  const s = statement.toLowerCase()
  let score = 0
  // Bonus for measurable verbs (handle plural/inflected forms with word-stem match).
  if (/\b(increas\w*|decreas\w*|improv\w*|reduc\w*|correlat\w*|predict\w*|caus\w*|affect\w*)\b/.test(s)) score += 0.3
  // Bonus for quantifiers.
  if (/(\d+%|\d+\s*ms|\d+\s*seconds?|n\s*=|p\s*<)/.test(s)) score += 0.3
  // Bonus for "if/then" structure.
  if (/\b(if|when|while)\b.*\b(then|will|results?)\b/.test(s)) score += 0.2
  // Bonus for test verbs.
  if (/\b(measur\w*|test\w*|evaluat\w*|compar\w*|verif\w*|validat\w*)\b/.test(s)) score += 0.2
  return clamp01(score)
}

/** Score clarity (length, sentence structure, absence of jargon). */
export function clarityScore(statement: string): number {
  const len = statement.length
  if (len < 20) return 0.3
  if (len > 50 && len < 300) return 0.85
  if (len <= 500) return 0.7
  return 0.5
}

/** Compute novelty against existing corpus (max similarity inverted). */
export function noveltyAgainstCorpus(statement: string, existing: ReadonlyArray<string>): number {
  if (existing.length === 0) return 1
  const tokens = new Set(statement.toLowerCase().split(/\W+/).filter((t) => t.length > 2))
  let maxOverlap = 0
  for (const prior of existing) {
    const priorTokens = new Set(prior.toLowerCase().split(/\W+/).filter((t) => t.length > 2))
    let inter = 0
    for (const t of tokens) if (priorTokens.has(t)) inter++
    const union = tokens.size + priorTokens.size - inter
    const overlap = union > 0 ? inter / union : 0
    if (overlap > maxOverlap) maxOverlap = overlap
  }
  return clamp01(1 - maxOverlap)
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}