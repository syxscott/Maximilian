// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Row-height persistence + learning estimator tests (ZCode v4
 * timelineRowHeightCache + pi row-estimate borrowings): LRU eviction and
 * refresh, survival across virtualizer resets (the cache outlives them
 * by design), injected storage round-trip, invalid-measurement guards,
 * the least-squares fit's monotone convergence, the first-estimate pin,
 * and the three-level composition (measured → learned → static).
 */
import { describe, expect, it } from "vitest"
import {
  createTurnHeightModel,
  DEFAULT_ROW_HEIGHT_FALLBACK_PX,
  recordTurnMeasurement,
  resolveTurnHeight,
  RowEstimator,
  safeRowHeightStore,
  turnRowFeatures,
  TurnRowHeightCache,
  type RowFeatures,
  type RowHeightStore,
} from "../src/components/conversation/row-height-cache"
import {
  buildTurnFlowItems,
  groupUnitsByTurn,
  type RuntimeEvent,
  type TurnModel,
} from "../src/components/conversation/model"

/** Map-backed storage stand-in with localStorage's exact surface. */
function memoryStore(): RowHeightStore & { dump(): Map<string, string> } {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    dump: () => map,
  }
}

const ev = (over: Record<string, unknown>): RuntimeEvent =>
  ({ type: "unknown", ...over }) as RuntimeEvent

const taskTurn = (taskId = "t1", text = "hello world"): TurnModel => {
  const events: RuntimeEvent[] = [
    ev({ type: "task-start", taskId, agentRole: "backend" }),
    ev({ type: "assistant-text", text, taskId }),
    ev({ type: "task-complete", taskId }),
  ]
  const [turn] = groupUnitsByTurn(buildTurnFlowItems(events, null))
  if (!turn) throw new Error("expected a turn")
  return turn
}

const messageTurn = (text = "just narration"): TurnModel => {
  const [turn] = groupUnitsByTurn(buildTurnFlowItems([ev({ type: "assistant-text", text })], null))
  if (!turn) throw new Error("expected a turn")
  return turn
}

describe("TurnRowHeightCache (measured-height persistence)", () => {
  it("stores and returns real measurements", () => {
    const cache = new TurnRowHeightCache()
    expect(cache.get("task-t1")).toBeUndefined()
    cache.set("task-t1", 240)
    expect(cache.get("task-t1")).toBe(240)
    expect(cache.size).toBe(1)
    expect(cache.estimate("task-t1", 99)).toBe(240)
    expect(cache.estimate("task-missing", 99)).toBe(99)
    expect(cache.estimate(undefined, 99)).toBe(99)
  })

  it("rejects malformed measurements (non-finite, zero, negative)", () => {
    const cache = new TurnRowHeightCache()
    cache.set("k", Number.NaN)
    cache.set("k", 0)
    cache.set("k", -10)
    cache.set("", 100)
    expect(cache.size).toBe(0)
  })

  it("evicts the oldest-written entry past the bound, refreshed by re-writes", () => {
    const cache = new TurnRowHeightCache({ maxEntries: 2 })
    cache.set("a", 1)
    cache.set("b", 2)
    cache.set("a", 10) // refresh — a becomes the newest
    cache.set("c", 3) // evicts b (the oldest)
    expect(cache.get("a")).toBe(10)
    expect(cache.get("b")).toBeUndefined()
    expect(cache.get("c")).toBe(3)
    expect(cache.size).toBe(2)
  })

  it("outlives a virtualizer reset: the instance persists while rows remount", () => {
    const cache = new TurnRowHeightCache()
    cache.set("task-t1", 240)
    // Simulate the virtualizer throwing its measurements away (row list
    // rebuilt, component remounted) — the cache is deliberately OUTSIDE
    // it, so the measured height survives and the scrollbar holds.
    cache.estimate("task-t1")
    expect(cache.get("task-t1")).toBe(240)
  })

  it("clear() drops everything on a stream switch", () => {
    const cache = new TurnRowHeightCache()
    cache.set("task-t1", 240)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get("task-t1")).toBeUndefined()
  })

  it("round-trips through an injected storage, namespaced per stream", () => {
    const store = memoryStore()
    const cache = new TurnRowHeightCache({ namespace: "turn-height:w1", storage: store })
    cache.set("task-t1", 240)
    expect(store.dump().get("turn-height:w1\u0000task-t1")).toBe("240")

    // A fresh instance (next mount) reads the measurement back through
    // the store and repopulates memory.
    const revived = new TurnRowHeightCache({ namespace: "turn-height:w1", storage: store })
    expect(revived.get("task-t1")).toBe(240)

    // Another stream's namespace never sees the first stream's rows.
    const other = new TurnRowHeightCache({ namespace: "turn-height:w2", storage: store })
    expect(other.get("task-t1")).toBeUndefined()

    // Clear removes the namespaced entries from the storage too.
    revived.clear()
    expect(store.dump().has("turn-height:w1\u0000task-t1")).toBe(false)
  })

  it("ignores garbage persisted values instead of trusting the store", () => {
    const store = memoryStore()
    store.setItem("turn-height:w1\u0000bad", "not-a-number")
    const cache = new TurnRowHeightCache({ namespace: "turn-height:w1", storage: store })
    expect(cache.get("bad")).toBeUndefined()
  })

  it("a throwing storage degrades to memory-only (safeRowHeightStore)", () => {
    const hostile: RowHeightStore = {
      getItem: () => {
        throw new Error("private mode")
      },
      setItem: () => {
        throw new Error("quota")
      },
      removeItem: () => {
        throw new Error("quota")
      },
    }
    const guarded = safeRowHeightStore(hostile)
    expect(guarded).not.toBeNull()
    const cache = new TurnRowHeightCache({ storage: guarded ?? undefined })
    cache.set("k", 50) // must not throw
    expect(cache.get("k")).toBe(50)
    expect(safeRowHeightStore(null)).toBeNull()
  })

  it("keeps the documented fallback default for the raw estimate API", () => {
    expect(DEFAULT_ROW_HEIGHT_FALLBACK_PX).toBe(72)
  })
})

describe("RowEstimator (learned height ~ text/width)", () => {
  const features = (kind: string, text: number): RowFeatures => ({ kind, text, fixed: 0 })

  it("falls back to the caller's static estimate while nothing was learned", () => {
    const estimator = new RowEstimator()
    expect(estimator.estimate("k", features("task", 100), 720, 168)).toBe(168)
    expect(estimator.learnedKindCount).toBe(0)
  })

  it("a single measurement becomes the kind's mean (too few points for a slope)", () => {
    const estimator = new RowEstimator()
    estimator.measured("m1", features("task", 100), 720, 200)
    expect(estimator.estimate("k", features("task", 100), 720, 168)).toBe(200)
  })

  it("converges monotonically onto the measured line (synthetic points)", () => {
    const estimator = new RowEstimator()
    // Ground truth: height = 2 · (text/width) + 10 — feed a spread of points.
    for (const x of [0, 0.1, 0.2, 0.4, 0.6, 0.8, 1.0]) {
      estimator.measured(`m-${x}`, features("task", x * 720), 720, 2 * x + 10)
    }
    const at = (text: number) => estimator.estimate(`k-${text}`, features("task", text), 720, 0)
    // Shorter text is never taller — the fit is monotone along x.
    expect(at(0)).toBeCloseTo(10, 6)
    expect(at(180)).toBeCloseTo(10.5, 6)
    expect(at(720)).toBeCloseTo(12, 6)
    expect(at(1800)).toBeCloseTo(15, 6)
    // Interpolated points sit between their neighbors.
    expect(at(360)).toBeGreaterThan(at(180))
    expect(at(360)).toBeLessThan(at(720))
  })

  it("a degenerate (negative-slope) spread collapses to the mean", () => {
    const estimator = new RowEstimator()
    estimator.measured("m1", features("task", 100), 720, 300)
    estimator.measured("m2", features("task", 600), 720, 100)
    estimator.measured("m3", features("task", 1200), 720, 50)
    const estimate = estimator.estimate("k", features("task", 600), 720, 0)
    expect(estimate).toBeCloseTo((300 + 100 + 50) / 3, 6)
  })

  it("per-kind fits separate; an unknown kind borrows the global fit", () => {
    const estimator = new RowEstimator()
    estimator.measured("t1", features("task", 100), 720, 300)
    estimator.measured("t2", features("task", 100), 720, 320)
    estimator.measured("u1", features("message", 100), 720, 60)
    // task kind has its own fit (mean 310). Distinct keys — the pin binds
    // per row, so one key must not answer for another kind.
    expect(estimator.estimate("k-task", features("task", 100), 720, 0)).toBeCloseTo(310, 6)
    // message kind has one point → its mean.
    expect(estimator.estimate("k-message", features("message", 100), 720, 0)).toBe(60)
    // An unseen kind borrows the global fit.
    expect(estimator.estimate("k-review", features("review", 100), 720, 99)).toBeCloseTo(
      (300 + 320 + 60) / 3,
      6,
    )
  })

  it("pins a row's FIRST estimate: same row + same width never re-estimates", () => {
    const estimator = new RowEstimator()
    const first = estimator.estimate("row", features("task", 100), 720, 168)
    expect(first).toBe(168) // unlearned → static fallback
    // Learning lands AFTER the row was placed — other rows' measurements
    // must not move what the reader is already looking at.
    estimator.measured("other", features("task", 100), 720, 400)
    expect(estimator.estimate("row", features("task", 100), 720, 168)).toBe(first)
    // A DIFFERENT width is a different layout — re-estimation is allowed.
    const atOtherWidth = estimator.estimate("row", features("task", 100), 360, 168)
    expect(atOtherWidth).toBe(400)
  })

  it("measuring the row itself unpins it (the cache layer normally short-circuits)", () => {
    const estimator = new RowEstimator()
    estimator.estimate("row", features("task", 100), 720, 168)
    estimator.measured("row", features("task", 100), 720, 410)
    // The pin is gone: the fit's value answers, not the stale 168 (a
    // subsequent estimate call re-pins the new value).
    expect(estimator.estimate("row", features("task", 100), 720, 168)).toBeCloseTo(410, 6)
  })

  it("clear() drops the fits and the pins (stream switch)", () => {
    const estimator = new RowEstimator()
    estimator.measured("m1", features("task", 100), 720, 200)
    estimator.estimate("row", features("task", 100), 720, 168)
    estimator.clear()
    expect(estimator.learnedKindCount).toBe(0)
    expect(estimator.pinnedCount).toBe(0)
    expect(estimator.estimate("row", features("task", 100), 720, 168)).toBe(168)
  })
})

describe("turnRowFeatures", () => {
  it("splits task turns from message turns and sums text lengths", () => {
    expect(turnRowFeatures(taskTurn("t1", "abc"))).toEqual({ kind: "task", text: 3, fixed: 0 })
    expect(turnRowFeatures(messageTurn("hello"))).toEqual({ kind: "message", text: 5, fixed: 0 })
  })

  it("is defensive against malformed turns", () => {
    expect(turnRowFeatures(null)).toEqual({ kind: "message", text: 0, fixed: 0 })
    expect(turnRowFeatures(undefined)).toEqual({ kind: "message", text: 0, fixed: 0 })
    expect(turnRowFeatures({})).toEqual({ kind: "message", text: 0, fixed: 0 })
  })
})

describe("resolveTurnHeight / recordTurnMeasurement (the three levels)", () => {
  it("level 3: nothing known → the static model estimate", () => {
    const model = createTurnHeightModel("w1")
    const turn = taskTurn("t1", "short")
    expect(resolveTurnHeight(turn, model)).toBeGreaterThan(0)
    expect(model.estimator.pinnedCount).toBe(1) // the first estimate pinned
  })

  it("level 2: kind-sibling measurements improve unmeasured rows (pinned)", () => {
    const model = createTurnHeightModel("w1")
    const short = taskTurn("t0", "x".repeat(1000))
    const long = taskTurn("t0b", "x".repeat(3000))
    recordTurnMeasurement(short, model, 200, 720)
    recordTurnMeasurement(long, model, 500, 720)
    // A third task turn (never measured) estimates from the kind's fit —
    // two points are too few for a slope, so the mean applies: something
    // learned, not the static guess, and pinned from here on.
    const sibling = taskTurn("t1", "x".repeat(2000))
    const learned = resolveTurnHeight(sibling, model)
    expect(learned).toBe(350)
    expect(resolveTurnHeight(sibling, model)).toBe(learned)
  })

  it("level 1: a real measurement always wins over the fit", () => {
    const model = createTurnHeightModel("w1")
    const turn = taskTurn("t1")
    recordTurnMeasurement(turn, model, 555, 720)
    expect(resolveTurnHeight(turn, model)).toBe(555)
  })

  it("recordTurnMeasurement reports whether the known height changed", () => {
    const model = createTurnHeightModel("w1")
    const turn = taskTurn("t1")
    expect(recordTurnMeasurement(turn, model, 240, 720)).toBe(true) // unknown → known
    expect(recordTurnMeasurement(turn, model, 240.2, 720)).toBe(false) // sub-half-pixel echo
    expect(recordTurnMeasurement(turn, model, 300, 720)).toBe(true) // real change
    expect(recordTurnMeasurement(turn, model, Number.NaN, 720)).toBe(false) // garbage ignored
  })

  it("model scopes are per stream: a new scope starts from scratch", () => {
    const w1 = createTurnHeightModel("w1")
    const turn = taskTurn("t1")
    recordTurnMeasurement(turn, w1, 240, 720)
    const w2 = createTurnHeightModel("w2")
    expect(w2.cache.get("task-t1")).toBeUndefined()
    expect(resolveTurnHeight(turn, w2)).not.toBe(240)
    expect(w1.scope).toBe("w1")
  })
})
