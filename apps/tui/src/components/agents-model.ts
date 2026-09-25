// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure model layer for the TUI Agents panel (the evolution domain): input is
 * passthrough JSON from GET /api/evolution/agents (AgentProfile records) and
 * GET /api/evolution/leaderboard (per-role/provider/model entries), output is
 * typed view models the ink component just paints.
 *
 * The API validates with Zod upstream but the TUI deliberately skips a second
 * runtime check, so everything here is defensive (garbage in any field degrades
 * that field only) and unit-testable. No React, no ink, no i18n imports — the
 * panel translates the returned *keys*.
 */

import type {
  AgentProfilePayload,
  LeaderboardEntryPayload,
  LeaderboardVersionDecision,
} from "../api"

// ── Score grade (the row's rating dot) ──────────────────────────────────────

export type AgentGrade = "elite" | "strong" | "steady" | "weak" | "unrated"
export type AgentDotColor = "green" | "cyan" | "yellow" | "red" | "gray"

export interface ScoreGrade {
  grade: AgentGrade
  color: AgentDotColor
}

/**
 * Map a profile's avgScore (0..10 review scale) to a rating grade + dot
 * color:
 *   ≥8 elite green · ≥6 strong cyan · ≥4 steady yellow · >0 weak red
 * Unrated (gray) covers garbage AND the honest "no scored tasks yet" case:
 * the schema defaults avgScore to 0, so a 0 with zero total tasks means "no
 * data", not "catastrophic". A 0 with actual tasks IS a real bad score → red.
 */
export function scoreGrade(
  avgScore: unknown,
  totalTasks: unknown = Number.POSITIVE_INFINITY,
): ScoreGrade {
  if (typeof avgScore !== "number" || !Number.isFinite(avgScore)) {
    return { grade: "unrated", color: "gray" }
  }
  const tasks = typeof totalTasks === "number" && Number.isFinite(totalTasks) ? totalTasks : 0
  if (tasks <= 0 && avgScore === 0) return { grade: "unrated", color: "gray" }
  if (avgScore < 0 || avgScore > 10) return { grade: "unrated", color: "gray" }
  if (avgScore >= 8) return { grade: "elite", color: "green" }
  if (avgScore >= 6) return { grade: "strong", color: "cyan" }
  if (avgScore >= 4) return { grade: "steady", color: "yellow" }
  return { grade: "weak", color: "red" }
}

// ── Row view model (one role per line) ──────────────────────────────────────

export interface AgentRowView {
  /** Stable list key — falls back to a positional suffix for garbage roles. */
  key: string
  role: string
  currentVersion: string
  totalTasks: number
  avgScore: number | null
  grade: AgentGrade
  color: AgentDotColor
  /** preferredModel, else the headline leaderboard entry's provider:model. */
  model: string | null
  successRate: number | null
  /** True when the leaderboard had at least one entry for this role. */
  hasLeaderboard: boolean
}

/**
 * Merge profiles × leaderboard into one row per profile, sorted by avgScore
 * desc (ties: more tasks first, then role name asc). Defensive: non-array or
 * garbage entries are dropped; leaderboard entries are keyed defensively by
 * agentRole.
 */
export function buildAgentRows(profiles: unknown, leaderboard: unknown): AgentRowView[] {
  const list = Array.isArray(profiles) ? profiles : []
  const entries = Array.isArray(leaderboard) ? leaderboard : []
  const byRole = leaderboardByRole(entries)

  const rows: AgentRowView[] = []
  list.forEach((raw, index) => {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return
    const profile = raw as AgentProfilePayload
    const role = typeof profile.role === "string" && profile.role.length > 0 ? profile.role : ""
    if (role.length === 0) return // a row without a role cannot be displayed
    const entry = byRole.get(role) ?? null
    const totalTasks =
      typeof profile.totalTasks === "number" && Number.isFinite(profile.totalTasks)
        ? profile.totalTasks
        : 0
    const avgScore =
      typeof profile.avgScore === "number" && Number.isFinite(profile.avgScore)
        ? profile.avgScore
        : null
    const grade = scoreGrade(profile.avgScore, profile.totalTasks)
    const versions = Array.isArray(profile.versions)
      ? profile.versions.filter((v): v is string => typeof v === "string" && v.length > 0)
      : []
    const currentVersion =
      typeof profile.currentVersion === "string" && profile.currentVersion.length > 0
        ? profile.currentVersion
        : (versions[versions.length - 1] ?? "v1")
    const successRate =
      typeof profile.successRate === "number" && Number.isFinite(profile.successRate)
        ? profile.successRate
        : null
    rows.push({
      key: `${role}#${index}`,
      role,
      currentVersion,
      totalTasks,
      avgScore,
      grade: grade.grade,
      color: grade.color,
      model:
        typeof profile.preferredModel === "string" && profile.preferredModel.length > 0
          ? profile.preferredModel
          : entry != null
            ? headlineModel(entry)
            : null,
      successRate,
      hasLeaderboard: entry != null,
    })
  })

  return rows.sort((a, b) => {
    const scoreA = a.avgScore ?? -1
    const scoreB = b.avgScore ?? -1
    if (scoreB !== scoreA) return scoreB - scoreA
    if (b.totalTasks !== a.totalTasks) return b.totalTasks - a.totalTasks
    return a.role.localeCompare(b.role)
  })
}

/** "provider:model" one-liner for a leaderboard entry (defensive). */
function headlineModel(entry: LeaderboardEntryPayload): string | null {
  const model = typeof entry.model === "string" ? entry.model : ""
  if (model.length === 0) return null
  const provider = typeof entry.provider === "string" ? entry.provider : ""
  return provider.length > 0 ? `${provider}:${model}` : model
}

/**
 * Best leaderboard entry per role — the one with the largest sampleSize
 * (most evidence wins; garbage entries and missing roles are skipped).
 */
export function leaderboardByRole(entries: unknown): Map<string, LeaderboardEntryPayload> {
  const byRole = new Map<string, LeaderboardEntryPayload>()
  const list = Array.isArray(entries) ? entries : []
  for (const raw of list) {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue
    const entry = raw as LeaderboardEntryPayload
    const role = typeof entry.agentRole === "string" ? entry.agentRole : ""
    if (role.length === 0) continue
    const sample =
      typeof entry.sampleSize === "number" && Number.isFinite(entry.sampleSize)
        ? entry.sampleSize
        : 0
    const current = byRole.get(role)
    const currentSample =
      current != null && typeof current.sampleSize === "number" ? current.sampleSize : -1
    if (current == null || sample > currentSample) byRole.set(role, entry)
  }
  return byRole
}

// ── Detail view model (Enter expands a row) ─────────────────────────────────

export type MemoryBucketKey = "userFeedback" | "reviewSuggestions" | "commonErrors" | "goodExamples"

export const MEMORY_BUCKETS: readonly MemoryBucketKey[] = [
  "userFeedback",
  "reviewSuggestions",
  "commonErrors",
  "goodExamples",
]

export interface MemoryBucketCount {
  key: MemoryBucketKey
  /** i18n key under "tui.agents.bucket.*" — the panel translates it. */
  labelKey: string
  count: number
}

export interface AgentScorePoint {
  score: number
  version: string
  at: string | null
}

export interface AgentPromotionView {
  fromVersion: string
  toVersion: string
  outcome: string
  oldAvgScore: number | null
  newAvgScore: number | null
  at: string | null
  reason: string
}

export interface AgentDetailView {
  buckets: MemoryBucketCount[]
  totalEntries: number
  /** Recent decision scores (newest first, capped) — "recent review scores". */
  recentScores: AgentScorePoint[]
  /** All from→to decisions, newest first — "version promotions". */
  promotions: AgentPromotionView[]
  versions: string[]
  currentVersion: string
  /** Baseline/delta from the headline leaderboard entry, when present. */
  baselineScore: number | null
  deltaScore: number | null
}

/**
 * Count one memory bucket defensively: legacy buckets are string[], current
 * ones MemoryEntry[], and anything non-array counts as 0.
 */
function bucketCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

/**
 * Expanded detail for one role: memory bucket counts, recent review scores
 * and the promotion timeline (both sourced from the leaderboard entry's
 * versionHistory — the profile itself only carries aggregate counters).
 * `entry` may be null when the role has no leaderboard rows yet.
 */
export function agentDetail(
  profile: unknown,
  entry: LeaderboardEntryPayload | null,
): AgentDetailView {
  const memory: AgentProfilePayload["memory"] =
    profile != null && typeof profile === "object" && !Array.isArray(profile)
      ? ((profile as AgentProfilePayload).memory ?? {})
      : {}

  const buckets: MemoryBucketCount[] = MEMORY_BUCKETS.map((key) => ({
    key,
    labelKey: `tui.agents.bucket.${key}`,
    count: bucketCount(memory?.[key]),
  }))
  const counted = buckets.reduce((acc, b) => acc + b.count, 0)
  const declared = memory?.totalEntries
  const totalEntries =
    typeof declared === "number" && Number.isFinite(declared) ? declared : counted

  const versions =
    profile != null &&
    typeof profile === "object" &&
    Array.isArray((profile as AgentProfilePayload).versions)
      ? ((profile as AgentProfilePayload).versions ?? []).filter(
          (v): v is string => typeof v === "string" && v.length > 0,
        )
      : []
  const rawCurrent =
    profile != null && typeof profile === "object"
      ? (profile as AgentProfilePayload).currentVersion
      : undefined
  const currentVersion =
    typeof rawCurrent === "string" && rawCurrent.length > 0
      ? rawCurrent
      : (versions[versions.length - 1] ?? "v1")

  const history = versionTimeline(entry)
  const recentScores: AgentScorePoint[] = history.slice(0, 3).map((d) => ({
    score: d.newAvgScore ?? 0,
    version: d.toVersion,
    at: d.at,
  }))
  const promotions: AgentPromotionView[] = history.map((d) => ({
    fromVersion: d.fromVersion,
    toVersion: d.toVersion,
    outcome: d.outcome,
    oldAvgScore: d.oldAvgScore,
    newAvgScore: d.newAvgScore,
    at: d.at,
    reason: d.reason,
  }))

  return {
    buckets,
    totalEntries,
    recentScores,
    promotions,
    versions,
    currentVersion,
    baselineScore:
      entry != null && typeof entry.baselineScore === "number" ? entry.baselineScore : null,
    deltaScore: entry != null && typeof entry.deltaScore === "number" ? entry.deltaScore : null,
  }
}

/**
 * A role's version decisions, newest first. Defensive: garbage entries are
 * dropped; missing scores/times degrade per-field instead of rejecting the
 * whole decision.
 */
export function versionTimeline(entry: LeaderboardEntryPayload | null | undefined): Array<{
  fromVersion: string
  toVersion: string
  outcome: string
  oldAvgScore: number | null
  newAvgScore: number | null
  at: string | null
  reason: string
}> {
  const raw = entry != null && Array.isArray(entry.versionHistory) ? entry.versionHistory : []
  const out: Array<{
    fromVersion: string
    toVersion: string
    outcome: string
    oldAvgScore: number | null
    newAvgScore: number | null
    at: string | null
    reason: string
  }> = []
  for (const d of raw as LeaderboardVersionDecision[]) {
    if (d == null || typeof d !== "object") continue
    out.push({
      fromVersion: typeof d.fromVersion === "string" ? d.fromVersion : "?",
      toVersion: typeof d.toVersion === "string" ? d.toVersion : "?",
      outcome: d.outcome === "discarded" ? "discarded" : "promoted",
      oldAvgScore: typeof d.oldAvgScore === "number" ? d.oldAvgScore : null,
      newAvgScore: typeof d.newAvgScore === "number" ? d.newAvgScore : null,
      at: typeof d.triggeredAt === "string" ? d.triggeredAt : null,
      reason: typeof d.reason === "string" ? d.reason : "",
    })
  }
  // Newest first: unparseable timestamps sort last by string compare on "".
  return out.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
}
