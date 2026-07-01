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

import type { AgentRole } from "./types.js";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export type CostTier = "low" | "mid" | "high";
export type SpeedTier = "fast" | "medium" | "slow";
export type TaskType = "code" | "reasoning" | "creative" | "general" | "data";
export type TaskComplexity = "simple" | "medium" | "complex";

export interface ModelProfile {
  /** Provider id, e.g. "anthropic", "openai". */
  provider: string;
  /** Model name, e.g. "claude-3-haiku-20240307". */
  model: string;
  /** Task types this model excels at. */
  strengths: TaskType[];
  /** Cost classification. */
  costTier: CostTier;
  /** Speed classification. */
  speedTier: SpeedTier;
}

export interface TaskCharacteristics {
  complexity: TaskComplexity;
  type: TaskType;
  agentRole: AgentRole;
}

export interface ModelSelection {
  provider: string;
  model: string;
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
];

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/** Score: does the profile's strengths cover the task type? 0-12. */
function strengthScore(profile: ModelProfile, taskType: TaskType): number {
  if (!profile.strengths.includes(taskType)) return 0;
  // Small bonus when the task type is the profile's primary strength (first
  // in the array). This breaks ties between models that both cover the type
  // but where one specialises in it (e.g. o1 for reasoning vs opus for code).
  return profile.strengths[0] === taskType ? 12 : 10;
}

/**
 * Score: how well does the cost tier match the task complexity?
 *   simple → low (10), mid (5), high (1)
 *   medium → mid (10), low (5), high (5)
 *   complex → high (10), mid (5), low (1)
 */
function costScore(profile: ModelProfile, complexity: TaskComplexity): number {
  const matrix: Record<TaskComplexity, Record<CostTier, number>> = {
    simple:  { low: 10, mid: 5, high: 1 },
    medium:  { low: 5,  mid: 10, high: 5 },
    complex: { low: 1,  mid: 5, high: 10 },
  };
  return matrix[complexity][profile.costTier];
}

/**
 * Speed tiebreak bonus. Faster is slightly preferred for simple tasks;
 * slower is acceptable (even slightly preferred) for complex tasks.
 */
function speedBonus(profile: ModelProfile, complexity: TaskComplexity): number {
  const matrix: Record<TaskComplexity, Record<SpeedTier, number>> = {
    simple:  { fast: 3, medium: 1, slow: 0 },
    medium:  { fast: 1, medium: 3, slow: 1 },
    complex: { fast: 0, medium: 1, slow: 3 },
  };
  return matrix[complexity][profile.speedTier];
}

// ---------------------------------------------------------------------------
// ModelRouter
// ---------------------------------------------------------------------------

export class ModelRouter {
  private profiles: ModelProfile[] = [];

  constructor(profiles?: ModelProfile[]) {
    if (profiles) {
      this.profiles = [...profiles];
    }
  }

  /** Register (or overwrite) a model profile. */
  registerProfile(profile: ModelProfile): void {
    const idx = this.profiles.findIndex(
      (p) => p.provider === profile.provider && p.model === profile.model,
    );
    if (idx >= 0) {
      this.profiles[idx] = profile;
    } else {
      this.profiles.push(profile);
    }
  }

  /** Return all registered profiles (defensive copy). */
  getProfiles(): ModelProfile[] {
    return [...this.profiles];
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
      return { provider: "anthropic", model: "claude-3-haiku-20240307" };
    }

    let bestProfile = this.profiles[0];
    let bestScore = -1;

    for (const profile of this.profiles) {
      const score =
        strengthScore(profile, task.type) +
        costScore(profile, task.complexity) +
        speedBonus(profile, task.complexity);

      if (score > bestScore) {
        bestScore = score;
        bestProfile = profile;
      }
    }

    return { provider: bestProfile!.provider, model: bestProfile!.model };
  }
}

// ---------------------------------------------------------------------------
// TaskCharacteristics derivation
// ---------------------------------------------------------------------------

/** Map an AgentRole to the most likely TaskType. */
function roleToTaskType(role: AgentRole): TaskType {
  switch (role) {
    case "frontend":
    case "backend":
      return "code";
    case "review":
      return "reasoning";
    case "general":
    default:
      return "general";
  }
}

/**
 * Derive TaskCharacteristics from a Task-like object.
 *
 * Uses simple heuristics for complexity (description length and keyword
 * matching). This can be replaced with an LLM-based classifier later.
 */
export function deriveTaskCharacteristics(task: {
  agentRole: AgentRole;
  description: string;
}): TaskCharacteristics {
  const desc = task.description.toLowerCase();

  // Keyword-based complexity heuristic.
  const complexKeywords = [
    "refactor", "architect", "design system", "migration",
    "performance", "security", "distributed", "scale",
    "complex", "multi-step", "end-to-end",
  ];
  const simpleKeywords = [
    "fix typo", "rename", "update readme", "change color",
    "simple", "quick", "trivial", "bump version",
  ];

  let complexity: TaskComplexity;
  if (complexKeywords.some((kw) => desc.includes(kw))) {
    complexity = "complex";
  } else if (simpleKeywords.some((kw) => desc.includes(kw))) {
    complexity = "simple";
  } else if (task.description.length > 500) {
    complexity = "complex";
  } else if (task.description.length < 80) {
    complexity = "simple";
  } else {
    complexity = "medium";
  }

  return {
    complexity,
    type: roleToTaskType(task.agentRole),
    agentRole: task.agentRole,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a ModelRouter pre-loaded with sensible default profiles. */
export function createDefaultModelRouter(): ModelRouter {
  return new ModelRouter(DEFAULT_PROFILES);
}
