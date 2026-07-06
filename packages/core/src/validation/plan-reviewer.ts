/**
 * PlanReviewer — 5-dimension plan quality validator (借鉴 Kosmos plan_reviewer.py).
 *
 * Kosmos's PlanReviewer scores research plans on 5 dimensions (0-10 each):
 *   specificity, relevance, novelty, coverage, feasibility.
 * Approval requires average >= 7.0 AND every dimension >= 5.0, plus
 * structural requirements (≥3 data_analysis tasks, ≥2 distinct types).
 *
 * Maximilian adapts this to validate LLM-generated plans from the
 * Commander before runtime execution. Scoring is heuristic (keyword-
 * based + structural checks) by default; callers can override any
 * dimension with an LLM judge via customScorers.
 */

export const PLAN_REVIEW_DIMENSIONS = [
  "specificity",
  "relevance",
  "novelty",
  "coverage",
  "feasibility",
] as const

export type PlanReviewDimension = (typeof PLAN_REVIEW_DIMENSIONS)[number]

export const DEFAULT_PLAN_WEIGHTS: Record<PlanReviewDimension, number> = {
  specificity: 0.25,
  relevance: 0.25,
  novelty: 0.20,
  coverage: 0.15,
  feasibility: 0.15,
}

export const PLAN_PASS_THRESHOLDS = {
  /** Minimum average score (0-10) across all dimensions. */
  average: 7.0,
  /** Minimum score on any single dimension. */
  minDimension: 5.0,
  /** Minimum number of distinct task types required. */
  minDistinctTypes: 2,
  /** Minimum total task count. */
  minTaskCount: 3,
} as const

export interface PlanLikeTask {
  agentRole?: string
  description?: string
  type?: string
}

export interface PlanLike {
  objective?: string
  tasks?: PlanLikeTask[]
}

export interface PlanReviewOptions {
  weights?: Partial<Record<PlanReviewDimension, number>>
  thresholds?: Partial<typeof PLAN_PASS_THRESHOLDS>
  /** Override per-dimension scorer (returns 0-10). */
  scorers?: Partial<Record<PlanReviewDimension, (plan: PlanLike) => number>>
}

export interface PlanReview {
  approved: boolean
  scores: Record<PlanReviewDimension, number>
  averageScore: number
  minScore: number
  feedback: string
  requiredChanges: string[]
  suggestions: string[]
}

export type DimensionScorer = (plan: PlanLike) => number

export function reviewPlan(plan: PlanLike, options?: PlanReviewOptions): PlanReview {
  const weights = { ...DEFAULT_PLAN_WEIGHTS, ...options?.weights }
  const thresholds = { ...PLAN_PASS_THRESHOLDS, ...options?.thresholds }

  const scores = {} as Record<PlanReviewDimension, number>
  for (const dim of PLAN_REVIEW_DIMENSIONS) {
    const scorer = options?.scorers?.[dim] ?? heuristicScorers[dim]
    scores[dim] = clampScore(scorer(plan))
  }

  const weightedSum = PLAN_REVIEW_DIMENSIONS.reduce(
    (acc, dim) => acc + scores[dim] * weights[dim],
    0,
  )
  const weightTotal = PLAN_REVIEW_DIMENSIONS.reduce((acc, dim) => acc + weights[dim], 0)
  const averageScore = weightTotal > 0 ? weightedSum / weightTotal : 0
  const minScore = Math.min(...PLAN_REVIEW_DIMENSIONS.map((d) => scores[d]))

  const structuralIssues = checkStructuralRequirements(plan, thresholds)
  const requiredChanges: string[] = [...structuralIssues]
  const suggestions: string[] = []

  if (averageScore < thresholds.average) {
    requiredChanges.push(
      `average score ${averageScore.toFixed(2)} below threshold ${thresholds.average}`,
    )
  }
  for (const dim of PLAN_REVIEW_DIMENSIONS) {
    if (scores[dim] < thresholds.minDimension) {
      requiredChanges.push(`${dim} score ${scores[dim].toFixed(2)} below minimum ${thresholds.minDimension}`)
    }
  }

  if (plan.tasks && plan.tasks.length > 0 && plan.tasks.length < thresholds.minTaskCount) {
    suggestions.push(`Plan has ${plan.tasks.length} tasks — consider adding more for better coverage.`)
  }
  if (plan.objective && plan.objective.length < 20) {
    suggestions.push("Objective is short — expand with success criteria or scope boundaries.")
  }
  for (const dim of PLAN_REVIEW_DIMENSIONS) {
    if (scores[dim] < 8) {
      suggestions.push(`${dim}: room for improvement (current ${scores[dim].toFixed(1)}/10)`)
    }
  }

  const approved = requiredChanges.length === 0
  const feedback = approved
    ? `Plan approved (avg ${averageScore.toFixed(2)}, min ${minScore.toFixed(2)}).`
    : `Plan needs revision. Average ${averageScore.toFixed(2)}/min ${minScore.toFixed(2)}. Issues: ${requiredChanges.join("; ")}.`

  return {
    approved,
    scores,
    averageScore,
    minScore,
    feedback,
    requiredChanges,
    suggestions,
  }
}

// ─── Heuristic scorers ───────────────────────────────────────────────

const heuristicScorers: Record<PlanReviewDimension, DimensionScorer> = {
  specificity: (plan) => {
    const tasks = plan.tasks ?? []
    if (tasks.length === 0) return 0
    const concrete = tasks.filter((t) => {
      const desc = (t.description ?? "").toLowerCase()
      // Has a verb + concrete noun? Look for action verbs.
      return /\b(analyze|compute|design|implement|extract|generate|review|test|write|run|fetch|parse|build)\b/.test(desc)
    })
    const ratio = concrete.length / tasks.length
    // Penalize very short descriptions.
    const avgLen =
      tasks.reduce((sum, t) => sum + (t.description?.length ?? 0), 0) / Math.max(tasks.length, 1)
    const lengthBonus = avgLen >= 80 ? 1 : avgLen >= 40 ? 0.5 : 0
    return clampScore(4 + ratio * 4 + lengthBonus * 2)
  },

  relevance: (plan) => {
    const obj = (plan.objective ?? "").toLowerCase()
    if (!obj) return 0
    const tasks = plan.tasks ?? []
    if (tasks.length === 0) return 0
    // Extract key terms from objective (>3 chars), check presence in task descriptions.
    const keyTerms = obj
      .split(/\W+/)
      .filter((w) => w.length > 3)
      .filter((w) => !STOPWORDS.has(w))
    if (keyTerms.length === 0) return 6
    const allDescs = tasks.map((t) => (t.description ?? "").toLowerCase()).join(" ")
    const hits = keyTerms.filter((term) => allDescs.includes(term))
    return clampScore(5 + (hits.length / keyTerms.length) * 5)
  },

  novelty: (plan) => {
    const tasks = plan.tasks ?? []
    if (tasks.length === 0) return 0
    const types = new Set(tasks.map((t) => t.type ?? t.agentRole ?? "unknown"))
    const distinctRatio = Math.min(types.size / tasks.length, 1)
    // More distinct types = more diverse plan.
    return clampScore(4 + distinctRatio * 6)
  },

  coverage: (plan) => {
    const tasks = plan.tasks ?? []
    if (tasks.length === 0) return 0
    const lenScore = Math.min(tasks.length / 6, 1) * 5
    const types = new Set(tasks.map((t) => t.type ?? t.agentRole ?? "unknown"))
    const diversityScore = Math.min(types.size / 3, 1) * 5
    return clampScore(lenScore + diversityScore)
  },

  feasibility: (plan) => {
    const tasks = plan.tasks ?? []
    if (tasks.length === 0) return 0
    // No deps cycle check: shallow BFS over dependsOn.
    const ids = new Set(tasks.map((_, i) => String(i)))
    const dependents = tasks.map((t) => (t as { dependsOn?: string[] }).dependsOn ?? [])
    let hasCycle = false
    // Naive: just check no task depends on itself, and all deps reference valid ids.
    for (let i = 0; i < tasks.length; i++) {
      for (const dep of dependents[i]) {
        if (dep === String(i) || dep === tasks[i].agentRole) {
          hasCycle = true
          break
        }
      }
      if (hasCycle) break
    }
    const baseScore = tasks.length <= 12 ? 8 : 6 // too many tasks = suspect
    return clampScore(hasCycle ? Math.min(baseScore, 5) : baseScore)
  },
}

function checkStructuralRequirements(
  plan: PlanLike,
  thresholds: typeof PLAN_PASS_THRESHOLDS,
): string[] {
  const issues: string[] = []
  const tasks = plan.tasks ?? []
  if (tasks.length < thresholds.minTaskCount) {
    issues.push(`plan has ${tasks.length} tasks, minimum is ${thresholds.minTaskCount}`)
  }
  const types = new Set(tasks.map((t) => t.type ?? t.agentRole ?? "unknown"))
  if (types.size < thresholds.minDistinctTypes) {
    issues.push(`plan uses ${types.size} distinct types, minimum is ${thresholds.minDistinctTypes}`)
  }
  return issues
}

function clampScore(x: number): number {
  if (Number.isNaN(x)) return 0
  if (x < 0) return 0
  if (x > 10) return 10
  return x
}

const STOPWORDS = new Set([
  "the", "this", "that", "with", "from", "into", "have", "been",
  "they", "their", "them", "where", "when", "what", "which", "while",
  "about", "would", "could", "should", "there", "these", "those",
])