// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Debounced persistence with unmount-safe disposal semantics (OpenHands
 * `1172ca047` use-draft-persistence borrowing).
 *
 * The failure mode this prevents: a debounced write survives the component
 * that scheduled it. When the component unmounts (or the editor is
 * switched), a pending timer fires later and:
 *   - resurrects a draft the user already cleared ("clear loses to the
 *     pending save"), or
 *   - writes text captured for one key into another key after a fast
 *     switch.
 *
 * Contract:
 *   - `save(value)` schedules a trailing-debounce write of `value`.
 *   - `clear()` wins over any pending save: the timer is cancelled WITHOUT
 *     flushing and the staged value is dropped, so a delayed write can
 *     never resurrect what was cleared.
 *   - `dispose()` (unmount cleanup) synchronously flushes a pending save
 *     ONCE and cancels the timer — no write ever fires after dispose, and
 *     a clear issued before dispose still wins.
 *   - `flush()` writes a pending value immediately (navigation, submit).
 *   - A value equal to the last written one (default `Object.is`) is not
 *     written again.
 *
 * Framework-free: works with any storage backend (localStorage, a Zustand
 * store, a server sync client) and with `vi.useFakeTimers()` in tests.
 */

export interface DebouncedPersistenceOptions<T> {
  /** Persist one value. Called at most once per staged value. */
  write: (value: T) => void
  /** Debounce window in milliseconds. */
  delayMs: number
  /** Equality used to skip redundant writes. Default: `Object.is`. */
  equals?: (a: T, b: T) => boolean
}

export interface DebouncedPersistenceHandle<T> {
  /** Stage `value` and (re)start the debounce timer. */
  save(value: T): void
  /**
   * Record that the persisted value was cleared. Cancels the pending save
   * without flushing it — the clear wins over the in-flight write.
   */
  clear(): void
  /** Write the pending value now, if one is staged. */
  flush(): void
  /** True while a save is staged but not yet written. */
  hasPending(): boolean
  /**
   * Unmount cleanup: flush the pending save once, cancel the timer, and
   * make every later save/flush/clear a no-op.
   */
  dispose(): void
}

export function createDebouncedPersistence<T>(
  opts: DebouncedPersistenceOptions<T>,
): DebouncedPersistenceHandle<T> {
  const equals = opts.equals ?? Object.is
  let staged: { value: T } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastWritten: T | undefined
  let hasWritten = false
  let disposed = false

  const cancelTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const writeStaged = () => {
    const pending = staged
    staged = undefined
    if (pending === undefined) return
    if (hasWritten && equals(pending.value, lastWritten as T)) return
    lastWritten = pending.value
    hasWritten = true
    opts.write(pending.value)
  }

  return {
    save(value: T) {
      if (disposed) return
      cancelTimer()
      staged = { value }
      timer = setTimeout(() => {
        timer = undefined
        writeStaged()
      }, opts.delayMs)
    },

    clear() {
      if (disposed) return
      // The clear wins: drop the staged value instead of flushing it, so a
      // delayed write can never resurrect what was cleared.
      cancelTimer()
      staged = undefined
      lastWritten = undefined
      hasWritten = false
    },

    flush() {
      if (disposed) return
      cancelTimer()
      writeStaged()
    },

    hasPending() {
      return staged !== undefined
    },

    dispose() {
      if (disposed) return
      disposed = true
      cancelTimer()
      // Synchronous one-shot flush so the latest staged value survives
      // unmount; after this no scheduled write can ever fire.
      writeStaged()
    },
  }
}
