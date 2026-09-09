// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Embedded model-catalog snapshot.
 *
 * Reference values (USD per 1M tokens), best-effort as of 2026-09. This
 * snapshot is the *boot fallback* — the third tier of the catalog loader.
 * When a remote catalog (`MODEL_CATALOG_URL`, e.g. models.dev's api.json)
 * or a warm disk cache is available, these values are superseded; treat
 * the remote catalog as authoritative for pricing.
 *
 * `cost: null` means "price unknown" — callers must surface that as
 * unknown, never estimate it as 0.
 */

import type { ModelCatalogEntry, ModelTier } from "./model-catalog.js"

function e(
  providerId: string,
  modelId: string,
  name: string,
  input: number | null,
  output: number | null,
  context: number,
  opts: Partial<ModelCatalogEntry> = {},
): ModelCatalogEntry {
  return {
    providerId,
    modelId,
    name,
    cost: input === null || output === null ? null : { inputPerMTok: input, outputPerMTok: output },
    limit: { context, output: opts.limit?.output },
    modalities: opts.modalities ?? ["text"],
    reasoning: opts.reasoning ?? false,
    status: opts.status ?? "stable",
    tier: opts.tier ?? inferTierFromPrice(input),
  }
}

/** Price-based tier heuristic (opencode cost-tier borrowing): frontier ≥ $2.5/M in, economy < $0.5/M. */
export function inferTierFromPrice(inputPerMTok: number | null): ModelTier {
  if (inputPerMTok === null) return "standard" // unknown pricing → mid tier, never free
  if (inputPerMTok >= 2.5) return "frontier"
  if (inputPerMTok >= 0.5) return "standard"
  return "economy"
}

export const EMBEDDED_CATALOG: ModelCatalogEntry[] = [
  // Anthropic
  e("anthropic", "claude-opus-4-1", "Claude Opus 4.1", 15, 75, 200_000, { reasoning: true }),
  e("anthropic", "claude-sonnet-4-5", "Claude Sonnet 4.5", 3, 15, 200_000, { reasoning: true }),
  e("anthropic", "claude-haiku-4-5", "Claude Haiku 4.5", 1, 5, 200_000),
  e("anthropic", "claude-3-5-haiku", "Claude 3.5 Haiku", 0.8, 4, 200_000),
  // OpenAI
  e("openai", "gpt-5", "GPT-5", 1.25, 10, 400_000, { reasoning: true }),
  e("openai", "gpt-5-mini", "GPT-5 mini", 0.25, 2, 400_000, { reasoning: true }),
  e("openai", "gpt-4.1", "GPT-4.1", 2, 8, 1_047_576),
  e("openai", "gpt-4.1-mini", "GPT-4.1 mini", 0.4, 1.6, 1_047_576),
  e("openai", "gpt-4o", "GPT-4o", 2.5, 10, 128_000, {
    modalities: ["text", "image"],
  }),
  // Google
  e("google", "gemini-2.5-pro", "Gemini 2.5 Pro", 1.25, 10, 1_048_576, { reasoning: true }),
  e("google", "gemini-2.5-flash", "Gemini 2.5 Flash", 0.3, 2.5, 1_048_576),
  e("google", "gemini-2.0-flash", "Gemini 2.0 Flash", 0.1, 0.4, 1_048_576, {
    modalities: ["text", "image", "audio"],
  }),
  // DeepSeek
  e("deepseek", "deepseek-chat", "DeepSeek V3", 0.27, 1.1, 128_000),
  e("deepseek", "deepseek-reasoner", "DeepSeek R1", 0.55, 2.19, 128_000, { reasoning: true }),
  // Moonshot Kimi
  e("kimi", "kimi-k2", "Kimi K2", 0.6, 2.5, 200_000),
  e("moonshot", "moonshot-v1-128k", "Moonshot v1 128k", 1.7, 8.5, 131_072),
  // Alibaba Qwen
  e("qwen", "qwen3-max", "Qwen3 Max", 1.2, 6, 262_144),
  e("qwen", "qwen3-coder", "Qwen3 Coder", 0.45, 1.5, 262_144),
  // Zhipu GLM
  e("zhipu", "glm-4.6", "GLM-4.6", 0.6, 2.2, 200_000, { reasoning: true }),
  e("zhipu", "glm-4.5-air", "GLM-4.5 Air", 0.15, 0.6, 128_000),
  // xAI
  e("xai", "grok-4", "Grok 4", 3, 15, 256_000, { reasoning: true }),
  e("xai", "grok-3-mini", "Grok 3 mini", 0.3, 0.5, 131_072),
  // Misc
  e("groq", "llama-3.3-70b", "Llama 3.3 70B (Groq)", 0.59, 0.79, 131_072),
  e("mistral", "mistral-large", "Mistral Large", 2, 6, 131_072),
  e("minimax", "minimax-m2", "MiniMax M2", 0.3, 1.2, 204_800, { reasoning: true }),
]
