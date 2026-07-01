/**
 * Token usage normalization + integrity helpers.
 *
 * Different LLM protocols count prompt-cache tokens differently:
 *  - Anthropic reports cache hits / creations as fields *outside* of
 *    `input_tokens`. So `promptTokens` is already "fresh input" and
 *    cache_read/cache_creation are separate.
 *  - OpenAI-style protocols (OpenAI itself, OpenRouter, DeepSeek) include
 *    cached tokens *inside* `prompt_tokens`. `prompt_tokens_details.cached_tokens`
 *    is what you have to subtract to get fresh-input semantics.
 *
 * Use `getFreshInputTokens()` to normalize before any cost or hit-rate
 * calculation, and `isUnpricedUsage()` to flag rows that look like they
 * were missed by the price table.
 */

export interface UsageLike {
  /** Provider id — e.g. "openai", "anthropic", "openrouter", "deepseek". */
  provider: string;
  /** Total input tokens as reported by the provider (may include cache). */
  promptTokens: number;
  /** Tokens served from provider-side cache (0 if not reported). */
  cacheReadTokens?: number;
  /** Tokens written into provider-side cache (0 for OpenAI-style protocols). */
  cacheCreationTokens?: number;
}

/** Provider ids whose `promptTokens` field includes cached tokens. */
const CACHE_INCLUSIVE_PROVIDERS: ReadonlySet<string> = new Set([
  "openai",
  "openrouter",
  "deepseek",
  // Any other OpenAI-compatible base — add here as integrations land.
]);

/**
 * Return the input token count with cache reads removed.
 * For Anthropic (cache_exclusive), passes through unchanged.
 * For OpenAI-style protocols (cache_inclusive), subtracts cacheReadTokens.
 */
export function getFreshInputTokens(usage: UsageLike): number {
  const cacheRead = usage.cacheReadTokens ?? 0;
  if (CACHE_INCLUSIVE_PROVIDERS.has(usage.provider)) {
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