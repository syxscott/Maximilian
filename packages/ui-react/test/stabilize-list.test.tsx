// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * stabilizeList tests (ZCode taskListItemStabilization borrowing):
 * structural equality (key order ignored, undefined treated as absent,
 * deliberately no JSON.stringify), row/array reference reuse, the
 * event-key dedup window, and the consumer-facing payoff — a memoized
 * list whose activity timestamp changes on one row re-renders that row
 * only, never the whole tree.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { memo } from "react"
import { createEventKeyWindow, stabilizeList, structuralEqual } from "../src/index.js"
import { cleanup, renderUI } from "./helpers.js"

afterEach(() => {
  cleanup()
})

describe("structuralEqual", () => {
  it("compares scalars strictly", () => {
    expect(structuralEqual(1, 1)).toBe(true)
    expect(structuralEqual("a", "a")).toBe(true)
    expect(structuralEqual(1, 2)).toBe(false)
    expect(structuralEqual(null, null)).toBe(true)
    expect(structuralEqual(null, {})).toBe(false)
    expect(structuralEqual(undefined, null)).toBe(false)
  })

  it("ignores key order", () => {
    expect(structuralEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(structuralEqual({ a: { x: 1, y: 2 }, b: 3 }, { b: 3, a: { y: 2, x: 1 } })).toBe(true)
  })

  it("treats an explicit undefined key as an absent key", () => {
    expect(structuralEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    expect(structuralEqual({ a: undefined }, {})).toBe(true)
    // A defined null is NOT the same as absent.
    expect(structuralEqual({ a: null }, {})).toBe(false)
  })

  it("compares arrays element-wise", () => {
    expect(structuralEqual([1, { a: 2 }], [1, { a: 2 }])).toBe(true)
    expect(structuralEqual([1, 2], [2, 1])).toBe(false)
    expect(structuralEqual([1, 2], [1])).toBe(false)
    expect(structuralEqual([1], { 0: 1 })).toBe(false)
  })

  it("rejects different key sets and different values", () => {
    expect(structuralEqual({ a: 1, c: 3 }, { a: 1, b: 2 })).toBe(false)
    expect(structuralEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(structuralEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false)
  })
})

interface Item {
  id: string
  status: string
  activity?: number
  note?: string
}

const keyOf = (item: Item) => item.id

describe("stabilizeList", () => {
  const rows: Item[] = [
    { id: "a", status: "running", activity: 1 },
    { id: "b", status: "idle", activity: 2 },
    { id: "c", status: "idle", activity: 3 },
  ]

  it("passes the next list through when there is nothing to fold onto", () => {
    const next = [...rows]
    expect(stabilizeList(null, next, keyOf)).toBe(next)
    expect(stabilizeList(undefined, next, keyOf)).toBe(next)
    expect(stabilizeList(next, next, keyOf)).toBe(next)
  })

  it("reuses the previous ARRAY when the whole table is equivalent", () => {
    const prev = rows
    // Fresh JSON-shaped copies (new objects, key order flipped, explicit
    // undefined instead of an absent key, same order) — still the same
    // table, so the old array reference survives.
    const next: Item[] = [
      { id: "a", status: "running", activity: 1, note: undefined },
      { activity: 2, status: "idle", id: "b" },
      { status: "idle", activity: 3, id: "c" },
    ]
    const out = stabilizeList(prev, next, keyOf)
    expect(out).toBe(prev)
  })

  it("reuses per-row references for unchanged rows, replaces changed ones", () => {
    const next: Item[] = [
      { ...rows[0]!, activity: 10 }, // activity timestamp advanced
      { ...rows[1]! },
      { ...rows[2]! },
    ]
    const out = stabilizeList(rows, next, keyOf)
    expect(out).not.toBe(rows)
    expect(out[0]).toBe(next[0])
    expect(out[1]).toBe(rows[1])
    expect(out[2]).toBe(rows[2])
  })

  it("follows the next order while reusing moved row objects", () => {
    const next: Item[] = [rows[2]!, rows[0]!, rows[1]!]
    const out = stabilizeList(rows, next, keyOf)
    expect(out.map((r) => r.id)).toEqual(["c", "a", "b"])
    expect(out[0]).toBe(rows[2])
    expect(out[1]).toBe(rows[0])
    expect(out[2]).toBe(rows[1])
  })

  it("adds and drops rows without touching the stable ones", () => {
    const next: Item[] = [{ id: "d", status: "idle" }, rows[0]!]
    const out = stabilizeList(rows, next, keyOf)
    expect(out.map((r) => r.id)).toEqual(["d", "a"])
    expect(out[1]).toBe(rows[0])
  })
})

describe("createEventKeyWindow", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("reports the first sighting per key and duplicates inside the window", () => {
    vi.useFakeTimers({ now: 0 })
    const window = createEventKeyWindow(500)
    expect(window.isDuplicate("t1")).toBe(false)
    vi.setSystemTime(499)
    expect(window.isDuplicate("t1")).toBe(true)
    vi.setSystemTime(501)
    // Outside the window the same key may fire again.
    expect(window.isDuplicate("t1")).toBe(false)
  })

  it("lets a mutation bump re-arm the same key immediately", () => {
    vi.useFakeTimers({ now: 0 })
    const window = createEventKeyWindow(500)
    expect(window.isDuplicate("t1")).toBe(false)
    window.bump()
    expect(window.isDuplicate("t1")).toBe(false)
    expect(window.isDuplicate("t1")).toBe(true)
    // A bumped record does not satisfy an old-version sighting check.
    window.bump()
    expect(window.isDuplicate("t1")).toBe(false)
  })

  it("reset clears all sightings", () => {
    vi.useFakeTimers({ now: 0 })
    const window = createEventKeyWindow(500)
    expect(window.isDuplicate("t1")).toBe(false)
    expect(window.isDuplicate("t1")).toBe(true)
    window.reset()
    expect(window.isDuplicate("t1")).toBe(false)
  })
})

// ── render-count payoff: one changed activity timestamp, one row ───────────

interface RowItem {
  id: string
  activity: number
}

const renderCounts = new Map<string, number>()
const Row = memo(function Row({ item }: { item: RowItem }) {
  renderCounts.set(item.id, (renderCounts.get(item.id) ?? 0) + 1)
  return <li>{item.id}</li>
})

function StableRows({ items }: { items: RowItem[] }) {
  return (
    <ul>
      {items.map((item) => (
        <Row key={item.id} item={item} />
      ))}
    </ul>
  )
}

describe("stabilizeList render counts", () => {
  it("an activity timestamp change re-renders one row, not the tree", () => {
    const first: RowItem[] = [
      { id: "a", activity: 1 },
      { id: "b", activity: 1 },
      { id: "c", activity: 1 },
    ]
    const { rerender } = renderUI(<StableRows items={first} />)
    expect([...renderCounts.entries()].sort()).toEqual([
      ["a", 1],
      ["b", 1],
      ["c", 1],
    ])

    // Identical re-delivery (fresh copies): stabilized to the same refs —
    // no row re-renders.
    rerender(
      <StableRows
        items={stabilizeList(
          first,
          first.map((r) => ({ ...r })),
          (r) => r.id,
        )}
      />,
    )
    expect([...renderCounts.entries()].sort()).toEqual([
      ["a", 1],
      ["b", 1],
      ["c", 1],
    ])

    // Only row "b"'s activity timestamp moved: exactly that row re-renders.
    const third = first.map((r) => (r.id === "b" ? { ...r, activity: 2 } : { ...r }))
    rerender(<StableRows items={stabilizeList(first, third, (r) => r.id)} />)
    expect([...renderCounts.entries()].sort()).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 1],
    ])
  })
})
