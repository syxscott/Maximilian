// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SSE keepalive loop tests (pi reconnect.ts borrowing mechanism): every
 * timing behavior is driven through an injected environment with a manual
 * clock, so backoff doubling, stability reset, handshake timeout, wake
 * semantics, silence replacement and the canRetry gate are verified
 * deterministically — no real sockets, no real timers.
 */
import { describe, it, expect, vi } from "vitest"
import {
  browserEnvironment,
  createSseKeepalive,
  RETRY_INITIAL_MS,
  RETRY_MAX_MS,
  STABLE_MS,
  CONNECT_TIMEOUT_MS,
  STALE_MS,
  WAKE_GRACE_MS,
  type KeepaliveEnvironment,
  type KeepaliveSocketEvents,
} from "../src/lib/sse-keepalive"

/** Deterministic timer/clock/wake environment (the loop sees only this). */
class FakeEnvironment implements KeepaliveEnvironment {
  clock = 0
  /** Artificial lateness applied when a timer fires (throttled page). */
  late = 0
  private onlineFlag = true
  private timers: { at: number; callback: () => void; id: number }[] = []
  private nextId = 1
  wakeListeners = new Set<() => void>()
  logs: string[] = []

  now(): number {
    return this.clock
  }

  after(ms: number, callback: () => void): () => void {
    const id = this.nextId++
    this.timers.push({ at: this.clock + ms, callback, id })
    return () => {
      this.timers = this.timers.filter((t) => t.id !== id)
    }
  }

  online(): boolean {
    return this.onlineFlag
  }

  setOnline(value: boolean): void {
    this.onlineFlag = value
  }

  onWake(listener: () => void): () => void {
    this.wakeListeners.add(listener)
    return () => this.wakeListeners.delete(listener)
  }

  log(message: string): void {
    this.logs.push(message)
  }

  /** Fire every timer due within `ms`, in time order, advancing the clock. */
  advance(ms: number): void {
    const target = this.clock + ms
    for (;;) {
      const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      this.timers = this.timers.filter((t) => t.id !== due.id)
      this.clock = Math.max(this.clock, due.at + this.late)
      due.callback()
    }
    this.clock = Math.max(this.clock, target)
  }

  wake(): void {
    for (const listener of [...this.wakeListeners]) listener()
  }
}

/** Flush the canRetry promise chain's microtasks. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

interface FakeSocket {
  events: KeepaliveSocketEvents
  opened(): void
  receive(): void
  /** The transport closes the link (first close only). */
  close(reason: string): void
  /**
   * A SECOND close report for the same link (transport quirk). The loop
   * must ignore it instead of scheduling a parallel attempt.
   */
  duplicateClose(reason: string): void
  isClosed(): boolean
  closeReason: string | undefined
}

/** Harness wiring the loop to fake sockets + the fake environment. */
function makeHarness(overrides?: {
  canRetry?: () => Promise<boolean>
  silenceTimeoutMs?: number
  onConnected?: (connected: boolean) => void
}) {
  const env = new FakeEnvironment()
  const sockets: FakeSocket[] = []
  const canRetry = vi.fn(overrides?.canRetry ?? (async () => true))
  const handle = createSseKeepalive({
    environment: env,
    canRetry,
    ...(overrides?.onConnected ? { onConnected: overrides.onConnected } : {}),
    ...(overrides?.silenceTimeoutMs !== undefined
      ? { silenceTimeoutMs: overrides.silenceTimeoutMs }
      : {}),
    open: (events) => {
      let closeHandler: ((reason: string) => void) | undefined
      let closed = false
      const socket: FakeSocket = {
        events,
        closeReason: undefined,
        isClosed: () => closed,
        opened: () => {
          if (!closed) events.opened()
        },
        receive: () => {
          if (!closed) events.received()
        },
        close: (reason) => {
          if (closed) return
          closed = true
          socket.closeReason = reason
          events.closed(reason)
          closeHandler?.(reason)
        },
        duplicateClose: (reason) => {
          // Deliberately unguarded: exercises the loop's own stale-attempt
          // guard, not the transport's.
          closeHandler?.(reason)
        },
      }
      sockets.push(socket)
      return {
        onClose: (handler) => {
          closeHandler = handler
        },
        close: (reason) => socket.close(reason ?? "stopped"),
      }
    },
  })
  return { env, sockets, handle, canRetry }
}

describe("sse keepalive loop", () => {
  it("opens one connection immediately on start", () => {
    const { sockets } = makeHarness()
    expect(sockets).toHaveLength(1)
  })

  it("retries with 250ms doubling backoff capped at 5s", async () => {
    const { env, sockets } = makeHarness()
    // Consecutive short-lived failures → 250, 500, 1000, 2000, 4000, then capped.
    const expected = [250, 500, 1000, 2000, 4000, RETRY_MAX_MS, RETRY_MAX_MS]
    for (const delay of expected) {
      sockets.at(-1)!.close("transport error")
      await settle()
      const before = sockets.length
      env.advance(delay - 1)
      expect(sockets).toHaveLength(before) // backoff not elapsed yet
      env.advance(1)
      expect(sockets).toHaveLength(before + 1)
    }
  })

  it("resets the backoff after a connection that stayed open STABLE_MS", async () => {
    const { env, sockets } = makeHarness()
    // Two quick failures push the backoff to 1000ms...
    sockets[0].close("transport error")
    await settle()
    env.advance(RETRY_INITIAL_MS)
    sockets[1].close("transport error")
    await settle()
    env.advance(RETRY_INITIAL_MS * 2)
    expect(sockets).toHaveLength(3)
    // ...then a connection that lived >= STABLE_MS counts as working.
    sockets[2].opened()
    env.advance(STABLE_MS)
    sockets[2].close("server restart")
    await settle()
    env.advance(RETRY_INITIAL_MS - 1)
    expect(sockets).toHaveLength(3)
    env.advance(1)
    expect(sockets).toHaveLength(4) // backoff started over at 250ms
  })

  it("keeps backing off when a connection opens and dies at once", async () => {
    const { env, sockets } = makeHarness()
    sockets[0].opened()
    sockets[0].close("refused")
    await settle()
    env.advance(RETRY_INITIAL_MS)
    expect(sockets).toHaveLength(2)
    sockets[1].opened()
    sockets[1].close("refused")
    await settle()
    // No reset (lived < STABLE_MS): next delay is 500ms, not 250ms.
    env.advance(RETRY_INITIAL_MS)
    expect(sockets).toHaveLength(2)
    env.advance(RETRY_INITIAL_MS)
    expect(sockets).toHaveLength(3)
  })

  it("gives up on an attempt that never opens after CONNECT_TIMEOUT_MS", async () => {
    const { env, sockets } = makeHarness()
    env.advance(CONNECT_TIMEOUT_MS - 1)
    expect(sockets[0].isClosed()).toBe(false)
    env.advance(1)
    expect(sockets[0].isClosed()).toBe(true)
    expect(sockets[0].closeReason).toContain("not open after")
    await settle()
    env.advance(RETRY_INITIAL_MS)
    expect(sockets).toHaveLength(2)
  })

  it("retries immediately on wake instead of waiting out the backoff", async () => {
    const { env, sockets } = makeHarness()
    sockets[0].close("transport error")
    await settle()
    env.advance(1) // retry now pending at +250ms
    expect(sockets).toHaveLength(1)
    env.wake()
    expect(sockets).toHaveLength(2) // pending retry replaced by immediate connect
    // The cancelled timer does not double-connect later.
    env.advance(RETRY_MAX_MS * 2)
    expect(sockets).toHaveLength(2)
  })

  it("replaces an open socket silent longer than STALE_MS after a wake", async () => {
    const { env, sockets } = makeHarness()
    sockets[0].opened()
    sockets[0].receive()
    env.advance(30_000) // silence > STALE_MS while the page was away
    env.wake()
    // The stale check is scheduled with the 1s wake grace.
    env.advance(WAKE_GRACE_MS - 1)
    expect(sockets[0].isClosed()).toBe(false)
    env.advance(1)
    expect(sockets[0].isClosed()).toBe(true)
    expect(sockets[0].closeReason).toContain("no frame")
    await settle()
    env.advance(RETRY_INITIAL_MS) // lived >= STABLE_MS → reset backoff
    expect(sockets).toHaveLength(2)
  })

  it("keeps the socket when held frames arrive within the wake grace", async () => {
    const { env, sockets } = makeHarness()
    sockets[0].opened()
    sockets[0].receive()
    env.advance(30_000)
    env.wake()
    env.advance(WAKE_GRACE_MS - 500)
    sockets[0].receive() // the held frame finally arrives
    env.advance(500)
    expect(sockets[0].isClosed()).toBe(false)
    expect(sockets).toHaveLength(1)
  })

  it("replaces a socket silent beyond silenceTimeoutMs at any time", async () => {
    const { env, sockets } = makeHarness({ silenceTimeoutMs: STALE_MS })
    sockets[0].opened()
    // Watch scheduled at lastMessage + limit + 1.
    env.advance(STALE_MS)
    expect(sockets[0].isClosed()).toBe(false)
    env.advance(1)
    expect(sockets[0].isClosed()).toBe(true)
    await settle()
    env.advance(RETRY_INITIAL_MS)
    expect(sockets).toHaveLength(2)
  })

  it("reschedules the silence watch while frames keep arriving", async () => {
    const { env, sockets } = makeHarness({ silenceTimeoutMs: STALE_MS })
    sockets[0].opened()
    env.advance(20_000)
    sockets[0].receive()
    env.advance(20_000) // 20s after the frame — under the limit
    expect(sockets[0].isClosed()).toBe(false)
    env.advance(5_001) // 25.001s since the last frame
    expect(sockets[0].isClosed()).toBe(true)
  })

  it("gives held messages WAKE_GRACE_MS when the silence check fires late", async () => {
    const { env, sockets } = makeHarness({ silenceTimeoutMs: STALE_MS })
    sockets[0].opened()
    // Simulate a throttled page: the timer fires 2s after its scheduled time.
    env.late = 2_000
    env.advance(STALE_MS + 1)
    // now - scheduledAt > WAKE_GRACE_MS → the check waits one more second.
    expect(sockets[0].isClosed()).toBe(false)
    env.advance(WAKE_GRACE_MS - 1)
    expect(sockets[0].isClosed()).toBe(false)
    env.advance(1)
    expect(sockets[0].isClosed()).toBe(true)
  })

  it("stops reconnecting when canRetry returns false", async () => {
    const { env, sockets, canRetry } = makeHarness({ canRetry: async () => false })
    sockets[0].close("permanent 404")
    await settle()
    expect(canRetry).toHaveBeenCalled()
    env.advance(RETRY_MAX_MS * 4)
    expect(sockets).toHaveLength(1) // parked permanently
  })

  it("waits RETRY_MAX_MS while offline instead of the raw backoff", async () => {
    const { env, sockets } = makeHarness()
    env.setOnline(false)
    sockets[0].close("offline failure")
    await settle()
    env.advance(RETRY_MAX_MS - 1)
    expect(sockets).toHaveLength(1)
    env.advance(1)
    expect(sockets).toHaveLength(2)
  })

  it("stop() closes the live socket and prevents every further attempt", async () => {
    const { env, sockets, handle } = makeHarness()
    sockets[0].opened()
    handle.stop()
    expect(sockets[0].isClosed()).toBe(true)
    await settle()
    env.advance(RETRY_MAX_MS * 4)
    expect(sockets).toHaveLength(1)
    // A second stop is a no-op.
    expect(() => handle.stop()).not.toThrow()
  })

  it("ignores close reports from an attempt that is no longer current", async () => {
    const { env, sockets } = makeHarness()
    sockets[0].opened()
    sockets[0].receive()
    env.advance(30_000)
    env.wake() // stale check scheduled with the 1s grace
    env.advance(WAKE_GRACE_MS)
    expect(sockets[0].isClosed()).toBe(true) // replaced
    await settle()
    env.advance(RETRY_INITIAL_MS)
    expect(sockets).toHaveLength(2)
    sockets[1].opened()
    // A second close report from the replaced attempt must not schedule
    // anything extra (the loop's stale-attempt guard).
    sockets[0].duplicateClose("late report from the dead attempt")
    env.advance(RETRY_MAX_MS * 4)
    expect(sockets).toHaveLength(2)
  })

  it("schedules the retry immediately when a wake lands during the canRetry decision", async () => {
    let resolveCanRetry: (value: boolean) => void = () => {}
    const deferred = new Promise<boolean>((resolve) => {
      resolveCanRetry = resolve
    })
    const { env, sockets } = makeHarness({ canRetry: () => deferred })
    sockets[0].close("transport error")
    await settle()
    expect(sockets).toHaveLength(1) // still deciding
    env.wake() // wake while deciding
    resolveCanRetry(true)
    await settle()
    env.advance(0) // the immediate retry still goes through env.after(0, …)
    expect(sockets).toHaveLength(2) // connected without waiting the backoff
  })

  it("treats a throwing canRetry as retryable (pi parity)", async () => {
    const { env, sockets } = makeHarness({
      canRetry: async () => {
        throw new Error("gate failed")
      },
    })
    sockets[0].close("transport error")
    await settle()
    env.advance(RETRY_INITIAL_MS)
    expect(sockets).toHaveLength(2)
  })

  it("logs closes with before/after-opening context", async () => {
    const { env, sockets } = makeHarness()
    sockets[0].close("refused handshake")
    await settle()
    env.advance(RETRY_INITIAL_MS)
    sockets[1].opened()
    sockets[1].close("dropped")
    await settle()
    const joined = env.logs.join("\n")
    expect(joined).toContain("before opening")
    expect(joined).toContain("after opening")
  })

  it("notifies onConnected transitions", async () => {
    const onConnected = vi.fn()
    const { sockets, handle } = makeHarness({ onConnected, canRetry: async () => false })
    sockets[0].opened()
    sockets[0].close("dropped")
    await settle()
    expect(onConnected).toHaveBeenNthCalledWith(1, true)
    expect(onConnected).toHaveBeenNthCalledWith(2, false)
    handle.stop()
  })
})

describe("browserEnvironment", () => {
  it("wires after() to setTimeout and wake to visibility/online events", () => {
    vi.useFakeTimers()
    try {
      const env = browserEnvironment("test")
      let fired = false
      const cancel = env.after(20, () => {
        fired = true
      })
      vi.advanceTimersByTime(20)
      expect(fired).toBe(true)
      cancel()
      let woke = false
      const removeWake = env.onWake(() => {
        woke = true
      })
      document.dispatchEvent(new Event("visibilitychange"))
      window.dispatchEvent(new Event("online"))
      expect(woke).toBe(true)
      woke = false
      removeWake()
      document.dispatchEvent(new Event("visibilitychange"))
      expect(woke).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
