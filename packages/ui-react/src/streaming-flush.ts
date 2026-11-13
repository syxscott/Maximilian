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
 */

import { useEffect, useMemo, useRef } from "react"

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
 */
export const createStreamFlusher = (flush: () => void): StreamFlusher => {
  let frame = 0
  let disposed = false

  const flushNow = () => {
    if (disposed) return
    if (frame !== 0) {
      cancelAnimationFrame(frame)
      frame = 0
    }
    flush()
  }

  const commit = () => {
    frame = 0
    flush()
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
