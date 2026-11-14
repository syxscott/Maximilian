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
 *
 * Self-consistency gate (OpenAgentCore sessions/usage.go MeasuredUsage
 * borrowing): a usage breakdown is only trusted when every counter is
 * present and non-negative, cached tokens fit inside input, reasoning
 * tokens fit inside output and the total equals input + output. An
 * inconsistent or incomplete breakdown is treated as UNKNOWN — it yields
 * `null` / `undefined` rather than an entry that double-counts or drops
 * tokens. An explicit zero is a measurement, not an absence.
 */

import { PROVIDER_PRESETS, getProviderPreset } from "./presets/index.js"
import type { ChatResponse } from "./base.js"

export interface UsageLike {
  /** Provider id — e.g. "openai", "anthropic", "openrouter", "deepseek". */
  provider: string
  /** Total input tokens as reported by the provider (may include cache). */
  promptTokens: number
  /** Tokens served from provider-side cache (0 if not reported). */
  cacheReadTokens?: number
  /** Tokens written into provider-side prompt cache (0 for OpenAI-style protocols). */
  cacheCreationTokens?: number
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
  )
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
])

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
  const preset = getProviderPreset(providerId)
  if (preset && (preset.apiFormat === "openai_chat" || preset.apiFormat === "openai_responses")) {
    return true
  }
  // Sibling-variant check: any openai_chat/openai_responses preset that
  // shares the base slug indicates the provider is *known* to speak the
  // OpenAI dialect, even if the borrowed default variant is anthropic. E.g.
  // `deepseek` resolves to an anthropic-compatible URL, but `deepseek-2`
  // speaks OpenAI Chat — and most DeepSeek traffic in practice goes over
  // the OpenAI dialect, so we treat the id as cache-inclusive.
  const base = baseSlugOf(providerId)
  for (const p of PROVIDER_PRESETS) {
    if (baseSlugOf(p.id) === base) {
      if (p.apiFormat === "openai_chat" || p.apiFormat === "openai_responses") {
        return true
      }
    }
  }
  return LEGACY_CACHE_INCLUSIVE_PROVIDERS.has(providerId)
}

/**
 * Return the input token count with cache reads removed.
 * For Anthropic (cache_exclusive), passes through unchanged.
 * For OpenAI-style protocols (cache_inclusive), subtracts cacheReadTokens.
 */
export function getFreshInputTokens(usage: UsageLike): number {
  const cacheRead = usage.cacheReadTokens ?? 0
  if (isCacheInclusiveProtocol(usage.provider)) {
    return Math.max(0, usage.promptTokens - cacheRead)
  }
  return usage.promptTokens
}

/**
 * Cache hit rate in [0, 1].
 * Defined as `cacheRead / (promptTokens + cacheCreation)` — i.e. the
 * fraction of total input context that came from cache (write-or-read).
 * For OpenAI-style protocols cacheCreationTokens is always 0, so the
 * denominator collapses to promptTokens (with cacheRead already inside).
 */
export function getCacheHitRate(usage: UsageLike): number {
  const prompt = usage.promptTokens
  const cacheRead = usage.cacheReadTokens ?? 0
  const cacheCreation = usage.cacheCreationTokens ?? 0
  const denom = prompt + cacheCreation
  if (denom <= 0) return 0
  return cacheRead / denom
}

export interface PricedUsage extends UsageLike {
  /** Output tokens as reported by the provider. */
  completionTokens: number
  statusCode: number
  /** Total cost in USD as reported by the caller (already computed). */
  totalCostUsd: number
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
  const cacheRead = usage.cacheReadTokens ?? 0
  const cacheCreation = usage.cacheCreationTokens ?? 0
  const hasTokens =
    usage.promptTokens > 0 || usage.completionTokens > 0 || cacheRead > 0 || cacheCreation > 0
  return (
    usage.statusCode >= 200 &&
    usage.statusCode < 300 &&
    hasTokens &&
    Number.isFinite(usage.totalCostUsd) &&
    usage.totalCostUsd === 0
  )
}

// ── Self-consistency gate (OpenAgentCore sessions/usage.go MeasuredUsage
//    borrowing) ────────────────────────────────────────────────────────────────

/** Usage shape attached to {@link ChatResponse} and ChatChunk records. */
export type GatedChatUsage = NonNullable<ChatResponse["usage"]>

/** A fully measured, internally consistent token breakdown. */
export interface MeasuredUsage {
  /** Input tokens per the protocol's own semantics (fresh input for Anthropic-style, total input for OpenAI-style). */
  readonly inputTokens: number
  readonly outputTokens: number
  /** As reported by the provider — must equal inputTokens + outputTokens. */
  readonly totalTokens: number
  /** Tokens served from provider-side cache. */
  readonly cachedInputTokens: number
  /** Tokens written into provider-side cache (0 outside Anthropic-style protocols). */
  readonly cacheCreationTokens: number
  /** Reasoning/thinking tokens (subset of outputTokens). */
  readonly reasoningOutputTokens: number
}

/**
 * Cache-counter placement semantics of the protocol the raw record came from.
 * - `"inclusive"` (OpenAI-style): cached tokens sit INSIDE the input counter,
 *   so `cached ≤ input` is enforced.
 * - `"exclusive"` (Anthropic-style): cache counters sit OUTSIDE the input
 *   counter (fresh input is reported separately), so the `cached ≤ input`
 *   bound is waived — only non-negativity still applies.
 */
export type UsageCacheSemantics = "inclusive" | "exclusive"

export interface MeasuredUsageOptions {
  /** Defaults to `"inclusive"`. */
  readonly cacheSemantics?: UsageCacheSemantics
}

/**
 * Field aliases accepted for each counter. Providers and SDK generations
 * spell the same counter differently; the gate reads them all so callers can
 * hand it a raw wire record untouched.
 */
const USAGE_INPUT_KEYS = ["input_tokens", "inputTokens", "prompt_tokens", "promptTokens"] as const
const USAGE_OUTPUT_KEYS = [
  "output_tokens",
  "outputTokens",
  "completion_tokens",
  "completionTokens",
] as const
const USAGE_TOTAL_KEYS = ["total_tokens", "totalTokens"] as const
const USAGE_CACHED_KEYS = [
  "cached_input_tokens",
  "cachedInputTokens",
  "cache_read_input_tokens",
  "cache_read_tokens",
  "cacheReadTokens",
  "cached_tokens",
] as const
const USAGE_CACHE_CREATION_KEYS = [
  "cache_creation_input_tokens",
  "cache_creation_tokens",
  "cacheCreationTokens",
] as const
const USAGE_REASONING_KEYS = [
  "reasoning_output_tokens",
  "reasoningOutputTokens",
  "reasoning_tokens",
  "reasoningTokens",
] as const

/** Extract the first finite number found under any of `keys`. */
function pickUsageNumber(
  raw: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return undefined
}

/** Read a finite number out of a nested details sub-object, or undefined. */
function pickDetailNumber(
  raw: Record<string, unknown>,
  container: string,
  field: string,
): number | undefined {
  const details = raw[container]
  if (typeof details !== "object" || details === null || Array.isArray(details)) return undefined
  const value = (details as Record<string, unknown>)[field]
  if (typeof value === "number" && Number.isFinite(value)) return value
  return undefined
}

/**
 * Cache-read counter across dialects: flat aliases first, then OpenAI Chat's
 * `prompt_tokens_details.cached_tokens`, then OpenAI Responses'
 * `input_tokens_details.cached_tokens`.
 */
function pickCachedTokens(raw: Record<string, unknown>): number | undefined {
  const flat = pickUsageNumber(raw, USAGE_CACHED_KEYS)
  if (flat !== undefined) return flat
  return (
    pickDetailNumber(raw, "prompt_tokens_details", "cached_tokens") ??
    pickDetailNumber(raw, "input_tokens_details", "cached_tokens")
  )
}

/**
 * Reasoning counter across dialects: flat aliases first, then OpenAI Chat's
 * `completion_tokens_details.reasoning_tokens`.
 */
function pickReasoningTokens(raw: Record<string, unknown>): number | undefined {
  const flat = pickUsageNumber(raw, USAGE_REASONING_KEYS)
  if (flat !== undefined) return flat
  return pickDetailNumber(raw, "completion_tokens_details", "reasoning_tokens")
}

/**
 * The MeasuredUsage gate (OpenAgentCore sessions/usage.go borrowing).
 *
 * A raw usage record passes only when:
 *   - every counter is present and non-negative (an explicit 0 counts as a
 *     measurement; a missing counter is an incomplete measurement),
 *   - cached tokens fit inside input (`"inclusive"` semantics only),
 *   - reasoning tokens fit inside output,
 *   - the total equals input + output.
 *
 * Anything else — cached > input, total ≠ sum, negative counters, missing
 * fields, non-numeric garbage — is treated as UNKNOWN and returns `null`.
 * Callers must render that as "usage unknown", never as zero-filled
 * accounting: an unmeasured turn must not look like a free turn.
 */
export function measuredUsage(raw: unknown, options?: MeasuredUsageOptions): MeasuredUsage | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>

  const input = pickUsageNumber(record, USAGE_INPUT_KEYS)
  const output = pickUsageNumber(record, USAGE_OUTPUT_KEYS)
  const total = pickUsageNumber(record, USAGE_TOTAL_KEYS)
  const cached = pickCachedTokens(record)
  const cacheCreation = pickUsageNumber(record, USAGE_CACHE_CREATION_KEYS)
  const reasoning = pickReasoningTokens(record)

  // Every counter must exist — OpenAgentCore: "tokens[key] == nil → return nil".
  if (
    input === undefined ||
    output === undefined ||
    total === undefined ||
    cached === undefined ||
    cacheCreation === undefined ||
    reasoning === undefined
  ) {
    return null
  }

  // Every counter must be non-negative.
  if (input < 0 || output < 0 || total < 0 || cached < 0 || cacheCreation < 0 || reasoning < 0) {
    return null
  }

  const inclusive = (options?.cacheSemantics ?? "inclusive") === "inclusive"
  // cached ≤ input only holds when the protocol folds cache reads into input.
  if (inclusive && cached > input) return null
  // reasoning is always a subset of output.
  if (reasoning > output) return null
  // total must be the exact sum — OpenAgentCore: "total != input+output → nil".
  if (total !== input + output) return null

  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    cachedInputTokens: cached,
    cacheCreationTokens: cacheCreation,
    reasoningOutputTokens: reasoning,
  }
}

/**
 * Consumption seam for provider usage: gate a raw wire usage record and map
 * it onto the {@link ChatResponse} / ChatChunk `usage` shape.
 *
 * Unlike {@link measuredUsage} (which demands a COMPLETE breakdown, per the
 * OpenAgentCore mechanism), this adapter fills the counters some protocols
 * never report with explicit zeros before gating, and derives the total from
 * input + output when the wire does not carry one. What it never does is
 * repair an INCONSISTENT record: `cached > input`, a reported total that is
 * not the sum, negative or non-numeric counters, or a missing input/output
 * pair all yield `undefined` — the turn's usage is unknown.
 */
export function gateUsageShape(
  raw: unknown,
  options?: MeasuredUsageOptions,
): GatedChatUsage | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>

  // Core counters: without them there is no measurement at all.
  const input = pickUsageNumber(record, USAGE_INPUT_KEYS)
  const output = pickUsageNumber(record, USAGE_OUTPUT_KEYS)
  if (input === undefined || output === undefined) return undefined
  if (input < 0 || output < 0) return undefined

  // Optional detail counters: absence means "not reported", which is the
  // explicit-zero measurement the existing format layers always used.
  const cached = pickCachedTokens(record) ?? 0
  const cacheCreation = pickUsageNumber(record, USAGE_CACHE_CREATION_KEYS) ?? 0
  const reasoning = pickReasoningTokens(record) ?? 0
  if (cached < 0 || cacheCreation < 0 || reasoning < 0) return undefined

  // Total: derive when the wire does not carry one; verify when it does.
  const total = pickUsageNumber(record, USAGE_TOTAL_KEYS) ?? input + output
  if (total < 0) return undefined

  const measured = measuredUsage(
    {
      input_tokens: input,
      output_tokens: output,
      total_tokens: total,
      cached_input_tokens: cached,
      cache_creation_input_tokens: cacheCreation,
      reasoning_output_tokens: reasoning,
    },
    options,
  )
  if (!measured) return undefined

  return {
    promptTokens: measured.inputTokens,
    completionTokens: measured.outputTokens,
    totalTokens: measured.totalTokens,
    cacheReadTokens: measured.cachedInputTokens,
    cacheCreationTokens: measured.cacheCreationTokens,
    reasoningTokens: measured.reasoningOutputTokens,
  }
}
