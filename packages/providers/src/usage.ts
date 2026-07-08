/**
 * Token usage normalization + integrity helpers.
 *
 * Different LLM protocols count prompt-cache tokens differently:
 *  - Anthropic reports cache hits / creations as fields *outside* of
 *    `input_tokens`. So `promptTokens` is already "fresh input" and
 *    cache_read/cache_creation are separate.
 *  - OpenAI-style protocols (OpenAI itself, OpenRouter, DeepSeek, plus every
 *    Chinese router speaking the OpenAI Chat or Responses dialect) include
 *    cached tokens *inside* `prompt_tokens`. `prompt_tokens_details.cached_tokens`
 *    is what you have to subtract to get fresh-input semantics.
 *
 * Use `getFreshInputTokens()` to normalize before any cost or hit-rate
 * calculation, and `isUnpricedUsage()` to flag rows that look like they
 * were missed by the price table.
 */

import { PROVIDER_PRESETS, getProviderPreset } from "./presets/index.js";

export interface UsageLike {
  /** Provider id — e.g. "openai", "anthropic", "openrouter", "deepseek". */
  provider: string;
  /** Total input tokens as reported by the provider (may include cache). */
  promptTokens: number;
  /** Tokens served from provider-side cache (0 if not reported). */
  cacheReadTokens?: number;
  /** Tokens written into provider-side prompt cache (0 for OpenAI-style protocols). */
  cacheCreationTokens?: number;
}

/**
 * Strip the apiFormat-suffix from a preset id to recover its base slug.
 * The generator appends `-openai`, `-anthropic`, `-gemini`, `-responses`,
 * plus numeric `-2`, `-3` to disambiguate variants of the same provider.
 * This regex matches every variant we generate.
 */
function baseSlugOf(id: string): string {
  return id.replace(
    /(-openai|-anthropic|-gemini|-responses|-claudecode|-openai-2|-v|-2|-3|-4|-5|-6|-7|-8|-9|-coding|-openai-3|-claude-code-proxy)*$/,
    "",
  );
}

/**
 * Provider ids whose `promptTokens` field includes cached tokens AND that
 * are NOT in the preset table. Acts as a fallback for callers that pass
 * ad-hoc provider ids (e.g. test fixtures) — known preset ids are routed
 * through `isCacheInclusiveProtocol()` below, which looks at `apiFormat`.
 */
const LEGACY_CACHE_INCLUSIVE_PROVIDERS: ReadonlySet<string> = new Set([
  "openai",
  "openrouter",
  "deepseek",
]);

/**
 * Cache-inclusion is a property of the *protocol*, not the *vendor*. Any
 * provider speaking `openai_chat` or `openai_responses` (including the ~110
 * Chinese routers that proxy those dialects) folds cache reads into the
 * `prompt_tokens` total. Anthropic and Gemini do not.
 *
 * Implementation: we look up the preset's `apiFormat`. A single provider id
 * may have multiple presets (e.g. `deepseek` anthropic-compatible, `deepseek-2`
 * OpenAI-compatible); if ANY variant of the same base slug is openai_chat,
 * we treat the id as cache-inclusive. This matches reality — DeepSeek
 * primary traffic is OpenAI Chat, even though the borrowed CC Switch default
 * is anthropic.
 */
function isCacheInclusiveProtocol(providerId: string): boolean {
  // Quick path: the requested id's own preset is openai_chat/openai_responses.
  const preset = getProviderPreset(providerId);
  if (
    preset &&
    (preset.apiFormat === "openai_chat" ||
      preset.apiFormat === "openai_responses")
  ) {
    return true;
  }
  // Sibling-variant check: any openai_chat/openai_responses preset that
  // shares the base slug indicates the provider is *known* to speak the
  // OpenAI dialect, even if the borrowed default variant is anthropic. E.g.
  // `deepseek` resolves to an anthropic-compatible URL, but `deepseek-2`
  // speaks OpenAI Chat — and most DeepSeek traffic in practice goes over
  // the OpenAI dialect, so we treat the id as cache-inclusive.
  const base = baseSlugOf(providerId);
  for (const p of PROVIDER_PRESETS) {
    if (baseSlugOf(p.id) === base) {
      if (
        p.apiFormat === "openai_chat" ||
        p.apiFormat === "openai_responses"
      ) {
        return true;
      }
    }
  }
  return LEGACY_CACHE_INCLUSIVE_PROVIDERS.has(providerId);
}

/**
 * Return the input token count with cache reads removed.
 * For Anthropic (cache_exclusive), passes through unchanged.
 * For OpenAI-style protocols (cache_inclusive), subtracts cacheReadTokens.
 */
export function getFreshInputTokens(usage: UsageLike): number {
  const cacheRead = usage.cacheReadTokens ?? 0;
  if (isCacheInclusiveProtocol(usage.provider)) {
    return Math.max(0, usage.promptTokens - cacheRead);
  }
  return usage.promptTokens;
}

/**
 * Cache hit rate in [0, 1].
 * Defined as `cacheRead / (promptTokens + cacheCreation)` — i.e. the
 * fraction of total input context that came from cache (write-or-read).
 * For OpenAI-style protocols cacheCreationTokens is always 0, so the
 * denominator collapses to promptTokens (with cacheRead already inside).
 */
export function getCacheHitRate(usage: UsageLike): number {
  const prompt = usage.promptTokens;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheCreation = usage.cacheCreationTokens ?? 0;
  const denom = prompt + cacheCreation;
  if (denom <= 0) return 0;
  return cacheRead / denom;
}

export interface PricedUsage extends UsageLike {
  /** Output tokens as reported by the provider. */
  completionTokens: number;
  statusCode: number;
  /** Total cost in USD as reported by the caller (already computed). */
  totalCostUsd: number;
}

/**
 * Detect "looks like a successful request but cost came out zero".
 * True when: 2xx status, the request actually consumed tokens, and yet
 * the price table didn't match (so cost is $0).
 *
 * Useful as a data-integrity flag in dashboards — a high `unpricedUsage`
 * rate suggests the price table is missing entries for models that are
 * actually being routed to.
 */
export function isUnpricedUsage(usage: PricedUsage): boolean {
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheCreation = usage.cacheCreationTokens ?? 0;
  const hasTokens =
    usage.promptTokens > 0 ||
    usage.completionTokens > 0 ||
    cacheRead > 0 ||
    cacheCreation > 0;
  return (
    usage.statusCode >= 200 &&
    usage.statusCode < 300 &&
    hasTokens &&
    Number.isFinite(usage.totalCostUsd) &&
    usage.totalCostUsd === 0
  );
}