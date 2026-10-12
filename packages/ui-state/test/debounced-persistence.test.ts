// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Debounced persistence disposal tests (OpenHands `1172ca047` borrowing):
 *   - trailing debounce writes the latest staged value once.
 *   - `clear()` beats a pending save — a delayed write never resurrects
 *     the cleared value.
 *   - `dispose()` (unmount) flushes once synchronously and cancels the
 *     timer; nothing writes after dispose.
 *   - save → clear → dispose never writes; save → dispose writes exactly
 *     the latest value.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createDebouncedPersistence } from "../src/utils/debounced-persistence"

describe("createDebouncedPersistence", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function makeStorage() {
    const writes: string[] = []
    const persistence = createDebouncedPersistence<string>({
      write: (value) => writes.push(value),
      delayMs: 500,
    })
    return { writes, persistence }
  }

  it("writes the staged value after the debounce window", () => {
    const { writes, persistence } = makeStorage()
    persistence.save("Draft")
    expect(writes).toEqual([])
    vi.advanceTimersByTime(499)
    expect(writes).toEqual([])
    vi.advanceTimersByTime(1)
    expect(writes).toEqual(["Draft"])
  })

  it("trailing-debounces: only the latest staged value is written", () => {
    const { writes, persistence } = makeStorage()
    persistence.save("First")
    vi.advanceTimersByTime(200)
    persistence.save("Second")
    vi.advanceTimersByTime(499)
    expect(writes).toEqual([])
    vi.advanceTimersByTime(1)
    expect(writes).toEqual(["Second"])
  })

  it("a clear beats the pending save — the delayed write cannot resurrect it", () => {
    const { writes, persistence } = makeStorage()
    persistence.save("Delivered message")
    vi.advanceTimersByTime(100)
    persistence.clear()
    vi.advanceTimersByTime(1_000)
    expect(writes).toEqual([])
    expect(persistence.hasPending()).toBe(false)
  })

  it("a clear also beats dispose — save, clear, dispose never writes", () => {
    const { writes, persistence } = makeStorage()
    persistence.save("Transient draft")
    vi.advanceTimersByTime(100)
    persistence.clear()
    persistence.dispose()
    vi.advanceTimersByTime(1_000)
    expect(writes).toEqual([])
  })

  it("dispose flushes the pending value once, synchronously", () => {
    const { writes, persistence } = makeStorage()
    persistence.save("Leaving page")
    vi.advanceTimersByTime(100)
    persistence.dispose()
    // Synchronous: no timer advance needed.
    expect(writes).toEqual(["Leaving page"])
    vi.advanceTimersByTime(1_000)
    expect(writes).toEqual(["Leaving page"])
  })

  it("dispose flushes only the latest staged value and cancels the timer", () => {
    const { writes, persistence } = makeStorage()
    persistence.save("First")
    vi.advanceTimersByTime(200)
    persistence.save("Latest")
    vi.advanceTimersByTime(100)
    persistence.dispose()
    expect(writes).toEqual(["Latest"])
    vi.advanceTimersByTime(1_000)
    expect(writes).toEqual(["Latest"])
  })

  it("does not write after dispose", () => {
    const { writes, persistence } = makeStorage()
    persistence.dispose()
    persistence.save("After dispose")
    persistence.flush()
    vi.advanceTimersByTime(1_000)
    expect(writes).toEqual([])
    expect(persistence.hasPending()).toBe(false)
  })

  it("flush writes immediately and dedupes against the last written value", () => {
    const { writes, persistence } = makeStorage()
    persistence.save("Same")
    persistence.flush()
    persistence.save("Same")
    persistence.flush()
    expect(writes).toEqual(["Same"])
    persistence.save("Different")
    vi.advanceTimersByTime(500)
    expect(writes).toEqual(["Same", "Different"])
  })

  it("a re-save of the same text after a clear is written again", () => {
    const { writes, persistence } = makeStorage()
    persistence.save("Typed again")
    vi.advanceTimersByTime(500)
    expect(writes).toEqual(["Typed again"])
    // Storage was cleared out-of-band; the dedupe baseline resets.
    persistence.clear()
    persistence.save("Typed again")
    vi.advanceTimersByTime(500)
    expect(writes).toEqual(["Typed again", "Typed again"])
  })

  it("supports a custom equality for structural dedupe", () => {
    const sink: Array<{ text: string }> = []
    const persistence = createDebouncedPersistence<{ text: string }>({
      write: (value) => sink.push(value),
      delayMs: 100,
      equals: (a, b) => a.text === b.text,
    })
    persistence.save({ text: "x" })
    vi.advanceTimersByTime(100)
    expect(sink).toEqual([{ text: "x" }])
    // Structurally equal to what was written: suppressed.
    persistence.save({ text: "x", extra: true } as { text: string })
    vi.advanceTimersByTime(100)
    expect(sink).toEqual([{ text: "x" }])
    // Structurally different: written.
    persistence.save({ text: "y" })
    vi.advanceTimersByTime(100)
    expect(sink).toEqual([{ text: "x" }, { text: "y" }])
  })

  it("clear before any save keeps the handle usable", () => {
    const { writes, persistence } = makeStorage()
    persistence.clear()
    persistence.save("Fresh")
    expect(persistence.hasPending()).toBe(true)
    vi.advanceTimersByTime(500)
    expect(writes).toEqual(["Fresh"])
  })
})
