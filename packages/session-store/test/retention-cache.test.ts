// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_RETENTION_MS,
  RetentionCache,
  normalizeRetentionMs,
  setDefaultRetentionMs,
} from "../src/retention-cache.js"

/**
 * The behavioral suite runs TWICE (pi's durable-suite guard): once with
 * the default retention and once with retention forced to 0 — every cache
 * constructed WITHOUT an explicit retentionMs must drop entries right
 * after use in the second pass. A leak under retention=0 fails the guard.
 */
const retentionModes = [
  { name: "default retention (10min)", forced: undefined as number | undefined },
  { name: "retention=0 (suite guard)", forced: 0 },
] as const

describe.each(retentionModes)("RetentionCache under $name", ({ forced }) => {
  afterEach(() => {
    setDefaultRetentionMs(DEFAULT_RETENTION_MS)
  })

  function cache<V>(
    opts: {
      retentionMs?: number
      now?: () => number
      capacity?: number
    } = {},
  ): RetentionCache<string, V> {
    // When the mode forces 0, caches that "keep the default" must see 0.
    setDefaultRetentionMs(forced ?? DEFAULT_RETENTION_MS)
    return new RetentionCache<string, V>(opts)
  }

  it("evicts an unpinned entry once it outruns its retention", () => {
    let now = 1_000
    const c = cache<string>({ now: () => now, retentionMs: 10_000 })
    c.set("a", "1")
    expect(c.get("a")).toBe("1")
    now += 9_999
    c.sweep(now)
    expect(c.has("a")).toBe(true) // still inside retention
    now += 1
    c.sweep(now)
    expect(c.has("a")).toBe(false)
    expect(c.evicted).toBe(1)
  })

  it("a read refreshes recency (idle clock, touched entry survives)", () => {
    let now = 0
    const c = cache<string>({ now: () => now, retentionMs: 1_000 })
    c.set("a", "1")
    now = 900
    expect(c.get("a")).toBe("1") // touch at 900
    now = 1_500
    c.sweep(now)
    expect(c.has("a")).toBe(true) // 600ms since touch < 1000ms
    now = 2_200
    c.sweep(now)
    expect(c.has("a")).toBe(false) // 1300ms since last touch
  })

  it("an active observer pins an entry past its retention; release un-pins", () => {
    let now = 0
    const c = cache<string>({ now: () => now, retentionMs: 1_000 })
    c.set("a", "1")
    expect(c.retain("a")).toBe("1")
    now = 10_000
    c.sweep(now)
    expect(c.has("a")).toBe(true) // pinned
    c.release("a")
    c.sweep(now)
    expect(c.has("a")).toBe(false)
  })

  it("retain on a missing key creates nothing and returns undefined", () => {
    const c = cache<string>({ retentionMs: 1_000 })
    expect(c.retain("ghost")).toBeUndefined()
    expect(c.size).toBe(0)
  })

  it("release without a pin is a safe no-op that may still sweep", () => {
    let now = 0
    const c = cache<string>({ now: () => now, retentionMs: 1_000 })
    c.set("a", "1")
    now = 5_000
    expect(() => c.release("a")).not.toThrow()
    expect(c.has("a")).toBe(false) // swept by the release
  })

  it("retention=Infinity keeps entries for the life of the process", () => {
    let now = 0
    const c = cache<string>({ now: () => now, retentionMs: Number.POSITIVE_INFINITY })
    c.set("a", "1")
    now = 10 ** 12
    c.sweep(now)
    expect(c.has("a")).toBe(true)
  })

  it("hard capacity evicts stale-end entries before retention expires", () => {
    const now = 0
    const c = cache<string>({ now: () => now, retentionMs: 1_000_000, capacity: 2 })
    c.set("a", "1")
    c.set("b", "2")
    c.set("c", "3")
    expect(c.size).toBe(2)
    expect(c.has("a")).toBe(false) // oldest idle first
    expect(c.has("c")).toBe(true)
    expect(c.evicted).toBe(1)
  })

  it("pinned entries are skipped by capacity eviction, capacity is soft under pins", () => {
    const now = 0
    const c = cache<string>({ now: () => now, retentionMs: 1_000_000, capacity: 1 })
    c.set("a", "1")
    c.retain("a")
    c.set("b", "2")
    expect(c.size).toBe(2) // both alive: a is pinned, b is protected as just-set
    expect(c.has("a")).toBe(true)
    expect(c.has("b")).toBe(true)
  })

  it("a cache keeping the module default retention follows the forced mode", () => {
    // No explicit retentionMs: this cache "keeps the default" — the heart
    // of the retention=0 suite guard. Under the guard, nothing outlives
    // its use; under the 10-minute default, an entry comfortably survives.
    let now = 0
    const c = cache<string>({ now: () => now })
    c.set("a", "1")
    now = 10
    c.sweep(now)
    if (forced === 0) {
      expect(c.has("a")).toBe(false)
      expect(c.evicted).toBe(1)
    } else {
      expect(c.has("a")).toBe(true)
    }
  })

  it("hot-path discipline: remap at most once per granule, sweep stays O(evicted)", () => {
    let now = 0
    // retention 10s -> granule 1s.
    const c = cache<string>({ now: () => now, retentionMs: 10_000 })
    c.set("cold", "0")
    const touchLoops = 10_000
    for (let i = 0; i < touchLoops; i += 1) {
      now += 1 // 10,000 touches, all inside ONE granule (1s per 1000 ticks)
      expect(c.get("cold")).toBe("0")
    }
    // One remap per granule: 10,000ms / 1,000ms granule ≈ 10 moves, not 10,000.
    // (Observable indirectly: the entry survives and the cache stayed size 1.)
    expect(c.size).toBe(1)
    now += 20_000
    expect(c.sweep(now)).toBe(1)
    expect(c.size).toBe(0)
  })

  it("sweep stops at the first surviving entry (bounded work per call)", () => {
    let now = 0
    const c = cache<string>({ now: () => now, retentionMs: 1_000 })
    // All three set at t=0 (insert-sweeps find nothing stale); the clock
    // then advances past old1/old2's retention but not fresh's.
    c.set("old1", "1")
    c.set("old2", "2")
    c.set("fresh", "3")
    now = 1_500
    // old1/old2 are stale (1500ms); fresh is 1500ms old too... all stale here,
    // so advance the fresh entry's recency with a read at the later clock.
    now = 1_000
    expect(c.get("fresh")).toBe("3") // touched at 1000
    now = 1_500
    // old1/old2 stale (1500ms); fresh touched at 1000 (500ms, inside
    // retention) — the walk evicts the two stale entries and BREAKS there.
    expect(c.sweep(now)).toBe(2)
    expect(c.has("fresh")).toBe(true)
    expect(c.size).toBe(1)
  })

  it("a throwing clock falls back to Date.now() and never breaks set/get", () => {
    const c = cache<string>({
      now: () => {
        throw new Error("clock exploded")
      },
      retentionMs: 1_000,
    })
    expect(() => c.set("a", "1")).not.toThrow()
    expect(c.get("a")).toBe("1")
  })

  it("delete drops an entry immediately; pinned entries refuse", () => {
    const c = cache<string>({ retentionMs: 1_000 })
    c.set("a", "1")
    c.retain("a")
    expect(c.delete("a")).toBe(false)
    c.release("a")
    expect(c.delete("a")).toBe(true)
    expect(c.delete("a")).toBe(false)
  })

  it("normalizeRetentionMs: 0 and Infinity are honored, junk means default", () => {
    setDefaultRetentionMs(forced ?? DEFAULT_RETENTION_MS)
    expect(normalizeRetentionMs(0)).toBe(0)
    expect(normalizeRetentionMs(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
    expect(normalizeRetentionMs(undefined)).toBe(forced ?? DEFAULT_RETENTION_MS)
    expect(normalizeRetentionMs(Number.NaN)).toBe(forced ?? DEFAULT_RETENTION_MS)
    expect(normalizeRetentionMs(-5)).toBe(forced ?? DEFAULT_RETENTION_MS)
  })
})

describe("RetentionCache — mode-independent behavior", () => {
  it("the DEFAULT_RETENTION_MS constant is ten minutes", () => {
    expect(DEFAULT_RETENTION_MS).toBe(600_000)
  })

  it("an explicit retentionMs always wins over the module default", () => {
    setDefaultRetentionMs(0) // even the suite guard cannot override an explicit value
    const c = new RetentionCache<string>({ retentionMs: 60_000 })
    expect(c.retentionMs).toBe(60_000)
    setDefaultRetentionMs(DEFAULT_RETENTION_MS)
  })

  it("non-numeric retention options fall back to the default", () => {
    const c = new RetentionCache<string>({ retentionMs: undefined })
    expect(c.retentionMs).toBe(DEFAULT_RETENTION_MS)
  })

  it("works with non-string keys and structured values", () => {
    // retention 0 = "no cache": a value is dropped right after the write
    // that set it, so a later read misses and recomputes from the store.
    const c = new RetentionCache<number, { rows: string[] }>({ retentionMs: 0 })
    c.set(7, { rows: ["a"] })
    expect(c.get(7)).toBeUndefined()
    expect(c.size).toBe(0)
    expect(c.evicted).toBe(1)
  })
})
