// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// (OpenAgentCore sessions-events.md borrowing) SSE delivery-law tests for
// the two mechanisms the feed was missing:
//
//   Key recheck — an open stream rechecks its ORIGINAL authorization at
//   most once per second while idle and before sending output; a revoked
//   token (or a failed recheck) closes exactly that stream, and no frame
//   written after the revocation is read by the client.
//
//   Blocked reader — "Execution never waits for a reader": a transport
//   that stays blocked past the write timeout is disconnected while the
//   publisher and healthy peers continue unaffected. A slow consumer
//   never blocks publish.

import { describe, it, expect, afterEach, vi } from "vitest"
import {
  AUTH_RECHECK_INTERVAL_MS,
  EventFeed,
  WRITE_BLOCK_TIMEOUT_MS,
} from "../src/lib/event-feed.js"
import { sseAuthRecheck } from "../src/lib/sse-auth-recheck.js"
import { signAccessToken } from "../src/auth/jwt.js"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Advanceable wall clock for cadence-gated logic. */
function makeClock() {
  let t = 1_000_000
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("feed key recheck — idle cadence", () => {
  it("closes the stream within one recheck interval when the token is revoked", async () => {
    let authorized = true
    const feed = new EventFeed({ authRecheckIntervalMs: 15 })
    const onAuthRevoked = vi.fn()
    const received: string[] = []
    feed.subscribe({
      id: "c",
      write: (f) => (received.push(f), true),
      recheckAuth: async () => authorized,
      onAuthRevoked,
    })

    feed.publish("evt", { n: 1 })
    await sleep(50)
    expect(onAuthRevoked).not.toHaveBeenCalled()
    expect(feed.size).toBe(1)

    // Revocation: the next idle recheck closes exactly this stream.
    authorized = false
    await sleep(80)
    expect(onAuthRevoked).toHaveBeenCalledTimes(1)
    expect(feed.size).toBe(0)

    // Nothing flows to a dead connection afterwards.
    feed.publish("evt", { n: 2 })
    await sleep(30)
    expect(received).toHaveLength(1)
  })

  it("rechecks at most once per interval while idle (cadence, not a spin)", async () => {
    const recheck = vi.fn(async () => true)
    const feed = new EventFeed({ authRecheckIntervalMs: 20 })
    feed.subscribe({ id: "c", write: () => true, recheckAuth: recheck })

    await sleep(70)
    const firstWindowCalls = recheck.mock.calls.length
    // A real 1s cadence would be several calls in 70ms at 20ms cadence;
    // the property under test is that calls are bounded by the window,
    // never a tight loop.
    expect(firstWindowCalls).toBeGreaterThanOrEqual(1)
    expect(firstWindowCalls).toBeLessThanOrEqual(5)
    expect(feed.size).toBe(1)
  })

  it("keeps the production cadence at the spec bound (<= 1s) and the block timeout at 5s", () => {
    expect(AUTH_RECHECK_INTERVAL_MS).toBe(1_000)
    expect(WRITE_BLOCK_TIMEOUT_MS).toBe(5_000)
  })
})

describe("feed key recheck — before sending output", () => {
  it("rechecks BEFORE the first frame when the last check is stale; revoked closes with zero delivery", async () => {
    const clock = makeClock()
    let authorized = true
    const received: string[] = []
    // Snapshot the delivery state AT recheck time: the frame published
    // after the staleness deadline must still be queued when the recheck
    // runs — output waits for the verdict.
    let framesAtRecheck = -1
    const recheck = vi.fn(async () => {
      framesAtRecheck = received.length
      return authorized
    })
    const feed = new EventFeed({
      schedule: (fn) => queueMicrotask(fn),
      authRecheckIntervalMs: 1_000,
      now: clock.now,
    })
    const onAuthRevoked = vi.fn()
    feed.subscribe({
      id: "c",
      write: (f) => (received.push(f), true),
      recheckAuth: recheck,
      onAuthRevoked,
    })

    // Fresh connection (lastAuthCheckAt = subscribe time): output flows
    // without a recheck — the connect-time check already covers it.
    feed.publish("evt", { n: 1 })
    await sleep(5)
    expect(received).toHaveLength(1)
    expect(recheck).not.toHaveBeenCalled()

    // Time passes (>1s): the next output rechecks BEFORE delivering.
    clock.advance(1_100)
    feed.publish("evt", { n: 2 })
    await sleep(5)
    expect(received).toHaveLength(2) // frame 2 delivered after the verdict
    expect(framesAtRecheck).toBe(1) // it was still queued when recheck ran
    expect(received[1]).toBe('event: evt\ndata: {"n":2}\n\n')
    expect(recheck).toHaveBeenCalledTimes(1)

    // Revoked before the next output: the stream closes, nothing is sent.
    clock.advance(1_100)
    authorized = false
    feed.publish("evt", { n: 3 })
    await sleep(5)
    expect(received).toHaveLength(2) // frame 3 never reached the transport
    expect(onAuthRevoked).toHaveBeenCalledTimes(1)
    expect(feed.size).toBe(0)
  })

  it("treats a failing recheck (auth error) as a revoked stream", async () => {
    const clock = makeClock()
    const feed = new EventFeed({
      schedule: (fn) => queueMicrotask(fn),
      authRecheckIntervalMs: 1_000,
      now: clock.now,
    })
    const onAuthRevoked = vi.fn()
    feed.subscribe({
      id: "c",
      write: () => true,
      recheckAuth: async () => {
        throw new Error("auth service unavailable")
      },
      onAuthRevoked,
    })

    clock.advance(1_100)
    feed.publish("evt", { n: 1 })
    await sleep(5)

    expect(onAuthRevoked).toHaveBeenCalledTimes(1)
    expect(feed.size).toBe(0)
  })

  it("a revoked key closes only its own connection (peers unaffected)", async () => {
    const clock = makeClock()
    const feed = new EventFeed({
      schedule: (fn) => queueMicrotask(fn),
      authRecheckIntervalMs: 1_000,
      now: clock.now,
    })
    const peerReceived: string[] = []
    feed.subscribe({ id: "peer", write: (f) => (peerReceived.push(f), true) })
    const revoked = vi.fn()
    feed.subscribe({
      id: "doomed",
      write: () => true,
      recheckAuth: async () => false,
      onAuthRevoked: revoked,
    })

    clock.advance(1_100)
    feed.publish("evt", { n: 1 })
    await sleep(5)

    expect(revoked).toHaveBeenCalledTimes(1)
    expect(feed.size).toBe(1) // only the peer remains
    feed.publish("evt", { n: 2 })
    await sleep(5)
    expect(peerReceived).toHaveLength(2)
  })
})

describe("blocked reader timeout", () => {
  it("kills a connection whose transport stays blocked past the timeout", async () => {
    const onWriteBlock = vi.fn()
    const feed = new EventFeed({
      schedule: (fn) => queueMicrotask(fn),
      writeBlockTimeoutMs: 40,
      saturatedRetryMs: 10,
    })
    const healthy: string[] = []
    feed.subscribe({ id: "healthy", write: (f) => (healthy.push(f), true) })
    feed.subscribe({
      id: "stuck",
      write: () => false, // reader walked away
      onWriteBlock,
    })

    feed.publish("evt", { n: 1 })
    await sleep(5)
    expect(feed.size).toBe(2) // blocked but within budget

    await sleep(90)
    expect(onWriteBlock).toHaveBeenCalledTimes(1)
    expect(onWriteBlock.mock.calls[0][0]).toBe(40)
    expect(feed.size).toBe(1)

    // The publisher and the healthy peer continue unaffected.
    feed.publish("evt", { n: 2 })
    await sleep(5)
    expect(healthy).toHaveLength(2)
  })

  it("does not kill a blocked transport that recovers within the timeout", async () => {
    const onWriteBlock = vi.fn()
    const feed = new EventFeed({
      schedule: (fn) => queueMicrotask(fn),
      writeBlockTimeoutMs: 60,
      saturatedRetryMs: 10,
    })
    const received: string[] = []
    let accept = false
    feed.subscribe({
      id: "c",
      write: (f) => {
        if (!accept) return false
        received.push(f)
        return true
      },
      onWriteBlock,
    })

    feed.publish("evt", { n: 1 })
    await sleep(5)
    expect(feed.size).toBe(1)

    // The reader comes back before the budget expires.
    await sleep(25)
    accept = true
    await sleep(30) // drain retry fires; write succeeds → streak cleared
    expect(received).toHaveLength(1)
    expect(onWriteBlock).not.toHaveBeenCalled()
    expect(feed.size).toBe(1)

    await sleep(60) // well past the original budget — no late kill
    expect(onWriteBlock).not.toHaveBeenCalled()
    expect(feed.size).toBe(1)
  })

  it("a slow consumer never blocks publish (publisher returns synchronously)", async () => {
    const feed = new EventFeed({
      schedule: (fn) => queueMicrotask(fn),
      writeBlockTimeoutMs: 5_000,
      saturatedRetryMs: 10,
    })
    feed.subscribe({ id: "stuck", write: () => false })

    const start = performance.now()
    for (let i = 0; i < 100; i++) feed.publish("evt", { i })
    const elapsed = performance.now() - start

    // 100 offers into a saturated connection are array pushes, not writes.
    expect(elapsed).toBeLessThan(50)
    expect(feed.size).toBe(1)
  })
})

describe("sseAuthRecheck — mirrors the auth ladder", () => {
  it("re-verifies the original JWT (valid passes, revoked/expired fails)", async () => {
    const secret = "test-secret-for-sse-recheck"
    const token = await signAccessToken("user-1", "admin", secret)
    const recheck = sseAuthRecheck({ jwtSecret: secret, token })
    await expect(recheck()).resolves.toBe(true)

    // Same token against a rotated secret → revoked.
    const afterRotation = sseAuthRecheck({ jwtSecret: "rotated-secret", token })
    await expect(afterRotation()).resolves.toBe(false)
  })

  it("checks admin-token equality when JWT auth is off", async () => {
    const match = sseAuthRecheck({ adminToken: "admin-token-1", token: "admin-token-1" })
    await expect(match()).resolves.toBe(true)
    const mismatch = sseAuthRecheck({ adminToken: "admin-token-1", token: "other" })
    await expect(mismatch()).resolves.toBe(false)
  })

  it("passes unconditionally when auth is disabled (dev mode)", async () => {
    const recheck = sseAuthRecheck({ token: "" })
    await expect(recheck()).resolves.toBe(true)
  })
})
