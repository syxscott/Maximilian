// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Chunked timeout scheduling (minimax c172cf9 borrowing): delays above
 * Node's 2^31-1 ms setTimeout clamp must fire at the REQUESTED deadline, not
 * be clamped to 1 ms and fire immediately. Clock-injected via vi.useFakeTimers.
 */
import { describe, expect, it, vi, afterEach } from "vitest"
import {
  MAX_TIMER_DELAY_MS,
  abortSignalAfterChunks,
  scheduleTimeoutChunks,
} from "../src/timeout-chunks.js"

afterEach(() => {
  vi.useRealTimers()
})

describe("scheduleTimeoutChunks", () => {
  it("keeps sub-limit delays on a single timer", () => {
    vi.useFakeTimers()
    const fired = vi.fn()
    scheduleTimeoutChunks(fired, 1_000)
    vi.advanceTimersByTime(999)
    expect(fired).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fired).toHaveBeenCalledTimes(1)
  })

  it("fires immediately for zero/negative delays", () => {
    const fired = vi.fn()
    scheduleTimeoutChunks(fired, 0)
    scheduleTimeoutChunks(fired, -5)
    expect(fired).toHaveBeenCalledTimes(2)
  })

  it("fires delays above the Node timer limit only at the requested deadline", () => {
    vi.useFakeTimers()
    const fired = vi.fn()
    // 100 ms beyond the 32-bit limit; a plain setTimeout would clamp this to
    // 1 ms and fire almost immediately.
    const delay = MAX_TIMER_DELAY_MS + 100
    scheduleTimeoutChunks(fired, delay)
    vi.advanceTimersByTime(MAX_TIMER_DELAY_MS)
    expect(fired).not.toHaveBeenCalled()
    vi.advanceTimersByTime(99)
    expect(fired).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fired).toHaveBeenCalledTimes(1)
  })

  it("chains arbitrarily many chunks (4x the timer limit)", () => {
    vi.useFakeTimers()
    const fired = vi.fn()
    const delay = MAX_TIMER_DELAY_MS * 4 + 7
    scheduleTimeoutChunks(fired, delay)
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(MAX_TIMER_DELAY_MS)
      expect(fired).not.toHaveBeenCalled()
    }
    vi.advanceTimersByTime(6)
    expect(fired).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fired).toHaveBeenCalledTimes(1)
  })

  it("cancel mid-chain prevents every later chunk from firing", () => {
    vi.useFakeTimers()
    const fired = vi.fn()
    const scheduled = scheduleTimeoutChunks(fired, MAX_TIMER_DELAY_MS * 2)
    vi.advanceTimersByTime(MAX_TIMER_DELAY_MS)
    expect(fired).not.toHaveBeenCalled()
    scheduled.clear()
    vi.advanceTimersByTime(MAX_TIMER_DELAY_MS * 10)
    expect(fired).not.toHaveBeenCalled()
  })

  it("chunks preserve the exact total (no drift per chunk)", () => {
    vi.useFakeTimers()
    const fired = vi.fn()
    scheduleTimeoutChunks(fired, MAX_TIMER_DELAY_MS + 1)
    vi.advanceTimersByTime(MAX_TIMER_DELAY_MS + 1)
    expect(fired).toHaveBeenCalledTimes(1)
  })
})

describe("abortSignalAfterChunks", () => {
  it("aborts at the requested deadline, even above the timer limit", () => {
    vi.useFakeTimers()
    const { signal } = abortSignalAfterChunks(MAX_TIMER_DELAY_MS + 500)
    expect(signal.aborted).toBe(false)
    vi.advanceTimersByTime(MAX_TIMER_DELAY_MS)
    expect(signal.aborted).toBe(false)
    vi.advanceTimersByTime(499)
    expect(signal.aborted).toBe(false)
    vi.advanceTimersByTime(1)
    expect(signal.aborted).toBe(true)
  })

  it("clear() prevents the abort", () => {
    vi.useFakeTimers()
    const { signal, clear } = abortSignalAfterChunks(1_000)
    clear()
    vi.advanceTimersByTime(5_000)
    expect(signal.aborted).toBe(false)
  })
})
