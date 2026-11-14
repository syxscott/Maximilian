// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// (OpenAgentCore wire-semantics.md "Creation retries" borrowing)
// Idempotency-Key receipt tests:
//   - same key + same body hits the receipt and replays the ORIGINAL
//     result (the handler runs once)
//   - same key + a different body answers 409 idempotency_conflict
//   - a semantically identical body (key order / whitespace) is NOT a
//     conflict — receipts hash the parsed body, not the raw bytes
//   - no key / empty key → every request executes
//   - keys over 256 bytes → 400 invalid_request
//   - failed responses are never stored (the retry re-executes)
//   - the store is bounded and expires stale receipts

import { describe, it, expect } from "vitest"
import { Hono } from "hono"
import {
  IdempotencyReceiptStore,
  canonicalizeJson,
  hashRequestBody,
  IDEMPOTENCY_KEY_MAX_BYTES,
} from "../src/lib/inbound-queue.js"
import { idempotencyKey } from "../src/middleware/idempotency-key.js"

function makeApp(opts?: { store?: IdempotencyReceiptStore }) {
  const store = opts?.store ?? new IdempotencyReceiptStore()
  let executions = 0
  const app = new Hono()
  app.use("/api/*", idempotencyKey({ store }))
  app.post("/api/chat", async (c) => {
    executions += 1
    const body = await c.req.json()
    return c.json({ workspaceId: `ws-${executions}`, echo: body }, 200)
  })
  app.post("/api/fail", async (c) => {
    executions += 1
    return c.json({ error: "boom" }, 500)
  })
  return { app, store, executed: () => executions }
}

describe("IdempotencyReceiptStore — model", () => {
  it("records, returns, and expires receipts", () => {
    let t = 0
    const store = new IdempotencyReceiptStore({ now: () => t, ttlMs: 1_000 })
    store.record("k", { bodyHash: "h1", status: 200, body: { ok: true } })
    expect(store.get("k")?.bodyHash).toBe("h1")

    t = 1_001 // past the TTL
    expect(store.get("k")).toBeUndefined()
    expect(store.size).toBe(0)
  })

  it("stays bounded: oldest receipts are evicted beyond maxEntries", () => {
    const store = new IdempotencyReceiptStore({ maxEntries: 3 })
    for (let i = 0; i < 5; i++) {
      store.record(`k${i}`, { bodyHash: String(i), status: 200, body: { i } })
    }
    expect(store.get("k0")).toBeUndefined()
    expect(store.get("k1")).toBeUndefined()
    expect(store.get("k4")?.bodyHash).toBe("4")
  })

  it("canonicalizes parsed JSON (key order and whitespace vanish)", () => {
    const a = canonicalizeJson({ b: 2, a: { d: 4, c: 3 } })
    const b = canonicalizeJson({ a: { c: 3, d: 4 }, b: 2 })
    expect(a).toBe(b)
    expect(canonicalizeJson([2, 1])).toBe("[2,1]") // arrays keep order
  })

  it("hashes the parsed body so re-serialization is stable", async () => {
    const h1 = await hashRequestBody('{"a":1,"b":{"c":2}}')
    const h2 = await hashRequestBody('{\n  "b": {"c": 2},\n "a": 1\n}')
    expect(h1).toBe(h2)
    const h3 = await hashRequestBody('{"a":2,"b":{"c":2}}')
    expect(h3).not.toBe(h1)
  })

  it("rejects keys over the 256-byte wire cap", () => {
    expect(IDEMPOTENCY_KEY_MAX_BYTES).toBe(256)
  })
})

describe("idempotency-key middleware", () => {
  it("same key + same body hits the receipt and replays the original result", async () => {
    const { app, executed } = makeApp()
    const request = () =>
      app.request("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": "key-1" },
        body: JSON.stringify({ message: "hello" }),
      })

    const first = await request()
    expect(first.status).toBe(200)
    expect((await first.json()).workspaceId).toBe("ws-1")
    expect(executed()).toBe(1)

    // Retry with the SAME key and body: no re-execution, original result.
    const retry = await request()
    expect(retry.status).toBe(200)
    const body = await retry.json()
    expect(body.workspaceId).toBe("ws-1")
    expect(retry.headers.get("Idempotency-Replayed")).toBe("true")
    expect(executed()).toBe(1)
  })

  it("same key + a different body answers 409 idempotency_conflict", async () => {
    const { app, executed } = makeApp()
    const base = {
      method: "POST" as const,
      headers: { "content-type": "application/json", "Idempotency-Key": "key-2" },
    }
    const first = await app.request("/api/chat", {
      ...base,
      body: JSON.stringify({ message: "hello" }),
    })
    expect(first.status).toBe(200)

    const conflict = await app.request("/api/chat", {
      ...base,
      body: JSON.stringify({ message: "DIFFERENT payload" }),
    })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({ error: "idempotency_conflict" })
    // The conflicting request never reached the handler.
    expect(executed()).toBe(1)
  })

  it("a semantically identical body (key order/whitespace) replays, not conflicts", async () => {
    const { app } = makeApp()
    const headers = { "content-type": "application/json", "Idempotency-Key": "key-3" }
    await app.request("/api/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "hello", resourceBudget: { vramMb: 8 } }),
    })
    const retry = await app.request("/api/chat", {
      method: "POST",
      headers,
      body: '{"resourceBudget":{"vramMb":8},"message":"hello"}',
    })
    expect(retry.status).toBe(200)
    expect(retry.headers.get("Idempotency-Replayed")).toBe("true")
  })

  it("different keys never collide, and keyless requests always execute", async () => {
    const { app, executed } = makeApp()
    const send = (key?: string) =>
      app.request("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: JSON.stringify({ message: "hello" }),
      })

    await send("a")
    const b = await send("b")
    expect(b.status).toBe(200)
    expect((await b.json()).workspaceId).toBe("ws-2")
    const keyless = await send()
    expect((await keyless.json()).workspaceId).toBe("ws-3")
    const emptyKey = await send("   ") // empty header counts as no key
    expect((await emptyKey.json()).workspaceId).toBe("ws-4")
    // Every one of the four requests executed: "b" is a different key,
    // and both the absent and the empty key are "no key".
    expect(executed()).toBe(4)
  })

  it("keys over the wire cap return 400 without executing", async () => {
    const { app, executed } = makeApp()
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "k".repeat(257) },
      body: JSON.stringify({ message: "hello" }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: "invalid_request" })
    expect(executed()).toBe(0)
  })

  it("failed responses are not stored — the retry re-executes", async () => {
    const { app, executed } = makeApp()
    const send = () =>
      app.request("/api/fail", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": "key-fail" },
        body: JSON.stringify({ message: "hello" }),
      })
    await send()
    const retry = await send()
    expect(retry.status).toBe(500)
    expect(executed()).toBe(2)

    // A later success under the same key still receipts normally.
    const recovered = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "key-fail" },
      body: JSON.stringify({ message: "hello" }),
    })
    expect(recovered.status).toBe(200)
    const again = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "key-fail" },
      body: JSON.stringify({ message: "hello" }),
    })
    expect(again.headers.get("Idempotency-Replayed")).toBe("true")
  })
})
