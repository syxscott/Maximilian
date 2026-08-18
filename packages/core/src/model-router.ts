/**
 * ModelRouter — automatically selects the best LLM model for a given task.
 *
 * Core idea: every model has a `ModelProfile` describing its strengths, cost
 * tier, and speed tier. When the runtime needs to execute a task, the router
 * scores all registered profiles against the task's characteristics and
 * returns the best match.
 *
 * Matching algorithm (in priority order):
 *   1. Strength match — does the profile's `strengths[]` include the task type?
 *   2. Cost match    — does the profile's `costTier` suit the task complexity?
 *   3. Speed tiebreak — prefer faster models when other signals are equal.
 */

import type { AgentRole } from "./types.js"

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export type CostTier = "low" | "mid" | "high"
export type SpeedTier = "fast" | "medium" | "slow"
export type TaskType = "code" | "reasoning" | "creative" | "general" | "data"
export type TaskComplexity = "simple" | "medium" | "complex"

/**
 * Model Status (借鉴 opencode - ModelStatus).
 * 模型在目录中的生命周期状态。`deprecated` 模型会被 ModelRouter 自动跳过;
 * `alpha`/`beta` 仍参与路由打分(operator 自行决定是否启用)。
 */
export type ModelStatus = "alpha" | "beta" | "deprecated" | "active"

export interface ModelProfile {
  /** Provider id, e.g. "anthropic", "openai". */
  provider: string
  /** Model name, e.g. "claude-3-haiku-20240307". */
  model: string
  /** Task types this model excels at. */
  strengths: TaskType[]
  /** Cost classification. */
  costTier: CostTier
  /** Speed classification. */
  speedTier: SpeedTier
  /** 借鉴 opencode - 默认 "active";deprecated 会被路由器自动跳过 */
  status?: ModelStatus
}

export interface TaskCharacteristics {
  complexity: TaskComplexity
  type: TaskType
  agentRole: AgentRole
}

export interface ModelSelection {
  provider: string
  model: string
}

// ---------------------------------------------------------------------------
// Default profiles
// ---------------------------------------------------------------------------

const DEFAULT_PROFILES: ModelProfile[] = [
  {
    provider: "anthropic",
    model: "claude-3-haiku-20240307",
    strengths: ["general"],
    costTier: "low",
    speedTier: "fast",
  },
  {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    strengths: ["code", "general"],
    costTier: "mid",
    speedTier: "medium",
  },
  {
    provider: "anthropic",
    model: "claude-3-opus-20240229",
    strengths: ["code", "reasoning", "creative"],
    costTier: "high",
    speedTier: "slow",
  },
  {
    provider: "openai",
    model: "gpt-4o",
    strengths: ["reasoning", "general", "data"],
    costTier: "mid",
    speedTier: "medium",
  },
  {
    provider: "openai",
    model: "o1",
    strengths: ["reasoning", "code"],
    costTier: "high",
    speedTier: "slow",
  },
  {
    provider: "google",
    model: "gemini-pro",
    strengths: ["creative", "data", "general"],
    costTier: "mid",
    speedTier: "medium",
  },
]

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/** Score: does the profile's strengths cover the task type? 0-12. */
function strengthScore(profile: ModelProfile, taskType: TaskType): number {
  if (!profile.strengths.includes(taskType)) return 0
  // Small bonus when the task type is the profile's primary strength (first
  // in the array). This breaks ties between models that both cover the type
  // but where one specialises in it (e.g. o1 for reasoning vs opus for code).
  return profile.strengths[0] === taskType ? 12 : 10
}

/**
 * Score: how well does the cost tier match the task complexity?
 *   simple → low (10), mid (5), high (1)
 *   medium → mid (10), low (5), high (5)
 *   complex → high (10), mid (5), low (1)
 */
function costScore(profile: ModelProfile, complexity: TaskComplexity): number {
  const matrix: Record<TaskComplexity, Record<CostTier, number>> = {
    simple: { low: 10, mid: 5, high: 1 },
    medium: { low: 5, mid: 10, high: 5 },
    complex: { low: 1, mid: 5, high: 10 },
  }
  return matrix[complexity][profile.costTier]
}

/**
 * Speed tiebreak bonus. Faster is slightly preferred for simple tasks;
 * slower is acceptable (even slightly preferred) for complex tasks.
 */
function speedBonus(profile: ModelProfile, complexity: TaskComplexity): number {
  const matrix: Record<TaskComplexity, Record<SpeedTier, number>> = {
    simple: { fast: 3, medium: 1, slow: 0 },
    medium: { fast: 1, medium: 3, slow: 1 },
    complex: { fast: 0, medium: 1, slow: 3 },
  }
  return matrix[complexity][profile.speedTier]
}

// ---------------------------------------------------------------------------
// ModelRouter
// ---------------------------------------------------------------------------

export class ModelRouter {
  private profiles: ModelProfile[] = []
  /**
   * M4-fix: rolling success/failure counters keyed by `${provider}/${model}`.
   * Each call to `selectModel()` increments `attempts`; `recordOutcome()`
   * adjusts `successes` based on whether the agent's run was ok or failed.
   * After enough observations (≥ HEALTH_MIN_SAMPLES) a model with a
   * sustained failure rate above `HEALTH_FAILURE_THRESHOLD` is auto-…
   * "alpha" (treated as a warning state) so it's downweighted in subsequent
   * selections without being permanently removed. Callers who want a hard
   * block can switch on `profile.health === "alpha"` themselves.
   */
  private health: Map<string, { attempts: number; successes: number }> = new Map()

  constructor(profiles?: ModelProfile[]) {
    if (profiles) {
      this.profiles = [...profiles]
    }
  }

  /** Register (or overwrite) a model profile. */
  registerProfile(profile: ModelProfile): void {
    const idx = this.profiles.findIndex(
      (p) => p.provider === profile.provider && p.model === profile.model,
    )
    if (idx >= 0) {
      this.profiles[idx] = profile
    } else {
      this.profiles.push(profile)
    }
  }

  /** Return all registered profiles (defensive copy). */
  getProfiles(): ModelProfile[] {
    return [...this.profiles]
  }

  /**
   * Record the outcome of a `selectModel` → agent.execute cycle so the
   * router can downweight models that are observed to be failing in
   * practice. Callers should invoke this from their post-task hook.
   *
   * @param key    `${provider}/${model}` string (the `ModelSelection` shape)
   * @param ok     whether the agent's run succeeded
   *
   * M4-fix: previously the router was a pure scorer with no notion of
   * "this model is failing 80% of the time right now". A regression in
   * upstream quality would silently keep getting routed to the broken
   * model. Now sustained failures (>50% over ≥10 samples) flip the
   * profile's `status` to "alpha" so `selectModel` downweights it via
   * the existing `status` filter.
   */
  recordOutcome(key: string, ok: boolean): void {
    const entry = this.health.get(key) ?? { attempts: 0, successes: 0 }
    entry.attempts += 1
    if (ok) entry.successes += 1
    this.health.set(key, entry)
    if (entry.attempts < HEALTH_MIN_SAMPLES) return
    const failureRate = 1 - entry.successes / entry.attempts
    if (failureRate < HEALTH_FAILURE_THRESHOLD) return
    // Demote: flip status to alpha so `selectModel` keeps the profile
    // eligible (vs `deprecated`, which is filtered out entirely) but
    // signals "treat with caution" via the existing strengthScore logic.
    const [provider, model] = key.split("/", 2) as [string, string]
    const profile = this.profiles.find((p) => p.provider === provider && p.model === model)
    if (profile && profile.status !== "deprecated") {
      profile.status = "alpha"
    }
  }

  /**
   * Read-only health snapshot. Useful for debugging the router from the
   * dashboard or for tests that need to assert outcomes were recorded.
   */
  getHealthSnapshot(): Array<{ key: string; attempts: number; successes: number; failureRate: number }> {
    const out: Array<{ key: string; attempts: number; successes: number; failureRate: number }> = []
    for (const [key, entry] of this.health) {
      out.push({
        key,
        attempts: entry.attempts,
        successes: entry.successes,
        failureRate: entry.attempts === 0 ? 0 : 1 - entry.successes / entry.attempts,
      })
    }
    return out
  }

  /**
   * Select the best model for the given task characteristics.
   *
   * Scoring: strength (0-10) + cost (0-10) + speed (0-3) = max 23.
   * The profile with the highest total wins. Ties are broken by profile
   * registration order (first registered wins).
   */
  selectModel(task: TaskCharacteristics): ModelSelection {
    if (this.profiles.length === 0) {
      // Absolute fallback — no profiles registered.
      return { provider: "anthropic", model: "claude-3-haiku-20240307" }
    }

    // 借鉴 opencode - 跳过 deprecated 模型,它们不应进入打分池
    const eligible = this.profiles.filter((p) => (p.status ?? "active") !== "deprecated")

    if (eligible.length === 0) {
      // 所有候选都被 deprecated 标记 — 退回硬编码 fallback
      return { provider: "anthropic", model: "claude-3-haiku-20240307" }
    }

    let bestProfile = eligible[0]
    let bestScore = -1

    for (const profile of eligible) {
      const score =
        strengthScore(profile, task.type) +
        costScore(profile, task.complexity) +
        speedBonus(profile, task.complexity)

      if (score > bestScore) {
        bestScore = score
        bestProfile = profile
      }
    }

    return { provider: bestProfile!.provider, model: bestProfile!.model }
  }
}

/** Minimum samples before the health feedback can flip a model's status. */
const HEALTH_MIN_SAMPLES = 10
/** Above this failure rate (over HEALTH_MIN_SAMPLES), the model is "alpha". */
const HEALTH_FAILURE_THRESHOLD = 0.5

// ---------------------------------------------------------------------------
// TaskCharacteristics derivation
// ---------------------------------------------------------------------------

/** Map an AgentRole to the most likely TaskType. */
function roleToTaskType(role: AgentRole): TaskType {
  switch (role) {
    case "frontend":
    case "backend":
      return "code"
    case "review":
      return "reasoning"
    case "general":
    default:
      return "general"
  }
}

/**
 * Derive TaskCharacteristics from a Task-like object.
 *
 * Priority for `complexity`:
 *   1. `task.metadata.estimatedComplexity` — when set by the planner LLM
 *      (or Commander fallback). Treats the LLM's signal as authoritative
 *      because it has the full user-request context; keyword heuristics
 *      can only see one task at a time.
 *   2. Keyword + length heuristic — used as the fallback when the planner
 *      didn't provide an estimate (e.g. legacy plans, untrusted input).
 */
export function deriveTaskCharacteristics(task: {
  agentRole: AgentRole
  description: string
  metadata?: Record<string, unknown>
}): TaskCharacteristics {
  // Trust the planner-provided complexity when it's a valid value.
  const declared = task.metadata?.estimatedComplexity
  let complexity: TaskComplexity
  if (declared === "simple" || declared === "medium" || declared === "complex") {
    complexity = declared
  } else {
    // Keyword + length fallback.
    const desc = task.description.toLowerCase()
    const complexKeywords = [
      "refactor",
      "architect",
      "design system",
      "migration",
      "performance",
      "security",
      "distributed",
      "scale",
      "complex",
      "multi-step",
      "end-to-end",
    ]
    const simpleKeywords = [
      "fix typo",
      "rename",
      "update readme",
      "change color",
      "simple",
      "quick",
      "trivial",
      "bump version",
    ]

    if (complexKeywords.some((kw) => desc.includes(kw))) {
      complexity = "complex"
    } else if (simpleKeywords.some((kw) => desc.includes(kw))) {
      complexity = "simple"
    } else if (task.description.length > 500) {
      complexity = "complex"
    } else if (task.description.length < 80) {
      complexity = "simple"
    } else {
      complexity = "medium"
    }
  }

  return {
    complexity,
    type: roleToTaskType(task.agentRole),
    agentRole: task.agentRole,
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a ModelRouter pre-loaded with sensible default profiles. */
export function createDefaultModelRouter(): ModelRouter {
  return new ModelRouter(DEFAULT_PROFILES)
}
