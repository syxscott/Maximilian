// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the session time grouping (deepseek chat-demo borrowing, port
 * of sessionGroups.ts): bucket boundaries, adjacent merging, month keys,
 * injectable `now`, and the i18n-key/label contract.
 */

import { describe, expect, it } from "vitest"
import { groupSessions } from "../src/index.js"

/** Local noon on 2026-11-14 — startOfDay arithmetic stays timezone-safe. */
const NOW = new Date(2026, 10, 14, 12, 0, 0).getTime()
const DAY = 86_400_000
const startOfToday = new Date(NOW).setHours(0, 0, 0, 0)

const keysOf = (items: { id: string }[]) => items.map((item) => item.id)

describe("groupSessions", () => {
  it("buckets today / yesterday / last7days / last30days / month", () => {
    const sessions = [
      { id: "today", updatedAt: NOW - 3_600_000 },
      { id: "yesterday", updatedAt: startOfToday - DAY + 3_600_000 },
      { id: "thisWeek", updatedAt: NOW - 3 * DAY },
      { id: "thisMonth", updatedAt: NOW - 20 * DAY },
      { id: "old", updatedAt: NOW - 45 * DAY },
    ]
    const groups = groupSessions(sessions, NOW)

    expect(groups).toHaveLength(5)
    expect(groups[0]?.labelKey).toBe("sessions.group.today")
    expect(keysOf(groups[0]?.items ?? [])).toEqual(["today"])
    expect(groups[1]?.labelKey).toBe("sessions.group.yesterday")
    expect(groups[2]?.labelKey).toBe("sessions.group.last7days")
    expect(groups[3]?.labelKey).toBe("sessions.group.last30days")
    // Past the named buckets: month key as the label, no i18n key.
    expect(groups[4]?.labelKey).toBeNull()
    expect(groups[4]?.label).toBe("2026-09")
    expect(groups[4]?.key).toBe("2026-09")
  })

  it("honours the boundary semantics (diff < 7 / diff < 30)", () => {
    const sessions = [
      // diff = 7 exactly → NOT last7days, joins last30days.
      { id: "weekEdge", updatedAt: startOfToday - 7 * DAY },
      // diff = 30 exactly → NOT last30days, joins its month bucket.
      { id: "monthEdge", updatedAt: startOfToday - 30 * DAY },
    ]
    const groups = groupSessions(sessions, NOW)
    expect(groups).toHaveLength(2)
    expect(groups[0]?.labelKey).toBe("sessions.group.last30days")
    expect(groups[1]?.labelKey).toBeNull()
    expect(groups[1]?.label).toBe("2026-10")
  })

  it("merges adjacent sessions of the same bucket and splits on changes", () => {
    const sessions = [
      { id: "t1", updatedAt: NOW - 1_000 },
      { id: "t2", updatedAt: NOW - 2_000 },
      { id: "y1", updatedAt: startOfToday - DAY + 1_000 },
      { id: "y2", updatedAt: startOfToday - DAY + 2_000 },
      { id: "t3", updatedAt: NOW - 3_000 },
    ]
    const groups = groupSessions(sessions, NOW)
    expect(groups).toHaveLength(3)
    expect(keysOf(groups[0]?.items ?? [])).toEqual(["t1", "t2"])
    expect(keysOf(groups[1]?.items ?? [])).toEqual(["y1", "y2"])
    expect(keysOf(groups[2]?.items ?? [])).toEqual(["t3"])
  })

  it("accepts ISO string timestamps", () => {
    const groups = groupSessions(
      [{ id: "s", updatedAt: new Date(NOW - 3_600_000).toISOString() }],
      NOW,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]?.labelKey).toBe("sessions.group.today")
  })

  it("falls back to the empty-bucket form for missing timestamps", () => {
    const groups = groupSessions([{ id: "ghost", updatedAt: null }], NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.key).toBe("")
    expect(groups[0]?.labelKey).toBeNull()
    expect(groups[0]?.label).toBe("")
  })

  it("works with typed session rows passed straight from the API layer", () => {
    const sessions = [
      { id: "s1", title: "First", workspaceId: "w1", updatedAt: "2026-11-14T11:00:00.000Z" },
    ]
    const groups = groupSessions(sessions, NOW)
    expect(groups[0]?.items[0]?.id).toBe("s1")
  })
})
