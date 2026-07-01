/**
 * Build a ModelRouter from the live provider registry.
 *
 * Each registered Provider exposes its `defaultModel` and `id`. We map them
 * to ModelProfiles using a small capability table. The router then scores
 * profiles against task characteristics and returns the best match.
 *
 * EmbeddingRouter wraps this with a similarity cache so repeated
 * descriptions skip classification.
 *
 * Lives in `@max/core` so both the API and the worker can share the same
 * routing bootstrap without one app importing the other's internals.
 */

import { createDefaultModelRouter, ModelRouter, type ModelProfile } from "./model-router.js";
import { EmbeddingRouter, type EmbeddingRouterOptions } from "./embedding-router.js";
import { modelRouterAsSelector } from "./selector-adapter.js";
import type { ModelSelectorPort } from "./runtime.js";
import type { Provider } from "@max/providers";

/** Static capability table keyed by (provider, model). Add entries as new
 *  providers/models are onboarded. */
const CAPABILITY_TABLE: Record<string, { strengths: ModelProfile["strengths"]; costTier: ModelProfile["costTier"]; speedTier: ModelProfile["speedTier"] }> = {
  "anthropic:claude-3-5-sonnet-20241022": { strengths: ["code", "general"], costTier: "mid", speedTier: "medium" },
  "anthropic:claude-3-5-haiku-20241022": { strengths: ["general"], costTier: "low", speedTier: "fast" },
  "anthropic:claude-3-opus-20240229": { strengths: ["code", "reasoning", "creative"], costTier: "high", speedTier: "slow" },
  "anthropic:claude-3-haiku-20240307": { strengths: ["general"], costTier: "low", speedTier: "fast" },
  "openai:gpt-4o": { strengths: ["reasoning", "general", "data"], costTier: "mid", speedTier: "medium" },
  "openai:gpt-4o-mini": { strengths: ["general"], costTier: "low", speedTier: "fast" },
  "openai:gpt-4-turbo": { strengths: ["code", "reasoning"], costTier: "high", speedTier: "slow" },
  "openai:o1": { strengths: ["reasoning", "code"], costTier: "high", speedTier: "slow" },
  "openai:o1-mini": { strengths: ["reasoning"], costTier: "mid", speedTier: "medium" },
};

/** Default capabilities when no entry in CAPABILITY_TABLE. */
const DEFAULT_CAPABILITIES = { strengths: ["general"] as ModelProfile["strengths"], costTier: "mid" as const, speedTier: "medium" as const };

export function buildModelRouter(providers: Provider[]): ModelRouter {
  const profiles: ModelProfile[] = [];
  for (const p of providers) {
    if (!p.isConfigured()) continue;
    const key = `${p.id}:${p.defaultModel}`;
    const cap = CAPABILITY_TABLE[key] ?? DEFAULT_CAPABILITIES;
    profiles.push({
      provider: p.id,
      model: p.defaultModel,
      strengths: cap.strengths,
      costTier: cap.costTier,
      speedTier: cap.speedTier,
    });
  }
  if (profiles.length === 0) {
    // Fall back to defaults so the runtime always has *something* to choose.
    return createDefaultModelRouter();
  }
  return new ModelRouter(profiles);
}

export interface BootstrapResult {
  router: ModelRouter;
  selector: ModelSelectorPort;
  /** EmbeddingRouter for description-aware classification, if an embedder was provided. */
  embeddingRouter?: EmbeddingRouter;
}

/** Build a router + selector + optional EmbeddingRouter in one call. */
export function bootstrapModelRouting(
  providers: Provider[],
  options?: { embedder?: (text: string) => Promise<number[]> },
): BootstrapResult {
  const router = buildModelRouter(providers);
  const selector = modelRouterAsSelector(router);
  if (!options?.embedder) return { router, selector };
  const embeddingRouter = new EmbeddingRouter(router, { embed: options.embedder } as EmbeddingRouterOptions);
  return { router, selector, embeddingRouter };
}