// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Per-attempt LLM stream watchdogs (minimax f07e6ef withLLMStreamTimeouts
 * borrowing, adapted to Maximilian's Provider layer).
 *
 * Two bounds guard every physical request attempt:
 *
 *   - firstEventTimeoutMs bounds the wait for the first stream event —
 *     effectively a first-byte bound: a request the provider accepted but
 *     never answers fails here instead of hanging until an outer request
 *     limit.
 *   - idleTimeoutMs bounds the gap between consecutive events after the
 *     first one, so a stream that stalls mid-response also fails.
 *
 * A timeout ends the attempt with a RETRYABLE timeout error (never a user
 * abort), so the surrounding retry layer takes over. If the provider ignores
 * the abort of the abandoned stream, the wrapper races a stop signal and
 * drops the stream instead of hanging on it.
 *
 * `0` disables the corresponding bound. Env overrides:
 * `MAXIMILIAN_LLM_FIRST_EVENT_TIMEOUT_MS` / `MAXIMILIAN_LLM_STREAM_IDLE_TIMEOUT_MS`.
 */

/** Default per-attempt wait for the first provider stream event (undici's 300s headers bound). */
export const LLM_FIRST_EVENT_TIMEOUT_MS = 300 * 1000

/** Default per-attempt maximum gap between provider stream events after the first one. */
export const LLM_STREAM_IDLE_TIMEOUT_MS = 300 * 1000

/** Environment override (milliseconds) for the first-event bound. */
export const LLM_FIRST_EVENT_TIMEOUT_ENV = "MAXIMILIAN_LLM_FIRST_EVENT_TIMEOUT_MS"

/** Environment override (milliseconds) for the idle bound. */
export const LLM_STREAM_IDLE_TIMEOUT_ENV = "MAXIMILIAN_LLM_STREAM_IDLE_TIMEOUT_MS"

export interface LLMStreamTimeouts {
  readonly firstEventTimeoutMs: number
  readonly idleTimeoutMs: number
}

export interface LLMStreamTimeoutConfig {
  readonly firstEventTimeoutMs?: number
  readonly streamIdleTimeoutMs?: number
}

/** Marker carried by every synthesized timeout message (matches retry classifiers). */
export const LLM_STREAM_TIMEOUT_MESSAGE_PREFIX = "LLM request timed out"

/** True when `err` was produced by this watchdog (a retryable timeout). */
export function isLLMStreamTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.name === LLM_STREAM_TIMEOUT_ERROR_NAME &&
    err.message.startsWith(LLM_STREAM_TIMEOUT_MESSAGE_PREFIX)
  )
}

const LLM_STREAM_TIMEOUT_ERROR_NAME = "LLMStreamTimeoutError"

export class LLMStreamTimeoutError extends Error {
  constructor(phase: "first-event" | "idle", timeoutMs: number) {
    super(
      `${LLM_STREAM_TIMEOUT_MESSAGE_PREFIX}: no ${phase === "first-event" ? "first" : "stream"} event within ${timeoutMs}ms (${phase} timeout)`,
    )
    this.name = LLM_STREAM_TIMEOUT_ERROR_NAME
  }
}

function validTimeout(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return undefined
  return value
}

function parseTimeout(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined
  return validTimeout(Number.parseInt(raw, 10))
}

/**
 * Resolve the effective watchdog bounds. Precedence: explicit config →
 * environment override → built-in default. Invalid values (negative,
 * non-integer, non-numeric) fall through to the next source. `0` disables.
 */
export function resolveLLMStreamTimeouts(
  config: LLMStreamTimeoutConfig = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): LLMStreamTimeouts {
  return {
    firstEventTimeoutMs:
      validTimeout(config.firstEventTimeoutMs) ??
      parseTimeout(env[LLM_FIRST_EVENT_TIMEOUT_ENV]) ??
      LLM_FIRST_EVENT_TIMEOUT_MS,
    idleTimeoutMs:
      validTimeout(config.streamIdleTimeoutMs) ??
      parseTimeout(env[LLM_STREAM_IDLE_TIMEOUT_ENV]) ??
      LLM_STREAM_IDLE_TIMEOUT_MS,
  }
}

/** Unref'd timer arm so a pending watchdog never keeps the process alive. */
function armTimer(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(fn, ms) as ReturnType<typeof setTimeout> & { unref?: () => void }
  timer.unref?.()
  return timer
}

/**
 * Guard one request attempt opened by `open`.
 *
 * The wrapper opens the inner stream with a watchdog-owned signal (linked to
 * the caller's), arms the first-event bound, then re-arms the idle bound
 * after every event. On a bound firing — or the provider ignoring abort and
 * never settling — the returned async iterable throws a
 * {@link LLMStreamTimeoutError}; a caller abort propagates as that abort.
 */
export async function* guardedLLMStream<T>(
  open: (signal: AbortSignal) => Promise<AsyncIterable<T>> | AsyncIterable<T>,
  timeouts: LLMStreamTimeouts,
  callerSignal?: AbortSignal,
): AsyncGenerator<T, void, void> {
  const watchdog = new AbortController()
  const bothDisabled = timeouts.firstEventTimeoutMs <= 0 && timeouts.idleTimeoutMs <= 0
  if (callerSignal?.aborted) {
    watchdog.abort(callerSignal.reason)
    throw callerSignal.reason instanceof Error
      ? callerSignal.reason
      : new Error("aborted before the stream opened")
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut: ((err: LLMStreamTimeoutError) => void) | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timedOut = (err) => reject(err)
  })
  let stopped: ((reason: unknown) => void) | undefined
  const stopPromise = new Promise<never>((_, reject) => {
    stopped = (reason) => reject(reason)
  })
  // Rejected stop/timeout promises must not surface as unhandled rejections
  // when neither fires.
  stopPromise.catch(() => undefined)
  timeoutPromise.catch(() => undefined)

  const clearTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const fire = (phase: "first-event" | "idle", ms: number): void => {
    clearTimer()
    const err = new LLMStreamTimeoutError(phase, ms)
    watchdog.abort(err)
    timedOut?.(err)
  }

  const onCallerAbort = (): void => {
    clearTimer()
    watchdog.abort(callerSignal?.reason)
    stopped?.(callerSignal?.reason instanceof Error ? callerSignal.reason : new Error("aborted"))
  }
  if (callerSignal) {
    callerSignal.addEventListener("abort", onCallerAbort, { once: true })
  }

  const arm = (phase: "first-event" | "idle"): void => {
    const ms = phase === "first-event" ? timeouts.firstEventTimeoutMs : timeouts.idleTimeoutMs
    if (ms <= 0 || bothDisabled) return
    timer = armTimer(() => {
      if (callerSignal?.aborted) return
      fire(phase, ms)
    }, ms)
  }
  arm("first-event")

  type Next = IteratorResult<T, undefined>
  const raceNext = (next: Promise<Next>): Promise<Next> =>
    Promise.race([next, timeoutPromise, stopPromise])

  let iterator: AsyncIterator<T> | undefined
  try {
    const opened = await Promise.race([
      Promise.resolve(open(watchdog.signal)),
      timeoutPromise,
      stopPromise,
    ])
    iterator = (opened as AsyncIterable<T>)[Symbol.asyncIterator]()
    for (;;) {
      const next = await raceNext(iterator.next())
      if (next.done) return
      clearTimer()
      arm("idle")
      yield next.value
    }
  } finally {
    clearTimer()
    callerSignal?.removeEventListener("abort", onCallerAbort)
    // Best-effort cleanup of an abandoned inner stream (the provider may
    // ignore the watchdog abort): pulling return() so the underlying HTTP
    // body is released, without waiting on a stream that never settles.
    const it = iterator
    iterator = undefined
    if (it && typeof it.return === "function") {
      try {
        it.return(undefined as never).catch(() => undefined)
      } catch {
        // The stream is already dead — nothing to release.
      }
    }
  }
}

/**
 * Bound a whole non-streaming request attempt (chat completion) by the
 * first-event timeout: a request the provider accepted but never answers
 * fails as a retryable {@link LLMStreamTimeoutError} instead of hanging.
 * A caller abort is propagated through the linked signal as usual.
 */
export async function guardedLLMCall<T>(
  call: (signal: AbortSignal) => Promise<T>,
  firstEventTimeoutMs: number,
  callerSignal?: AbortSignal,
): Promise<T> {
  if (callerSignal?.aborted) {
    throw callerSignal.reason instanceof Error
      ? callerSignal.reason
      : new Error("aborted before the call opened")
  }
  const watchdog = new AbortController()
  const onCallerAbort = (): void => watchdog.abort(callerSignal?.reason)
  if (callerSignal) {
    callerSignal.addEventListener("abort", onCallerAbort, { once: true })
  }
  if (firstEventTimeoutMs <= 0) {
    if (callerSignal) {
      callerSignal.removeEventListener("abort", onCallerAbort)
    }
    return call(watchdog.signal)
  }
  let timedOut: ((err: LLMStreamTimeoutError) => void) | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timedOut = (err) => reject(err)
  })
  timeoutPromise.catch(() => undefined)
  const timer = armTimer(() => {
    if (callerSignal?.aborted) return
    const err = new LLMStreamTimeoutError("first-event", firstEventTimeoutMs)
    watchdog.abort(err)
    timedOut?.(err)
  }, firstEventTimeoutMs)
  try {
    return await Promise.race([call(watchdog.signal), timeoutPromise])
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener("abort", onCallerAbort)
  }
}
