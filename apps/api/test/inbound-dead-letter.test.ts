// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Inbound dead-letter layer tests (openclaw ingress borrowing):
 *   - policy: dead-letter requires BOTH the attempt floor and the minimum
 *     age (a fresh event is never judged dead on arrival).
 *   - classifier: structurally invalid requests and auth failures are
 *     non-retryable; overload/transient failures retry.
 *   - registry: bounded retention (evict oldest, counted), periodic prune
 *     (not per-record), counters.
 *   - driver: non-retryable fails fast without consuming retries;
 *     retryable retries until the floors meet, then dead-letters; the
 *     triggering error always propagates.
 *   - route flow through a mini Hono app: an invalid-request failure is
 *     dead-lettered and visible via /inbound/stats and
 *     /inbound/dead-letter.
 */

import { describe, it, expect, vi } from "vitest"
import { Hono } from "hono"
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_DEAD_LETTER_MIN_AGE_MS,
  shouldDeadLetter,
  classifyInboundFailure,
  DeadLetterRegistry,
  runInboundWithDeadLetter,
  resolveDeadLetterPolicy,
} from "../src/lib/inbound-dead-letter.js"
import { inboundAdmission } from "../src/middleware/inbound-queue.js"
import { inboundRoutes } from "../src/routes/inbound.js"
import { InboundGate } from "../src/lib/inbound-queue.js"

const POLICY = resolveDeadLetterPolicy({ maxAttempts: 3, deadLetterMinAgeMs: 10_000 })

describe("shouldDeadLetter (both floors)", () => {
  it("never judges a fresh event dead, even past the attempt floor", () => {
    // Received just now, retries already exhausted: NOT dead yet.
    expect(shouldDeadLetter({ attempts: 3, receivedAt: 0 }, POLICY, 5_000)).toBe(false)
  })

  it("never judges an old event with attempts left dead", () => {
    expect(shouldDeadLetter({ attempts: 2, receivedAt: 0 }, POLICY, 60_000)).toBe(false)
  })

  it("dead-letters only when both floors are met", () => {
    expect(shouldDeadLetter({ attempts: 3, receivedAt: 0 }, POLICY, 10_000)).toBe(true)
    expect(shouldDeadLetter({ attempts: 5, receivedAt: 0 }, POLICY, 60_000)).toBe(true)
  })

  it("defaults match the openclaw constants", () => {
    const policy = resolveDeadLetterPolicy()
    expect(policy.maxAttempts).toBe(DEFAULT_MAX_ATTEMPTS)
    expect(policy.deadLetterMinAgeMs).toBe(DEFAULT_DEAD_LETTER_MIN_AGE_MS)
    expect(policy.retentionCap).toBe(5_000)
  })
})

describe("classifyInboundFailure (non-retryable classifier)", () => {
  it("treats structured invalid requests as terminal", () => {
    for (const status of [400, 404, 405, 409, 413, 415, 422]) {
      const cls = classifyInboundFailure({ status })
      expect(cls.retryable, `status ${status}`).toBe(false)
      expect(cls.kind).toBe("invalid-request")
    }
  })

  it("treats authentication failures as terminal", () => {
    for (const err of [{ status: 401 }, { statusCode: 403 }]) {
      const cls = classifyInboundFailure(err)
      expect(cls.retryable).toBe(false)
      expect(cls.kind).toBe("auth-failed")
    }
  })

  it("treats unparseable payloads as structural, not transient", () => {
    const cls = classifyInboundFailure(new SyntaxError("Unexpected token in JSON"))
    expect(cls.retryable).toBe(false)
    expect(cls.kind).toBe("invalid-request")
  })

  it("keeps overload and unknown failures retryable", () => {
    expect(classifyInboundFailure({ status: 429 })).toMatchObject({
      retryable: true,
      kind: "overload",
    })
    expect(classifyInboundFailure({ status: 503 })).toMatchObject({
      retryable: true,
      kind: "overload",
    })
    expect(classifyInboundFailure(new Error("socket hang up"))).toMatchObject({
      retryable: true,
      kind: "transient",
    })
  })
})

describe("DeadLetterRegistry", () => {
  it("records entries with cause and counters", () => {
    const registry = new DeadLetterRegistry(POLICY, { now: () => 1_000 })
    registry.record({
      cause: "non-retryable",
      classification: classifyInboundFailure({ status: 401 }),
      attempts: 1,
      receivedAt: 900,
    })
    registry.record({ cause: "retry-limit-exceeded", attempts: 3, receivedAt: 0 })

    expect(registry.snapshot()).toMatchObject({ deadLettered: 2, nonRetryable: 1, size: 2 })
    const items = registry.list()
    expect(items[0]).toMatchObject({ cause: "non-retryable", reason: "auth-failed" })
    expect(items[1]).toMatchObject({ cause: "retry-limit-exceeded", attempts: 3 })
  })

  it("evicts the oldest entry beyond the retention cap (counted, not lost)", () => {
    const registry = new DeadLetterRegistry({ maxAttempts: 3, retentionCap: 2 }, { now: () => 0 })
    registry.record({ cause: "retry-limit-exceeded", attempts: 3, receivedAt: 0 })
    registry.record({ cause: "retry-limit-exceeded", attempts: 3, receivedAt: 0 })
    registry.record({ cause: "non-retryable", attempts: 1, receivedAt: 0 })

    expect(registry.list().map((e) => e.cause)).toEqual(["retry-limit-exceeded", "non-retryable"])
    expect(registry.snapshot()).toMatchObject({ size: 2, evicted: 1, deadLettered: 3 })
  })

  it("prunes periodically by retention age, not on every record", () => {
    let now = 0
    const registry = new DeadLetterRegistry(
      { maxAttempts: 3, retentionAgeMs: 1_000 },
      { now: () => now },
    )
    registry.record({ cause: "non-retryable", attempts: 1, receivedAt: 0 })
    now = 1_500
    // Recording must NOT prune.
    registry.record({ cause: "non-retryable", attempts: 1, receivedAt: 0 })
    expect(registry.snapshot()).toMatchObject({ size: 2, pruned: 0 })

    // The periodic prune drops entries dead-lettered longer ago than the
    // retention age: the first (deadLetteredAt 0 < cutoff 500) goes, the
    // second (deadLetteredAt 1500) is young and stays.
    const removed = registry.pruneOlderThan()
    expect(removed).toBe(1)
    expect(registry.snapshot()).toMatchObject({ size: 1, pruned: 1 })
  })

  it("keeps entries younger than the retention age", () => {
    let now = 0
    const registry = new DeadLetterRegistry(
      { maxAttempts: 3, retentionAgeMs: 10_000 },
      { now: () => now },
    )
    registry.record({ cause: "non-retryable", attempts: 1, receivedAt: 0 })
    now = 5_000
    expect(registry.pruneOlderThan()).toBe(0)
    expect(registry.snapshot().size).toBe(1)
  })
})

describe("runInboundWithDeadLetter (retry-exhaustion driver)", () => {
  function makeRegistry() {
    return new DeadLetterRegistry(
      { maxAttempts: 3, deadLetterMinAgeMs: 10_000 },
      { now: () => 60_000 },
    )
  }

  it("dead-letters non-retryable failures on the first attempt without retries", async () => {
    const registry = makeRegistry()
    let attempts = 0
    await expect(
      runInboundWithDeadLetter(
        registry,
        59_900,
        {
          work: async () => {
            attempts += 1
            throw Object.assign(new Error("bad body"), { status: 422 })
          },
          sleep: async () => {
            throw new Error("must not sleep for non-retryable failures")
          },
        },
        () => 60_000,
      ),
    ).rejects.toThrow("bad body")
    expect(attempts).toBe(1)
    expect(registry.snapshot()).toMatchObject({ deadLettered: 1, nonRetryable: 1 })
  })

  it("retries retryable failures and dead-letters when both floors are met", async () => {
    const registry = makeRegistry()
    const sleeps: number[] = []
    const err = () => new Error("upstream reset")
    await expect(
      runInboundWithDeadLetter(
        registry,
        0,
        {
          work: async () => {
            throw err()
          },
          sleep: async (ms) => {
            sleeps.push(ms)
          },
        },
        () => 60_000,
      ),
    ).rejects.toThrow("upstream reset")

    // Attempts 1..2 retry; after attempt 3 (floor) with age 60s >= 10s the
    // event is dead-lettered.
    expect(registry.snapshot()).toMatchObject({ deadLettered: 1, nonRetryable: 0 })
    const entry = registry.list()[0]
    expect(entry).toMatchObject({ cause: "retry-limit-exceeded", attempts: 3 })
    expect(sleeps).toHaveLength(2)
  })

  it("keeps retrying a retry-exhausted event that is still too young", async () => {
    const registry = makeRegistry()
    let attempts = 0
    // ReceivedAt such that even after 3 attempts the age floor is unmet.
    await expect(
      runInboundWithDeadLetter(
        registry,
        55_000,
        {
          work: async () => {
            attempts += 1
            if (attempts < 5) throw new Error("flaky")
            return "recovered"
          },
          sleep: async () => {},
        },
        () => 60_000,
      ),
    ).resolves.toBe("recovered")
    // Attempts 1-3 were below the age floor at evaluation time, so the run
    // continued past the attempt floor instead of dead-lettering.
    expect(attempts).toBe(5)
    expect(registry.snapshot()).toMatchObject({ deadLettered: 0 })
  })

  it("returns the work result untouched when nothing fails", async () => {
    const registry = makeRegistry()
    await expect(
      runInboundWithDeadLetter(registry, 0, { work: async () => 42, sleep: async () => {} }),
    ).resolves.toBe(42)
    expect(registry.snapshot()).toMatchObject({ deadLettered: 0 })
  })
})

describe("inbound dead-letter routes (mini Hono flow)", () => {
  function makeApp() {
    const gate = new InboundGate({ maxInFlight: 4, maxQueued: 4 })
    const registry = new DeadLetterRegistry(POLICY, { now: () => 1_000 })
    const app = new Hono()
    app.use("/api/*", inboundAdmission({ gate, deadLetter: { registry } }))
    const routes = inboundRoutes({ gate, deadLetter: registry })
    app.get("/api/inbound/stats", (c) => routes.stats(c))
    app.get("/api/inbound/dead-letter", (c) => routes.deadLetter(c))
    app.post("/api/parse", async (c) => {
      // Structurally invalid payload: the well-behaved handler answers 422.
      try {
        JSON.parse(await c.req.text())
        return c.json({ ok: true })
      } catch {
        return c.json({ error: "invalid_json" }, 422)
      }
    })
    app.post("/api/unauthorized", (c) => c.json({ error: "unauthorized" }, 401))
    app.post("/api/transient", async () => {
      throw new Error("socket hang up")
    })
    return { app, registry }
  }

  it("dead-letters a structurally invalid request and exposes it via stats + list", async () => {
    const { app, registry } = makeApp()
    const res = await app.request("/api/parse", { method: "POST", body: "{not json" })
    expect(res.status).toBe(422)
    expect(registry.snapshot()).toMatchObject({ deadLettered: 1, nonRetryable: 1 })

    const list = await app.request("/api/inbound/dead-letter")
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as {
      items: Array<{ cause: string; reason: string }>
      snapshot: { deadLettered: number }
    }
    expect(listBody.items).toHaveLength(1)
    expect(listBody.items[0]).toMatchObject({
      cause: "non-retryable",
      reason: "invalid-request (422)",
    })
    expect(listBody.snapshot.deadLettered).toBe(1)

    const stats = await app.request("/api/inbound/stats")
    const statsBody = (await stats.json()) as { stats: { deadLetter: { size: number } } }
    expect(statsBody.stats.deadLetter.size).toBe(1)
  })

  it("dead-letters an auth failure outcome and leaves retryable 5xx alone", async () => {
    const { app, registry } = makeApp()
    const unauthorized = await app.request("/api/unauthorized", { method: "POST" })
    expect(unauthorized.status).toBe(401)
    expect(registry.snapshot()).toMatchObject({ deadLettered: 1, nonRetryable: 1 })

    vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const res = await app.request("/api/transient", { method: "POST" })
      expect(res.status).toBe(500)
    } finally {
      vi.restoreAllMocks()
    }
    expect(registry.snapshot()).toMatchObject({ deadLettered: 1, nonRetryable: 1 })
  })

  it("keeps admission working for healthy requests (no dead-letter noise)", async () => {
    const { app, registry } = makeApp()
    app.post("/api/ok", (c) => c.json({ ok: true }))
    const res = await app.request("/api/ok", { method: "POST" })
    expect(res.status).toBe(200)
    expect(registry.snapshot()).toMatchObject({ deadLettered: 0, size: 0 })
  })

  it("serves an empty dead-letter section when the layer is not wired", async () => {
    const gate = new InboundGate({ maxInFlight: 1, maxQueued: 1 })
    const app = new Hono()
    const routes = inboundRoutes({ gate })
    app.get("/api/inbound/stats", (c) => routes.stats(c))
    app.get("/api/inbound/dead-letter", (c) => routes.deadLetter(c))
    const stats = (await (await app.request("/api/inbound/stats")).json()) as {
      stats: { deadLetter: { size: number; deadLettered: number } }
    }
    expect(stats.stats.deadLetter).toEqual({
      deadLettered: 0,
      nonRetryable: 0,
      evicted: 0,
      pruned: 0,
      size: 0,
      retentionCap: 0,
    })
    const list = (await (await app.request("/api/inbound/dead-letter")).json()) as {
      items: unknown[]
    }
    expect(list.items).toEqual([])
  })
})
