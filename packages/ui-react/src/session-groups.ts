// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Session time grouping (deepseek chat-demo borrowing — port of
 * `services/chat/sessionGroups.ts` groupSessions).
 *
 * Buckets a newest-first session list into 今天 / 昨天 / 7 天内 / 30 天内 /
 * 按月 sections, preserving input order and merging adjacent sessions that
 * fall into the same bucket. Named buckets return an i18n key
 * (`sessions.group.*`, dashboard locale style); older sessions group by
 * calendar month and carry the raw "YYYY-MM" label instead.
 */

export interface SessionGroupItem {
  id: string
  /** Epoch ms or ISO timestamp of the session's last activity. */
  updatedAt: string | number | null
}

/** i18n keys of the named buckets — resolved with the dashboard's t(). */
export type SessionGroupLabelKey =
  | "sessions.group.today"
  | "sessions.group.yesterday"
  | "sessions.group.last7days"
  | "sessions.group.last30days"

export interface SessionGroup<T extends SessionGroupItem> {
  /** Stable bucket identity: the label key or the "YYYY-MM" month key. */
  key: string
  /** i18n key for named buckets; null for month buckets (label carries "YYYY-MM"). */
  labelKey: SessionGroupLabelKey | null
  /** Preformatted label for month buckets; empty for named buckets. */
  label: string
  items: T[]
}

const DAY = 86_400_000

const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0)

const monthKey = (time: number): string | null => {
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

/** Group a newest-first session list; `now` is injectable for tests. */
export const groupSessions = <T extends SessionGroupItem>(
  sessions: readonly T[],
  now: number,
): SessionGroup<T>[] => {
  const groups: SessionGroup<T>[] = []
  for (const session of sessions) {
    const updatedAt =
      typeof session.updatedAt === "string" ? Date.parse(session.updatedAt) : session.updatedAt
    const valid = typeof updatedAt === "number" && Number.isFinite(updatedAt)
    const diff = valid ? Math.floor((now - startOfDay(updatedAt)) / DAY) : Number.POSITIVE_INFINITY
    const labelKey: SessionGroupLabelKey | null =
      diff <= 0
        ? "sessions.group.today"
        : diff <= 1
          ? "sessions.group.yesterday"
          : diff < 7
            ? "sessions.group.last7days"
            : diff < 30
              ? "sessions.group.last30days"
              : null
    const groupKey = labelKey ?? (valid ? monthKey(updatedAt) : null) ?? ""
    const last = groups.at(-1)
    if (last?.key === groupKey) {
      last.items.push(session)
    } else {
      groups.push({
        key: groupKey,
        labelKey,
        label: labelKey ? "" : groupKey,
        items: [session],
      })
    }
  }
  return groups
}
