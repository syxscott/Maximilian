/**
 * Adapter that wraps ModelRouter (or EmbeddingRouter) into the
 * ModelSelectorPort interface used by AgentRuntime.
 *
 * ModelSelectorPort.select(role) only receives the role — no task
 * description. This adapter derives coarse-grained task characteristics
 * from the role alone, then lets ModelRouter pick the best provider/model
 * for those characteristics.
 *
 * For description-aware selection, prefer using ModelRouter directly
 * via the runtime's `modelRouter` option (which receives the full task).
 */

import type { ModelRouter } from "./model-router.js";
import type { TaskCharacteristics, TaskComplexity, TaskType } from "./model-router.js";
import type { ModelSelectorPort } from "./runtime.js";
import type { AgentRole } from "./types.js";

/** Coarse characteristics per role. Refined when task description is available. */
const ROLE_CHARACTERISTICS: Record<AgentRole, TaskCharacteristics> = {
  frontend: { type: "code", complexity: "medium", agentRole: "frontend" },
  backend: { type: "code", complexity: "complex", agentRole: "backend" },
  review: { type: "reasoning", complexity: "medium", agentRole: "review" },
  general: { type: "general", complexity: "medium", agentRole: "general" },
};

/** Build a ModelSelectorPort backed by a ModelRouter. */
export function modelRouterAsSelector(modelRouter: ModelRouter): ModelSelectorPort {
  return {
    select(role: AgentRole) {
      const chars = ROLE_CHARACTERISTICS[role] ?? ROLE_CHARACTERISTICS.general;
      const selection = modelRouter.selectModel(chars);
      return {
        provider: selection.provider,
        model: selection.model,
        score: 1,
        reason: `role=${role} type=${chars.type} complexity=${chars.complexity}`,
      };
    },
  };
}

/**
 * Build a ModelSelectorPort that uses an EmbeddingRouter with a
 * description-aware cache. Falls back to the modelRouter-backed selector
 * when the embedding lookup misses.
 */
export function embeddingRouterAsSelector(args: {
  modelRouter: ModelRouter;
  embeddingRouter: { selectModel: (task: { agentRole: AgentRole; description: string }) => Promise<{ provider: string; model: string; source: string }> };
}): ModelSelectorPort {
  return {
    select(role: AgentRole) {
      // EmbeddingRouter requires a description; without one we fall back
      // to the role-only characteristics lookup. Description-aware selection
      // happens via runtime.modelRouter (which gets the full task).
      const chars = ROLE_CHARACTERISTICS[role] ?? ROLE_CHARACTERISTICS.general;
      const selection = args.modelRouter.selectModel(chars);
      return {
        provider: selection.provider,
        model: selection.model,
        score: 1,
        reason: `role=${role} fallback=no-description`,
      };
    },
  };
}

/** Export the role → characteristics map for callers that want to inspect. */
export function characteristicsForRole(role: AgentRole): TaskCharacteristics {
  return ROLE_CHARACTERISTICS[role] ?? ROLE_CHARACTERISTICS.general;
}

export type { TaskType, TaskComplexity };