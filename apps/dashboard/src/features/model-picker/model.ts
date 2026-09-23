// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the model-picker feature domain (deepseek
 * ui-settings-models borrowing: the model directory is a curated catalog,
 * not a free-form text input). Unknown/passthrough JSON in → typed view
 * models out; every accessor is defensive because the backing payloads
 * (GET /system/provider-presets, GET /providers, the set-model and
 * test-chat responses) may be missing fields or whole routes. Components
 * only render what this file derives.
 */

/** Canonical category order for the filter chips (cc-switch borrowing). */
export const PRESET_CATEGORY_ORDER = [
  "official",
  "china",
  "international",
  "aggregator",
  "cloud",
  "custom",
] as const

export const CATEGORY_FILTER_ALL = "all"

/** The preset grid shows at most this many cards; the footer folds the rest. */
export const PRESET_GRID_MAX = 24

export interface PresetCardView {
  id: string
  name: string
  category: string
  defaultModel: string
  baseUrl: string
  configured: boolean
  isOfficial: boolean
  isPartner: boolean
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function bool(value: unknown): boolean {
  return value === true
}

// ── Preset catalog (GET /system/provider-presets) ───────────────────────────

/** Defensive passthrough JSON → preset card views. Drops malformed rows. */
export function toPresetCardViews(raw: unknown): PresetCardView[] {
  if (raw == null || typeof raw !== "object") return []
  const presets = (raw as { presets?: unknown }).presets
  if (!Array.isArray(presets)) return []
  const views: PresetCardView[] = []
  for (const item of presets) {
    if (item == null || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const id = str(row.id)
    if (!id) continue
    views.push({
      id,
      name: str(row.name, id),
      category: str(row.category, "custom"),
      defaultModel: str(row.defaultModel),
      baseUrl: str(row.baseUrl),
      configured: bool(row.configured),
      isOfficial: bool(row.isOfficial),
      isPartner: bool(row.isPartner),
    })
  }
  return views
}

/** Distinct categories present in the data, in display order. */
export function presetCategories(presets: PresetCardView[]): string[] {
  const seen = new Set(presets.map((p) => p.category))
  const ordered = PRESET_CATEGORY_ORDER.filter((c) => seen.has(c))
  const extra = [...seen].filter((c) => !(PRESET_CATEGORY_ORDER as readonly string[]).includes(c))
  return [...ordered, ...extra.sort()]
}

/** Category + case-insensitive text filter (name / id / defaultModel). */
export function filterPresetCards(
  presets: PresetCardView[],
  category: string,
  query: string,
): PresetCardView[] {
  const q = query.trim().toLowerCase()
  return presets.filter((p) => {
    if (category !== CATEGORY_FILTER_ALL && p.category !== category) return false
    if (!q) return true
    return (
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.defaultModel.toLowerCase().includes(q)
    )
  })
}

export interface Windowed<T> {
  items: T[]
  shown: number
  total: number
  hidden: number
}

/** Cap the grid at PRESET_GRID_MAX; the footer reports the folded remainder. */
export function windowCards<T>(items: T[], max: number = PRESET_GRID_MAX): Windowed<T> {
  const total = items.length
  const capped = items.slice(0, Math.max(0, max))
  return { items: capped, shown: capped.length, total, hidden: Math.max(0, total - max) }
}

// ── Base-domain matching (defensive URL parsing) ────────────────────────────

/**
 * Hostname of a base URL, defensively parsed. Handles absolute URLs,
 * scheme-less `api.example.com/v1` strings, and refuses garbage. Port and
 * path are dropped — matching is by domain name only.
 */
export function baseUrlHost(url: unknown): string | null {
  if (typeof url !== "string") return null
  const trimmed = url.trim()
  if (!trimmed) return null
  let candidate = trimmed
  // A scheme-less host ("api.deepseek.com/v1") — prepend a scheme so URL
  // can parse it; a host that already contains "://" is left untouched.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
    candidate = `https://${candidate}`
  }
  try {
    const parsed = new URL(candidate)
    const host = parsed.hostname.toLowerCase()
    return host.length > 0 ? host : null
  } catch {
    return null
  }
}

/**
 * Presets sharing the selected provider's base domain (deepseek
 * ui-settings-models borrowing: a provider only accepts models from its
 * own endpoint). The provider's domain comes from the preset with the
 * same id; when that preset is missing or its URL is unparseable there is
 * no defensible domain and the result is empty rather than "everything".
 */
export function sameDomainPresets(providerId: string, presets: PresetCardView[]): PresetCardView[] {
  if (!providerId) return []
  const self = presets.find((p) => p.id === providerId)
  if (!self) return []
  const host = baseUrlHost(self.baseUrl)
  if (!host) return []
  return presets.filter((p) => baseUrlHost(p.baseUrl) === host)
}

// ── Configured providers (GET /providers) ───────────────────────────────────

export interface ProviderOptionView {
  id: string
  name: string
  defaultModel: string
  configured: boolean
}

/** Defensive /providers payload → provider options. Drops malformed rows. */
export function toProviderOptions(raw: unknown): ProviderOptionView[] {
  if (raw == null || typeof raw !== "object") return []
  const providers = (raw as { providers?: unknown }).providers
  if (!Array.isArray(providers)) return []
  const views: ProviderOptionView[] = []
  for (const item of providers) {
    if (item == null || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const id = str(row.id)
    if (!id) continue
    views.push({
      id,
      name: str(row.name, id),
      defaultModel: str(row.defaultModel),
      configured: bool(row.configured),
    })
  }
  return views
}

/** Only configured providers can receive a default-model route. */
export function configurableProviders(providers: ProviderOptionView[]): ProviderOptionView[] {
  return providers.filter((p) => p.configured)
}

// ── Set-default-model route (PUT /system/providers/{id}/model) ──────────────

export interface SetModelResultView {
  ok: boolean
  providerId: string
  model: string
}

/** Defensive set-model response → view. Null when not an object. */
export function toSetModelResult(raw: unknown): SetModelResultView | null {
  if (raw == null || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  return {
    ok: row.ok === true,
    providerId: str(row.providerId),
    model: str(row.model),
  }
}

// ── Test-chat probe (POST /system/providers/{id}/test-chat) ─────────────────

export interface TestChatCardView {
  ok: boolean
  providerId: string
  model: string
  content: string
  durationMs: number | null
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null
}

/** Defensive test-chat response → view. Null when not an object. */
export function toTestChatCardView(raw: unknown): TestChatCardView | null {
  if (raw == null || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const usage =
    row.usage != null && typeof row.usage === "object"
      ? (row.usage as Record<string, unknown>)
      : undefined
  return {
    ok: row.ok === true,
    providerId: str(row.providerId),
    model: str(row.model),
    content: str(row.content),
    durationMs:
      typeof row.durationMs === "number" && Number.isFinite(row.durationMs) ? row.durationMs : null,
    usage:
      usage &&
      typeof usage.promptTokens === "number" &&
      typeof usage.completionTokens === "number" &&
      typeof usage.totalTokens === "number"
        ? {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
          }
        : null,
  }
}

export type DurationTone = "fast" | "slow" | "unknown"

/** Badge tone for the probe wall-clock time: under 2s is a healthy round. */
export function durationTone(ms: number | null): DurationTone {
  if (ms === null) return "unknown"
  return ms < 2000 ? "fast" : "slow"
}
