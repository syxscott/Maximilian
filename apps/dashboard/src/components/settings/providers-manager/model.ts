// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the providers management domain (CONVENTIONS:
 * unknown/passthrough JSON in → typed view models out; components only
 * render). Every accessor is defensive — backend payloads may be missing
 * fields or the whole route may 404 until wired.
 */

import type { ProviderPresetSummary } from "@/hooks/useSettingsQueries"

/** Category order for the filter chips; unknown categories append sorted. */
export const PRESET_CATEGORY_ORDER = [
  "official",
  "china",
  "international",
  "aggregator",
  "cloud",
  "custom",
] as const

export const CATEGORY_FILTER_ALL = "all"

export interface PresetView {
  id: string
  name: string
  category: string
  apiFormat: string
  defaultModel: string
  baseUrl: string
  envKey: string
  envModel: string | null
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

/** Defensive passthrough JSON → PresetView list. Drops malformed rows. */
export function toPresetViews(raw: unknown): PresetView[] {
  if (raw == null || typeof raw !== "object") return []
  const presets = (raw as { presets?: unknown }).presets
  if (!Array.isArray(presets)) return []
  const views: PresetView[] = []
  for (const item of presets) {
    if (item == null || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const id = str(row.id)
    if (!id) continue
    views.push({
      id,
      name: str(row.name, id),
      category: str(row.category, "custom"),
      apiFormat: str(row.apiFormat),
      defaultModel: str(row.defaultModel),
      baseUrl: str(row.baseUrl),
      envKey: str(row.envKey),
      envModel: typeof row.envModel === "string" ? row.envModel : null,
      configured: bool(row.configured),
      isOfficial: bool(row.isOfficial),
      isPartner: bool(row.isPartner),
    })
  }
  return views
}

/** Distinct categories present in the data, in display order. */
export function presetCategories(presets: PresetView[]): string[] {
  const seen = new Set(presets.map((p) => p.category))
  const ordered = PRESET_CATEGORY_ORDER.filter((c) => seen.has(c))
  const extra = [...seen].filter((c) => !(PRESET_CATEGORY_ORDER as readonly string[]).includes(c))
  return [...ordered, ...extra.sort()]
}

/** Category + case-insensitive text filter (name / id / defaultModel). */
export function filterPresets(
  presets: PresetView[],
  category: string,
  query: string,
): PresetView[] {
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

/** Cap a list for render; the footer reports how many rows are folded away. */
export function windowList<T>(items: T[], max: number): Windowed<T> {
  const total = items.length
  const capped = items.slice(0, Math.max(0, max))
  return { items: capped, shown: capped.length, total, hidden: Math.max(0, total - max) }
}

// ── Model tester ────────────────────────────────────────────────────────────

export interface TestChatView {
  ok: boolean
  model: string
  content: string
  durationMs: number | null
  usage: { promptTokens: number; completionTokens: number } | null
}

/** Defensive passthrough → tester result view. Null when not an object. */
export function toTestChatView(raw: unknown): TestChatView | null {
  if (raw == null || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const usage =
    row.usage != null && typeof row.usage === "object"
      ? (row.usage as Record<string, unknown>)
      : undefined
  return {
    ok: row.ok === true,
    model: str(row.model),
    content: str(row.content),
    durationMs:
      typeof row.durationMs === "number" && Number.isFinite(row.durationMs) ? row.durationMs : null,
    usage:
      usage && typeof usage.promptTokens === "number" && typeof usage.completionTokens === "number"
        ? { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens }
        : null,
  }
}

/** Only configured presets are testable targets. */
export function testableProviders(presets: PresetView[]): PresetView[] {
  return presets.filter((p) => p.configured)
}
