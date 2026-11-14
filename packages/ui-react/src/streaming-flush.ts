// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Streaming commit helpers (deepseek chat-demo borrowing).
 *
 * Ported from deepseek-ai/chat-demo:
 *   - `store.ts` streamReply / bindChatPersistence → `createStreamFlusher` /
 *     `useStreamFlusher`: stream deltas land in memory first and commit once
 *     per animation frame; visibilitychange→hidden and pagehide commit
 *     synchronously because the browser pauses rAF while hidden, so deltas
 *     accumulated during that window would otherwise never paint.
 *
 * Scheduled commits additionally carry an adaptive floor (hermes
 * use-message-stream borrowing): at least 33ms apart, stretched to the
 * last commit's measured cost ×3 when the main thread is congested,
 * capped at 250ms so the stream still paints ≥4 times per second.
 */

import { useEffect, useMemo, useRef } from "react"

/** Minimum wall-clock distance between two scheduled commits (≈30/s). */
const MIN_FLUSH_INTERVAL_MS = 33
/**
 * Contention stretch (hermes use-message-stream borrowing): the floor
 * grows to the last measured commit cost ×3, backing the cadence off
 * proportionally to how congested the main thread actually was.
 */
const FLOOR_COST_FACTOR = 3
/** Cap keeps the stream committing at least ~4 times per second. */
const MAX_FLUSH_INTERVAL_MS = 250

export interface StreamFlusher {
  /** Coalesce one pending commit into the current animation frame. */
  schedule(): void
  /** Commit synchronously now, cancelling any pending frame. */
  flushNow(): void
  /** Cancel the pending frame and detach the page-lifecycle listeners. */
  dispose(): void
}

/**
 * Create a frame-coalescing flusher around `flush` (deepseek chat-demo
 * borrowing, port of store.ts's `frame ||= requestAnimationFrame(flush)` +
 * `bindChatPersistence`). Repeated `schedule()` calls within one animation
 * frame commit once; `flushNow()` commits immediately and cancels the
 * pending frame; the page-lifecycle listeners mirror bindChatPersistence —
 * when the tab hides or unloads, rAF is paused, so pending deltas flush
 * synchronously instead of waiting for a frame that never fires.
 *
 * Scheduled commits additionally respect an adaptive floor (hermes
 * use-message-stream borrowing): at least 33ms apart, stretched to the
 * last commit's measured cost ×3 when concurrent streams congest the main
 * thread, capped at 250ms. `flushNow()` and the page-lifecycle paths are
 * never floored — they are the urgency hatches.
 */
export const createStreamFlusher = (flush: () => void): StreamFlusher => {
  let frame = 0
  let disposed = false
  /** Frame-start stamp of the last scheduled commit (0 = none yet). */
  let lastFlushAt = 0
  /**
   * Latest measured commit cost: flush start → next frame start (rAF
   * hands us each frame's start stamp). Only the newest measurement is
   * kept — a newer commit's meter replaces any stale one.
   */
  let lastCost = 0
  /** Pending cost-measurement frame, cancelled when a newer one starts. */
  let measure = 0

  const flushNow = () => {
    if (disposed) return
    if (frame !== 0) {
      cancelAnimationFrame(frame)
      frame = 0
    }
    flush()
  }

  /** max(33, lastCost ×3), capped at 250. */
  const floorMs = () =>
    Math.min(MAX_FLUSH_INTERVAL_MS, Math.max(MIN_FLUSH_INTERVAL_MS, lastCost * FLOOR_COST_FACTOR))

  const commit = (frameStart: number) => {
    frame = 0
    // Floor gate: a frame arriving before the floor elapsed defers itself
    // to a later frame instead of committing — schedule() callers keep
    // coalescing into the pending frame meanwhile.
    if (lastFlushAt !== 0 && frameStart - lastFlushAt < floorMs()) {
      frame = requestAnimationFrame(commit)
      return
    }
    lastFlushAt = frameStart
    flush()
    // Cost metering: the commit is not done when flush() returns — it
    // completes when the browser is ready for the NEXT frame. The
    // distance between the two frame-start stamps covers flush() plus
    // everything else delaying that frame (concurrent streams, layout).
    if (measure !== 0) cancelAnimationFrame(measure)
    measure = requestAnimationFrame((nextFrameStart) => {
      measure = 0
      lastCost = nextFrameStart - frameStart
    })
  }

  const schedule = () => {
    if (disposed || frame !== 0) return
    frame = requestAnimationFrame(commit)
  }

  /** Hidden tabs stop rAF — accumulated deltas would never commit. */
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") flushNow()
  }
  const onPageHide = () => flushNow()

  document.addEventListener("visibilitychange", onVisibilityChange)
  window.addEventListener("pagehide", onPageHide)

  return {
    schedule,
    flushNow,
    dispose: () => {
      if (disposed) return
      disposed = true
      if (frame !== 0) {
        cancelAnimationFrame(frame)
        frame = 0
      }
      if (measure !== 0) {
        cancelAnimationFrame(measure)
        measure = 0
      }
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("pagehide", onPageHide)
    },
  }
}

/**
 * Mount-scoped stream flusher. The flush callback is read through a ref so
 * stream handlers stay fresh without re-binding listeners, and the flusher
 * itself is (re)created per effect round: React 19 StrictMode's simulated
 * unmount disposes the first instance, so the stable facade returned here
 * lazily re-creates the inner flusher instead of going dead after remount.
 */
export const useStreamFlusher = (flush: () => void): StreamFlusher => {
  const flushRef = useRef(flush)
  flushRef.current = flush
  const innerRef = useRef<StreamFlusher | null>(null)

  const ensureInner = (): StreamFlusher => {
    let inner = innerRef.current
    if (inner === null) {
      inner = createStreamFlusher(() => flushRef.current())
      innerRef.current = inner
    }
    return inner
  }

  useEffect(() => {
    ensureInner()
    return () => {
      innerRef.current?.dispose()
      innerRef.current = null
    }
  }, [])

  // Stable facade: methods delegate to the live inner flusher, which the
  // effect above (re)creates — so a StrictMode remount re-arms instead of
  // leaving a disposed coalescer behind.
  return useMemo<StreamFlusher>(
    () => ({
      schedule: () => ensureInner().schedule(),
      flushNow: () => ensureInner().flushNow(),
      dispose: () => {
        innerRef.current?.dispose()
        innerRef.current = null
      },
    }),
    [],
  )
}
