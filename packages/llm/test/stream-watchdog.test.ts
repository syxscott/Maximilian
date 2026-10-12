// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Per-attempt LLM stream watchdogs (minimax f07e6ef borrowing): first-event
 * and idle bounds end the attempt with a retryable timeout error (never an
 * abort), are env-configurable, and drop streams whose provider ignores the
 * abort.
 */
import { describe, expect, it, vi, afterEach } from "vitest"
import {
  guardedLLMCall,
  guardedLLMStream,
  isLLMStreamTimeoutError,
  LLM_STREAM_TIMEOUT_MESSAGE_PREFIX,
  resolveLLMStreamTimeouts,
  LLM_FIRST_EVENT_TIMEOUT_ENV,
  LLM_STREAM_IDLE_TIMEOUT_ENV,
  LLM_FIRST_EVENT_TIMEOUT_MS,
  LLM_STREAM_IDLE_TIMEOUT_MS,
  type LLMStreamTimeouts,
} from "../src/stream-watchdog.js"

afterEach(() => {
  vi.useRealTimers()
})

const ALWAYS: LLMStreamTimeouts = { firstEventTimeoutMs: 50, idleTimeoutMs: 50 }

const streamOf = async function* <T>(items: T[]): AsyncGenerator<T, void, void> {
  for (const item of items) yield item
}

const neverSettlingStream = (): AsyncGenerator<string, void, void> =>
  (async function* () {
    await new Promise<void>(() => undefined) // never yields, never returns
  })()

const collect = async (iterable: AsyncIterable<string>): Promise<string[]> => {
  const out: string[] = []
  for await (const item of iterable) out.push(item)
  return out
}

/** Start the stream and capture its rejection (or undefined resolve). */
const failureOf = (attempt: AsyncIterable<string>): Promise<Error | undefined> => {
  let iterator: AsyncIterator<string>
  return (async () => {
    iterator = attempt[Symbol.asyncIterator]()
    for (;;) {
      try {
        const next = await iterator.next()
        if (next.done) return undefined
      } catch (err) {
        return err as Error
      }
    }
  })()
}

describe("resolveLLMStreamTimeouts", () => {
  it("falls back to the built-in defaults", () => {
    expect(resolveLLMStreamTimeouts({}, {})).toEqual({
      firstEventTimeoutMs: LLM_FIRST_EVENT_TIMEOUT_MS,
      idleTimeoutMs: LLM_STREAM_IDLE_TIMEOUT_MS,
    })
  })

  it("env overrides win over defaults; explicit config wins over env", () => {
    const env = {
      [LLM_FIRST_EVENT_TIMEOUT_ENV]: "1234",
      [LLM_STREAM_IDLE_TIMEOUT_ENV]: "5678",
    }
    expect(resolveLLMStreamTimeouts({}, env)).toEqual({
      firstEventTimeoutMs: 1234,
      idleTimeoutMs: 5678,
    })
    expect(resolveLLMStreamTimeouts({ firstEventTimeoutMs: 1 }, env)).toEqual({
      firstEventTimeoutMs: 1,
      idleTimeoutMs: 5678,
    })
  })

  it("0 disables a bound; invalid values fall through", () => {
    expect(resolveLLMStreamTimeouts({ firstEventTimeoutMs: 0 }, {})).toEqual({
      firstEventTimeoutMs: 0,
      idleTimeoutMs: LLM_STREAM_IDLE_TIMEOUT_MS,
    })
    expect(resolveLLMStreamTimeouts({}, { [LLM_FIRST_EVENT_TIMEOUT_ENV]: "not-a-number" })).toEqual(
      {
        firstEventTimeoutMs: LLM_FIRST_EVENT_TIMEOUT_MS,
        idleTimeoutMs: LLM_STREAM_IDLE_TIMEOUT_MS,
      },
    )
    expect(resolveLLMStreamTimeouts({ firstEventTimeoutMs: -3 }, {})).toEqual({
      firstEventTimeoutMs: LLM_FIRST_EVENT_TIMEOUT_MS,
      idleTimeoutMs: LLM_STREAM_IDLE_TIMEOUT_MS,
    })
  })
})

describe("guardedLLMStream — first-event bound", () => {
  it("a provider that never sends a first event fails as a retryable timeout", async () => {
    vi.useFakeTimers()
    const failure = failureOf(guardedLLMStream(() => neverSettlingStream(), ALWAYS))
    await vi.advanceTimersByTimeAsync(50)
    const err = await failure
    expect(isLLMStreamTimeoutError(err!)).toBe(true)
    expect(err!.message).toContain(LLM_STREAM_TIMEOUT_MESSAGE_PREFIX)
    expect(err!.message).toContain("first-event")
  })

  it("a healthy stream passes through completely", async () => {
    const out = await collect(guardedLLMStream(() => streamOf(["a", "b", "c"]), ALWAYS))
    expect(out).toEqual(["a", "b", "c"])
  })
})

describe("guardedLLMStream — idle bound", () => {
  it("a stream that stalls mid-response fails with the idle timeout", async () => {
    vi.useFakeTimers()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const stalling = (async function* () {
      yield "first"
      await gate // silence after the first event
    })()
    const attempt = guardedLLMStream(() => Promise.resolve(stalling), ALWAYS)
    const iterator = attempt[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toBe("first")
    const failure = iterator.next().then(
      () => undefined as unknown as Error,
      (err: Error) => err,
    )
    await vi.advanceTimersByTimeAsync(50)
    const err = await failure
    expect(isLLMStreamTimeoutError(err)).toBe(true)
    expect(err.message).toContain("idle")
    release?.()
  })

  it("slow-but-alive streams are not cut (the idle bound re-arms per event)", async () => {
    vi.useFakeTimers()
    const attempt = guardedLLMStream(() => streamOf(["a", "b", "c"]), {
      firstEventTimeoutMs: 100,
      idleTimeoutMs: 100,
    })
    const out: string[] = []
    for await (const item of attempt) {
      out.push(item)
      await vi.advanceTimersByTimeAsync(90) // gaps under the bound
    }
    expect(out).toEqual(["a", "b", "c"])
  })
})

describe("guardedLLMStream — abort semantics", () => {
  it("a caller abort propagates as the caller's error, not a timeout", async () => {
    const controller = new AbortController()
    let watchdogSignal: AbortSignal | undefined
    const inner = (async function* () {
      yield "first"
      // The provider honors the watchdog signal — the abort surfaces.
      await new Promise<void>((_, reject) => {
        watchdogSignal!.addEventListener("abort", () => reject(watchdogSignal!.reason), {
          once: true,
        })
      })
    })()
    const attempt = guardedLLMStream(
      (signal) => {
        watchdogSignal = signal
        return Promise.resolve(inner)
      },
      ALWAYS,
      controller.signal,
    )
    const iterator = attempt[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toBe("first")
    controller.abort()
    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" })
  })

  it("a stream that ignores the abort cannot hang the wrapper (stop-signal race)", async () => {
    vi.useFakeTimers()
    const failure = failureOf(guardedLLMStream(() => neverSettlingStream(), ALWAYS))
    await vi.advanceTimersByTimeAsync(50)
    const err = await failure
    expect(isLLMStreamTimeoutError(err!)).toBe(true)
  })
})

describe("guardedLLMCall — non-streaming bound", () => {
  it("a call that never answers fails as a retryable timeout", async () => {
    vi.useFakeTimers()
    const failure = guardedLLMCall(() => new Promise<string>(() => undefined), 25).then(
      (v) => v,
      (err: Error) => err,
    )
    await vi.advanceTimersByTimeAsync(25)
    const err = await failure
    expect(isLLMStreamTimeoutError(err)).toBe(true)
  })

  it("a completing call passes through", async () => {
    const out = await guardedLLMCall(async () => "ok", 100)
    expect(out).toBe("ok")
  })

  it("a bound of 0 disables the watchdog", async () => {
    const out = await guardedLLMCall(async () => "ok", 0)
    expect(out).toBe("ok")
  })
})
