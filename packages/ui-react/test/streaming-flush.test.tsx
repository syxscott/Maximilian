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

    // The next frame commits again — scheduling never latches off.
    flusher.schedule()
    runFrame()
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
