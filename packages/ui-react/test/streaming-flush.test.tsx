// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the streaming commit helpers (deepseek chat-demo borrowing):
 * rAF frame coalescing, hidden/pagehide synchronous flush, dispose, and
 * the render-duration throttled markdown hook (ratio + MAX_WAIT cap).
 *
 * rAF is mocked on top of fake timers (one frame per 16ms of fake time);
 * the throttle tests fake the clock (Date + performance) and simulate a
 * commit's duration by advancing the clock between the hook's startRef
 * stamp and its post-commit effect.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as React from "react"
import { act } from "react"
import { createStreamFlusher, useStreamFlusher, type StreamFlusher } from "../src/index.js"
import { cleanup, renderUI } from "./helpers.js"

// ── rAF mock: one animation frame per 16ms of fake timer time ──────────────

let frameSeq = 0
const frameTimers = new Map<number, ReturnType<typeof setTimeout>>()

function installFrameClock() {
  frameSeq = 0
  frameTimers.clear()
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    const id = ++frameSeq
    const timer = setTimeout(() => {
      frameTimers.delete(id)
      cb(performance.now())
    }, 16)
    frameTimers.set(id, timer)
    return id
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    const timer = frameTimers.get(id)
    if (timer) clearTimeout(timer)
    frameTimers.delete(id)
  })
}

const runFrame = (ms = 16) => vi.advanceTimersByTime(ms)

// ── visibilityState stub (jsdom's is a prototype getter) ───────────────────

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: hidden ? "hidden" : "visible",
  })
}

function restoreVisibilityState() {
  delete (document as unknown as { visibilityState?: string }).visibilityState
}

const createdFlushers: StreamFlusher[] = []

function makeFlusher(flush: () => void): StreamFlusher {
  const flusher = createStreamFlusher(flush)
  createdFlushers.push(flusher)
  return flusher
}

beforeEach(() => {
  // performance is faked so the throttle tests can move the commit clock
  // deterministically (vi.setSystemTime drives both Date and performance).
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
  installFrameClock()
})

afterEach(() => {
  for (const flusher of createdFlushers.splice(0)) flusher.dispose()
  restoreVisibilityState()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  cleanup()
})

describe("createStreamFlusher", () => {
  it("commits once per frame no matter how often schedule() fires", () => {
    const flush = vi.fn()
    const flusher = makeFlusher(flush)

    flusher.schedule()
    flusher.schedule()
    flusher.schedule()
    expect(flush).not.toHaveBeenCalled()

    runFrame()
    expect(flush).toHaveBeenCalledTimes(1)

    // The next frame commits again — scheduling never latches off. The
    // adaptive floor (min 33ms, stretched to the measured commit cost ×3)
    // defers the commit to the first frame at/after the floor, so with a
    // 16ms frame cadence it lands three frames after the schedule.
    flusher.schedule()
    runFrame() // cost meter for the first commit lands → floor 16×3 = 48
    runFrame() // elapsed 32 < 48 — deferred
    runFrame() // elapsed 48 ≥ 48 — commits
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it("flushNow commits synchronously and cancels the pending frame", () => {
    const flush = vi.fn()
    const flusher = makeFlusher(flush)

    flusher.schedule()
    flusher.flushNow()
    expect(flush).toHaveBeenCalledTimes(1)

    // The scheduled frame was cancelled — nothing commits on its turn.
    runFrame()
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it("flushes synchronously when the document hides (rAF is paused)", () => {
    const flush = vi.fn()
    const flusher = makeFlusher(flush)

    flusher.schedule()
    setHidden(true)
    document.dispatchEvent(new Event("visibilitychange"))
    expect(flush).toHaveBeenCalledTimes(1)

    // And the frame that was pending is gone — no double commit.
    runFrame()
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it("does not flush on a visible transition", () => {
    const flush = vi.fn()
    const flusher = makeFlusher(flush)

    flusher.schedule()
    document.dispatchEvent(new Event("visibilitychange"))
    expect(flush).not.toHaveBeenCalled()

    runFrame()
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it("flushes synchronously on pagehide", () => {
    const flush = vi.fn()
    const flusher = makeFlusher(flush)

    flusher.schedule()
    window.dispatchEvent(new Event("pagehide"))
    expect(flush).toHaveBeenCalledTimes(1)

    runFrame()
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it("dispose cancels the pending frame and detaches the listeners", () => {
    const flush = vi.fn()
    const flusher = makeFlusher(flush)

    flusher.schedule()
    flusher.dispose()
    runFrame()
    expect(flush).not.toHaveBeenCalled()

    // Post-dispose calls are no-ops and the lifecycle listeners are gone.
    flusher.schedule()
    setHidden(true)
    document.dispatchEvent(new Event("visibilitychange"))
    window.dispatchEvent(new Event("pagehide"))
    runFrame()
    expect(flush).not.toHaveBeenCalled()
  })
})

// ── adaptive floor (hermes use-message-stream borrowing) ───────────────────
//
// A manual frame clock for floor tests: frames are queued at
// `now + delay` and fire with the CURRENT now as their frame-start stamp,
// so a test can stretch the distance to the next frame to simulate
// main-thread contention (the cost meter measures exactly that distance).

function installManualClock() {
  let seq = 0
  let now = 0
  const pending = new Map<number, { cb: FrameRequestCallback; at: number }>()
  const clock = {
    get now() {
      return now
    },
    delay: 16,
    set(t: number) {
      now = t
    },
    /** Fire every pending frame due at or before `now`, in due order. */
    fireFrames() {
      const due = [...pending.entries()]
        .filter(([, entry]) => entry.at <= now)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])
      for (const [id, entry] of due) {
        pending.delete(id)
        entry.cb(now)
      }
    },
    pending: () => pending.size,
  }
  vi.stubGlobal("performance", { now: () => now })
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    const id = ++seq
    pending.set(id, { cb, at: now + clock.delay })
    return id
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    pending.delete(id)
  })
  return clock
}

describe("createStreamFlusher adaptive floor", () => {
  it("keeps scheduled commits at least 33ms apart", () => {
    // 8ms frames: measured cost 8 → cost×3=24 under the 33ms minimum, so
    // the plain floor governs.
    const clock = installManualClock()
    clock.delay = 8
    const stamps: number[] = []
    const flusher = makeFlusher(() => stamps.push(clock.now))

    flusher.schedule()
    clock.set(8)
    clock.fireFrames()
    expect(stamps).toEqual([8])

    // The meter (cost 8) lands, floor = max(33, 24) = 33; the commit
    // defers frame by frame until 33ms have passed since the first one.
    flusher.schedule()
    for (let t = 16; stamps.length < 2; t += 8) {
      clock.set(t)
      clock.fireFrames()
    }
    expect(stamps[1]! - stamps[0]!).toBeGreaterThanOrEqual(33)
    // One-frame granularity: the first frame past the deadline commits.
    expect(stamps[1]! - stamps[0]!).toBeLessThanOrEqual(33 + 8)
  })

  it("stretches the floor to the measured commit cost ×3 under contention", () => {
    const clock = installManualClock()
    const stamps: number[] = []
    const flusher = makeFlusher(() => stamps.push(clock.now))

    flusher.schedule()
    clock.set(16)
    clock.fireFrames()
    expect(stamps).toEqual([16])

    // The cost meter for the first commit measures a 16ms frame distance
    // → floor = 16×3 = 48 (above the 33ms minimum).
    flusher.schedule()
    for (let t = 32; stamps.length < 2; t += 16) {
      clock.set(t)
      clock.fireFrames()
    }
    expect(stamps[1]! - stamps[0]!).toBe(48)
  })

  it("caps the stretched floor at 250ms (≥4 commits/sec)", () => {
    const clock = installManualClock()
    const stamps: number[] = []
    const flusher = makeFlusher(() => stamps.push(clock.now))

    flusher.schedule()
    clock.set(16)
    clock.fireFrames()
    expect(stamps).toEqual([16])

    // Congested next frame: the cost meter fires 90ms after the commit →
    // 90×3 = 270, capped at 250.
    clock.set(106)
    clock.fireFrames()
    expect(clock.pending()).toBe(0)

    // Back to a normal cadence: the commit waits out the capped floor.
    flusher.schedule()
    for (let t = 122; stamps.length < 2; t += 16) {
      clock.set(t)
      clock.fireFrames()
    }
    expect(stamps[1]! - stamps[0]!).toBe(250)
  })

  it("flushNow bypasses the floor", () => {
    const clock = installManualClock()
    const stamps: number[] = []
    const flusher = makeFlusher(() => stamps.push(clock.now))

    flusher.schedule()
    clock.set(16)
    clock.fireFrames()
    expect(stamps).toEqual([16])

    // 4ms after the commit — far inside the floor — and it still commits.
    clock.set(20)
    flusher.flushNow()
    expect(stamps).toEqual([16, 20])

    // The scheduled cadence resumes against the last scheduled commit,
    // still floored (the flushNow stamp does not reset the meter).
    flusher.schedule()
    for (let t = 32; stamps.length < 3; t += 16) {
      clock.set(t)
      clock.fireFrames()
    }
    expect(stamps[2]! - stamps[0]!).toBeGreaterThanOrEqual(48)
  })
})

// ── useStreamFlusher ───────────────────────────────────────────────────────

function FlushProbe({ flush, mode }: { flush: () => void; mode: "schedule" | "flushNow" }) {
  const flusher = useStreamFlusher(flush)
  React.useEffect(() => {
    if (mode === "schedule") flusher.schedule()
    else flusher.flushNow()
  }, [flusher, mode])
  return null
}

describe("useStreamFlusher", () => {
  it("coalesces effect-driven schedules into one commit per frame", () => {
    const flush = vi.fn()
    renderUI(<FlushProbe flush={flush} mode="schedule" />)

    runFrame()
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it("flushNow applies synchronously on mount", () => {
    const flush = vi.fn()
    renderUI(<FlushProbe flush={flush} mode="flushNow" />)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it("survives StrictMode's simulated unmount/remount", () => {
    const flush = vi.fn()
    renderUI(
      <React.StrictMode>
        <FlushProbe flush={flush} mode="schedule" />
      </React.StrictMode>,
    )

    // The remount re-arms the flusher: its frame commits exactly once.
    runFrame()
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it("disposes on unmount: pending frame cancelled, listeners detached", () => {
    const flush = vi.fn()
    const { unmount } = renderUI(<FlushProbe flush={flush} mode="schedule" />)

    unmount()
    runFrame()
    expect(flush).not.toHaveBeenCalled()

    setHidden(true)
    document.dispatchEvent(new Event("visibilitychange"))
    window.dispatchEvent(new Event("pagehide"))
    expect(flush).not.toHaveBeenCalled()
  })
})
