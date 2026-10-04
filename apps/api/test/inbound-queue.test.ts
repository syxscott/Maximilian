// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Three-tier inbound admission queue tests (openclaw ingress borrowing):
 *   - model: immediate slots fill first, then the bounded queue, then
 *     dead-letter with a structured overflow error and counters.
 *   - release promotes queued requests FIFO.
 *   - middleware: overflow answers 503 { error: "inbound_overflow" }, probe
 *     endpoints are exempt even at full load, and slots are released after
 *     the handler finishes (including error responses).
 */

import { describe, it, expect } from "vitest"
import { Hono } from "hono"
import { InboundGate, InboundOverflowError } from "../src/lib/inbound-queue.js"
import { inboundAdmission } from "../src/middleware/inbound-queue.js"
import { inboundRoutes } from "../src/routes/inbound.js"

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("condition not met within timeout")
}

describe("InboundGate (pure model)", () => {
  it("fills immediate slots, then queues, then dead-letters", () => {
    const gate = new InboundGate({ maxInFlight: 2, maxQueued: 1 })
    expect(gate.admit()).toEqual({ tier: "immediate" })
    expect(gate.admit()).toEqual({ tier: "immediate" })

    const queued = gate.admit()
    expect(queued.tier).toBe("queued")
    if (queued.tier === "queued") {
      // Waiting must not block the caller synchronously — it resolves on promotion.
      let promoted = false
      void queued.wait.then(() => {
        promoted = true
      })
      expect(promoted).toBe(false)
    }

    expect(gate.admit()).toEqual({ tier: "dead-letter" })
    expect(gate.snapshot()).toMatchObject({
      inFlight: 2,
      queuedDepth: 1,
      immediate: 2,
      queued: 1,
      deadLetter: 1,
    })
  })

  it("promotes queued requests FIFO on release", async () => {
    const gate = new InboundGate({ maxInFlight: 1, maxQueued: 3 })
    gate.admit() // occupies the only slot

    const first = gate.admit()
    const second = gate.admit()
    if (first.tier !== "queued" || second.tier !== "queued") throw new Error("expected queued")

    let promotedFirst = false
    let promotedSecond = false
    void first.wait.then(() => {
      promotedFirst = true
    })
    void second.wait.then(() => {
      promotedSecond = true
    })

    gate.release()
    await until(() => promotedFirst)
    expect(promotedSecond).toBe(false)
    expect(gate.snapshot().inFlight).toBe(1)

    gate.release()
    await until(() => promotedSecond)
    gate.release()
    expect(gate.snapshot()).toMatchObject({ inFlight: 0, queuedDepth: 0 })
  })

  it("acquire rejects with a structured overflow error", async () => {
    const gate = new InboundGate({ maxInFlight: 1, maxQueued: 1 })
    gate.admit()
    gate.admit()
    await expect(gate.acquire()).rejects.toBeInstanceOf(InboundOverflowError)
    try {
      await gate.acquire()
    } catch (err) {
      expect(err instanceof InboundOverflowError && err.snapshot.deadLetter).toBe(2)
    }
  })

  it("rejects non-positive bounds", () => {
    expect(() => new InboundGate({ maxInFlight: 0, maxQueued: 1 })).toThrow()
    expect(() => new InboundGate({ maxInFlight: 1, maxQueued: 0 })).toThrow()
  })
})

describe("inboundAdmission middleware", () => {
  function buildApp(gate: InboundGate) {
    const app = new Hono()
    app.use("/api/*", inboundAdmission({ gate }))
    const inbound = inboundRoutes({ gate })
    app.get("/api/inbound/stats", inbound.stats)
    app.get("/api/health", (c) => c.json({ ok: true }))
    let unblock: (() => void) | null = null
    app.post("/api/work", (c) => {
      if (c.req.header("x-block") === "1") {
        return new Promise<void>((resolve) => {
          unblock = resolve
        }).then(() => c.json({ ok: true }))
      }
      return c.json({ ok: true })
    })
    return { app, unblock: () => unblock?.() }
  }

  it("answers overflow with a structured 503 and keeps serving probes", async () => {
    const gate = new InboundGate({ maxInFlight: 1, maxQueued: 1 })
    const { app, unblock } = buildApp(gate)

    const blocked = app.request("/api/work", {
      method: "POST",
      headers: { "x-block": "1" },
    })
    await until(() => gate.snapshot().inFlight === 1)

    const queuedReq = app.request("/api/work", { method: "POST" })
    await until(() => gate.snapshot().queuedDepth === 1)

    const overflow = await app.request("/api/work", { method: "POST" })
    expect(overflow.status).toBe(503)
    expect(await overflow.json()).toMatchObject({
      error: "inbound_overflow",
      snapshot: { inFlight: 1, queuedDepth: 1, deadLetter: 1 },
    })

    // Probes bypass admission even at full load.
    const probe = await app.request("/api/health")
    expect(probe.status).toBe(200)

    unblock()
    const [firstRes, secondRes] = await Promise.all([blocked, queuedReq])
    expect(firstRes.status).toBe(200)
    expect(secondRes.status).toBe(200)
    expect(gate.snapshot()).toMatchObject({ inFlight: 0, queuedDepth: 0, deadLetter: 1 })
  })

  it("releases the slot when the handler errors (Hono 500 path)", async () => {
    const gate = new InboundGate({ maxInFlight: 1, maxQueued: 1 })
    const app = new Hono()
    app.use("/api/*", inboundAdmission({ gate }))
    app.get("/api/boom", () => {
      throw new Error("boom")
    })
    // Hono's default onError turns the throw into a 500 — the point is the
    // finally-release: the slot must be free again afterwards.
    const res = await app.request("/api/boom")
    expect(res.status).toBe(500)
    expect(gate.snapshot().inFlight).toBe(0)
  })

  it("exposes live counters on the stats route", async () => {
    const gate = new InboundGate({ maxInFlight: 4, maxQueued: 4 })
    const { app } = buildApp(gate)
    await app.request("/api/work", { method: "POST" })
    const res = await app.request("/api/inbound/stats")
    expect(res.status).toBe(200)
    // inFlight is 1 because the stats request itself occupies the slot
    // while its handler reads the snapshot — proving the earlier work
    // request released its slot.
    expect(await res.json()).toMatchObject({
      stats: { counters: { immediate: 2 }, inFlight: 1, maxInFlight: 4 },
    })
  })
})
