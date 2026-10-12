// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Event feed tests (opencode event-stream-architecture borrowing):
 *   - single encoding: one publish encodes the frame once and every
 *     matching connection receives the SAME immutable string reference.
 *   - per-connection filtering by event name and tenant.
 *   - bounded dropping queue: overflow kills exactly the lagging
 *     connection (structured SubscriberOverflowError); the publisher and
 *     healthy peers never block and keep receiving frames in order.
 *   - delivery drains FIFO through a backpressured transport and resumes
 *     when it recovers; heartbeats bypass the queue by construction at
 *     the route layer.
 *   - mini Hono flow: the SSE route shape from index.ts wired to the feed —
 *     frames arrive in wire order and the lagging client is disconnected
 *     when its lag budget is exceeded.
 */

import { describe, it, expect, vi } from "vitest"
import { Hono } from "hono"
import {
  EventFeed,
  SubscriberOverflowError,
  SUBSCRIBER_CAPACITY,
  encodeEventFrame,
} from "../src/lib/event-feed.js"
import { publishEvent, sseFeed } from "../src/routes/subscriptions.js"

/** Manual scheduler: tests decide when drains run. */
function makeManualScheduler() {
  const pending: Array<() => void> = []
  return {
    schedule: (fn: () => void) => {
      pending.push(fn)
    },
    flush: () => {
      const tasks = pending.splice(0, pending.length)
      for (const fn of tasks) fn()
    },
    get depth() {
      return pending.length
    },
  }
}

describe("encodeEventFrame", () => {
  it("keeps the SSE wire contract (event: + data: + blank line)", () => {
    expect(encodeEventFrame("task-update", { n: 1 })).toBe('event: task-update\ndata: {"n":1}\n\n')
  })

  it("rejects names that would break the frame", () => {
    expect(() => encodeEventFrame("bad\nname", {})).toThrow()
    expect(() => encodeEventFrame("", {})).toThrow()
  })
})

describe("EventFeed — single encoding", () => {
  it("offers the same immutable frame string to every matching connection", () => {
    const scheduler = makeManualScheduler()
    const feed = new EventFeed({ schedule: scheduler.schedule })
    const receivedA: string[] = []
    const receivedB: string[] = []
    feed.subscribe({ id: "a", write: (f) => (receivedA.push(f), true) })
    feed.subscribe({ id: "b", write: (f) => (receivedB.push(f), true) })

    feed.publish("evt", { n: 1 })
    scheduler.flush()
    expect(receivedA).toHaveLength(1)
    expect(receivedA[0]).toBe(receivedB[0]) // same reference, encoded once
  })

  it("encodes at most once per publish regardless of subscriber count", () => {
    const feed = new EventFeed()
    for (const id of ["a", "b", "c"]) {
      feed.subscribe({ id, write: () => true })
    }
    const stringify = vi.spyOn(JSON, "stringify")
    feed.publish("evt", { n: 1 })
    expect(stringify).toHaveBeenCalledTimes(1) // not once per connection
    stringify.mockRestore()
  })

  it("skips encoding entirely when nobody is listening", () => {
    const feed = new EventFeed()
    const stringify = vi.spyOn(JSON, "stringify")
    feed.publish("evt", { n: 1 })
    expect(stringify).not.toHaveBeenCalled()
    stringify.mockRestore()
  })
})

describe("EventFeed — per-connection filtering", () => {
  it("filters by event name", () => {
    const scheduler = makeManualScheduler()
    const feed = new EventFeed({ schedule: scheduler.schedule })
    const received: string[] = []
    feed.subscribe({ id: "filtered", events: ["wanted"], write: (f) => (received.push(f), true) })

    feed.publish("ignored", {})
    feed.publish("wanted", { n: 1 })
    scheduler.flush()
    expect(received).toEqual(['event: wanted\ndata: {"n":1}\n\n'])
  })

  it("isolates tenants: a tenant connection never sees other tenants' events", () => {
    const scheduler = makeManualScheduler()
    const feed = new EventFeed({ schedule: scheduler.schedule })
    const tenantA: string[] = []
    const globalFeed: string[] = []
    feed.subscribe({ id: "a", tenantId: "t-a", write: (f) => (tenantA.push(f), true) })
    feed.subscribe({ id: "g", write: (f) => (globalFeed.push(f), true) })

    feed.publish("evt", { n: 1 }, "t-b")
    expect(tenantA).toEqual([])

    feed.publish("evt", { n: 2 }, "t-a")
    scheduler.flush()
    expect(tenantA).toHaveLength(1)
    expect(globalFeed).toHaveLength(2)
  })
})

describe("EventFeed — bounded queue and overflow", () => {
  it("drops a lagging connection at capacity with a structured error, peers unaffected", () => {
    const scheduler = makeManualScheduler()
    const feed = new EventFeed({ capacity: 3, schedule: scheduler.schedule })
    const healthy: string[] = []
    feed.subscribe({ id: "healthy", write: (f) => (healthy.push(f), true) })
    const onOverflow = vi.fn()
    feed.subscribe({
      id: "lagging",
      capacity: 3,
      write: () => false, // transport saturated from the start
      onOverflow,
    })

    // Frames 1-3 fill the lagging connection's budget.
    feed.publish("evt", { n: 1 })
    feed.publish("evt", { n: 2 })
    feed.publish("evt", { n: 3 })
    scheduler.flush() // drains fail: transport stays saturated
    expect(onOverflow).not.toHaveBeenCalled()
    expect(feed.size).toBe(2)

    // Frame 4 exceeds the budget: only this connection dies, and the
    // publisher does not throw.
    expect(() => feed.publish("evt", { n: 4 })).not.toThrow()
    expect(onOverflow).toHaveBeenCalledTimes(1)
    const err = onOverflow.mock.calls[0][0] as SubscriberOverflowError
    expect(err).toBeInstanceOf(SubscriberOverflowError)
    expect(err.name).toBe("SubscriberOverflowError")
    expect(err.connectionId).toBe("lagging")
    expect(err.capacity).toBe(3)
    expect(feed.size).toBe(1) // killed connection removed

    // The healthy connection received every frame, in order, unblocked.
    feed.publish("evt", { n: 5 })
    scheduler.flush()
    expect(healthy).toEqual([
      'event: evt\ndata: {"n":1}\n\n',
      'event: evt\ndata: {"n":2}\n\n',
      'event: evt\ndata: {"n":3}\n\n',
      'event: evt\ndata: {"n":4}\n\n',
      'event: evt\ndata: {"n":5}\n\n',
    ])
  })

  it("counts lag, drains FIFO, and resumes after transport saturation", async () => {
    const scheduler = makeManualScheduler()
    const feed = new EventFeed({ schedule: scheduler.schedule, saturatedRetryMs: 5 })
    const received: string[] = []
    let accept = true
    const connection = feed.subscribe({
      id: "c",
      write: (f) => {
        if (!accept) return false
        received.push(f)
        return true
      },
    })

    feed.publish("evt", { n: 1 })
    feed.publish("evt", { n: 2 })
    expect(connection.lag()).toBe(2) // accepted, drain pending

    scheduler.flush()
    expect(received).toEqual(['event: evt\ndata: {"n":1}\n\n', 'event: evt\ndata: {"n":2}\n\n'])
    expect(connection.lag()).toBe(0)

    // Transport saturates: frames wait in the bounded queue.
    accept = false
    feed.publish("evt", { n: 3 })
    scheduler.flush()
    expect(received).toHaveLength(2)
    expect(connection.lag()).toBe(1)

    // Recovery: the macrotask retry drain flushes without a new publish.
    accept = true
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(received).toHaveLength(3)
    expect(connection.lag()).toBe(0)
  })

  it("uses the shared default capacity", () => {
    expect(SUBSCRIBER_CAPACITY).toBe(4_096)
    const feed = new EventFeed()
    const onOverflow = vi.fn()
    feed.subscribe({ id: "c", write: () => false, onOverflow })
    for (let i = 0; i < SUBSCRIBER_CAPACITY; i++) feed.publish("evt", { i })
    expect(onOverflow).not.toHaveBeenCalled()
    feed.publish("evt", { i: SUBSCRIBER_CAPACITY })
    expect(onOverflow).toHaveBeenCalledTimes(1)
    expect((onOverflow.mock.calls[0][0] as SubscriberOverflowError).capacity).toBe(4_096)
  })

  it("unsubscribe removes the connection and orphans pending drains", () => {
    const scheduler = makeManualScheduler()
    const feed = new EventFeed({ schedule: scheduler.schedule })
    const received: string[] = []
    const connection = feed.subscribe({ id: "c", write: (f) => (received.push(f), true) })

    feed.publish("evt", { n: 1 })
    connection.close()
    expect(feed.size).toBe(0)
    // A drain scheduled before close must not resurrect anything.
    scheduler.flush()
    expect(received).toEqual([])

    feed.publish("evt", { n: 2 })
    scheduler.flush()
    expect(received).toEqual([])
  })
})

describe("SSE route flow (mini Hono, feed-wired)", () => {
  /**
   * Mirrors the /events/stream handler shape in index.ts: feed connection
   * with a backpressure-aware write, direct (unbudgeted) ready frame and
   * heartbeats, abort-driven cleanup.
   */
  function makeApp(opts?: { capacity: number }) {
    const feed = new EventFeed({ capacity: opts?.capacity })
    const app = new Hono()
    app.get("/stream", (c) => {
      const encoder = new TextEncoder()
      const id = "sse_test"
      let closed = false
      let cleanup = () => {}
      const stream = new ReadableStream({
        start(controller) {
          cleanup = () => {
            if (closed) return
            closed = true
            feed.unsubscribe(id)
            try {
              controller.close()
            } catch {}
          }
          const writeDirect = (data: string): boolean => {
            if (closed) return false
            try {
              controller.enqueue(encoder.encode(data))
              return true
            } catch {
              return false
            }
          }
          const writeWhenReadable = (frame: string): boolean => {
            const desired = controller.desiredSize
            if (desired !== null && desired <= 0) return false
            return writeDirect(frame)
          }
          feed.subscribe({
            id,
            write: writeWhenReadable,
            onOverflow: cleanup,
          })
          writeDirect(encodeEventFrame("ready", { id }))
        },
        cancel() {
          cleanup()
        },
      })
      return new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      })
    })
    return { app, feed }
  }

  async function readFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
    const { value, done } = await reader.read()
    expect(done).toBe(false)
    return new TextDecoder().decode(value)
  }

  it("delivers the connect notice and published frames in wire order", async () => {
    const { app, feed } = makeApp()
    const res = await app.request("/stream")
    expect(res.headers.get("content-type")).toBe("text/event-stream")
    const reader = res.body!.getReader()

    const ready = await readFrame(reader)
    expect(ready.startsWith("event: ready\ndata: ")).toBe(true)

    // Publish through the feed (same path publishEvent uses), then let the
    // microtask drains run.
    feed.publish("task-update", { n: 1 })
    feed.publish("task-update", { n: 2 })
    await new Promise((resolve) => setImmediate(resolve))

    const first = await readFrame(reader)
    const second = await readFrame(reader)
    expect(first).toBe('event: task-update\ndata: {"n":1}\n\n')
    expect(second).toBe('event: task-update\ndata: {"n":2}\n\n')
    reader.cancel()
  })

  it("the module-level feed singleton backs publishEvent (subscription path)", async () => {
    const feed = sseFeed
    const received: string[] = []
    const connection = feed.subscribe({ id: "it-client", write: (f) => (received.push(f), true) })
    try {
      await publishEvent("runtime-event", { workspaceId: "w1" }, "tenant-1")
      // publishEvent → feed: encoded once, offered synchronously; drains
      // happen on the next microtask.
      await new Promise((resolve) => setImmediate(resolve))
      expect(received).toEqual(['event: runtime-event\ndata: {"workspaceId":"w1"}\n\n'])

      // Tenant scoping through the same publish path.
      const scoped: string[] = []
      const tenantConn = feed.subscribe({
        id: "it-client-tenant",
        tenantId: "tenant-9",
        write: (f) => (scoped.push(f), true),
      })
      await publishEvent("runtime-event", { n: 2 }, "tenant-1")
      await new Promise((resolve) => setImmediate(resolve))
      expect(scoped).toEqual([])
      expect(received).toHaveLength(2)
      tenantConn.close()
    } finally {
      connection.close()
    }
  })

  it("a client that stops reading accumulates lag; reading again drains it", async () => {
    const { app, feed } = makeApp()
    const res = await app.request("/stream")
    const reader = res.body!.getReader()
    await readFrame(reader) // ready

    // Publish 50 frames without reading: the stream absorbs up to its HWM,
    // the rest sit in this connection's queue.
    for (let i = 0; i < 50; i++) feed.publish("evt", { i })
    await new Promise((resolve) => setImmediate(resolve))
    expect(feed.size).toBe(1) // connection alive — far below any budget

    // Reading catches up: every frame arrives exactly once, in order.
    const frames: string[] = []
    for (let i = 0; i < 50; i++) {
      frames.push(await readFrame(reader))
    }
    frames.forEach((frame, i) => {
      expect(frame).toBe(`event: evt\ndata: {"i":${i}}\n\n`)
    })
    reader.cancel()
  })

  it("overflow disconnects only the lagging reader (capacity 8)", async () => {
    const { app, feed } = makeApp({ capacity: 8 })
    const lagging = await app.request("/stream")
    const laggingReader = lagging.body!.getReader()
    await readFrame(laggingReader) // ready

    // Publish past the lag budget without ever reading.
    for (let i = 0; i < 20; i++) {
      feed.publish("evt", { i })
      await new Promise((resolve) => setImmediate(resolve))
    }
    expect(feed.size).toBe(0) // connection killed by its overflow
    // The stream is closed for exactly that client: after the already
    // buffered chunks drain, the reader sees done.
    for (let i = 0; i < 64; i++) {
      const tail = await laggingReader.read()
      if (tail.done) return
    }
    throw new Error("lagging stream was never closed")
  })
})
