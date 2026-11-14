// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// (OpenAgentCore wire-semantics.md table row 5 borrowing) Duplicate JSON
// key gate tests:
//   - {"a":1,"a":2} → 400 carrying the dotted path
//   - duplicates at ANY depth are caught ("metadata.k"-style paths),
//     including inside arrays (indices omitted from the path)
//   - keys compare after unescaping and case-sensitively
//   - the FIRST repeat in document order is reported
//   - normal bodies (and non-JSON requests) pass untouched

import { describe, it, expect } from "vitest"
import { Hono } from "hono"
import {
  findDuplicateJsonKeyPath,
  jsonBodyGate,
  DUPLICATE_JSON_KEY_MESSAGE_PREFIX,
} from "../src/middleware/json-body-gate.js"

describe("findDuplicateJsonKeyPath — scanner", () => {
  it("finds a duplicate at the root", () => {
    expect(findDuplicateJsonKeyPath('{"a":1,"a":2}')).toEqual({ path: "a", ok: true })
  })

  it("finds duplicates at any depth with a dotted path", () => {
    expect(findDuplicateJsonKeyPath('{"metadata":{"k":1,"k":2}}')).toEqual({
      path: "metadata.k",
      ok: true,
    })
    expect(
      findDuplicateJsonKeyPath('{"outer":{"inner":{"tools":{"type":"a","type":"b"}}}}'),
    ).toEqual({ path: "outer.inner.tools.type", ok: true })
  })

  it("paths omit array indices", () => {
    expect(findDuplicateJsonKeyPath('{"tools":[{"type":"a"},{"type":"x","type":"y"}]}')).toEqual({
      path: "tools.type",
      ok: true,
    })
  })

  it("reports the FIRST repeat in document order", () => {
    const scan = findDuplicateJsonKeyPath('{"a":{"b":1,"b":2},"c":1,"c":2}')
    expect(scan.path).toBe("a.b")
  })

  it("compares keys after unescaping, case-sensitively", () => {
    // \u0061 === "a" → duplicate
    expect(findDuplicateJsonKeyPath('{"a":1,"\\u0061":2}')?.path).toBe("a")
    // different case is NOT a duplicate
    expect(findDuplicateJsonKeyPath('{"a":1,"A":2}').path).toBeNull()
    // an escaped slash and a raw slash are the same key
    expect(findDuplicateJsonKeyPath('{"x/y":1,"x\\/y":2}').path).toBe("x/y")
  })

  it("clean documents pass, including nested arrays and escapes in values", () => {
    const body = '{"message":"quote \\" and backslash \\\\","items":[1,{"a":2}],"metadata":{"k":1}}'
    expect(findDuplicateJsonKeyPath(body)).toEqual({ path: null, ok: true })
    expect(findDuplicateJsonKeyPath('{"a":1}')).toEqual({ path: null, ok: true })
    expect(findDuplicateJsonKeyPath("[]")).toEqual({ path: null, ok: true })
    expect(findDuplicateJsonKeyPath("[1,2,3]")).toEqual({ path: null, ok: true })
    expect(findDuplicateJsonKeyPath('{"a":{"b":{"c":[true,null,"x"]}}}')).toEqual({
      path: null,
      ok: true,
    })
  })

  it("malformed JSON is reported as inconclusive, not as a duplicate", () => {
    expect(findDuplicateJsonKeyPath('{"a":1,').ok).toBe(false)
    expect(findDuplicateJsonKeyPath('{"a":1,').path).toBeNull()
    expect(findDuplicateJsonKeyPath("not json").ok).toBe(false)
    expect(findDuplicateJsonKeyPath('{"a" 1}').ok).toBe(false)
  })
})

describe("jsonBodyGate — middleware", () => {
  function makeApp() {
    let received: unknown
    const app = new Hono()
    app.use("/api/*", jsonBodyGate())
    app.post("/api/chat", async (c) => {
      received = await c.req.json()
      return c.json({ ok: true, received })
    })
    return { app, received: () => received }
  }

  it("rejects a body with a duplicate key (400 with the dotted path)", async () => {
    const { app } = makeApp()
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"message":"hi","metadata":{"k":1,"k":2}}',
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; message: string; path: string }
    expect(body.error).toBe("invalid_request")
    expect(body.path).toBe("metadata.k")
    expect(body.message).toContain(DUPLICATE_JSON_KEY_MESSAGE_PREFIX)
    expect(body.message).toContain("metadata.k")
  })

  it("normal bodies reach the route untouched", async () => {
    const { app, received } = makeApp()
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello", metadata: { k: 1 }, tags: ["a", "b"] }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; received: unknown }
    expect(body).toEqual({
      ok: true,
      received: { message: "hello", metadata: { k: 1 }, tags: ["a", "b"] },
    })
    // The route parsed the same bytes the gate scanned (bodyCache reuse).
    expect(received()).toEqual({ message: "hello", metadata: { k: 1 }, tags: ["a", "b"] })
  })

  it("does not gate non-JSON requests or empty bodies", async () => {
    const { app } = makeApp()
    const form = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: '{"a":1,"a":2}',
    })
    // The gate passes it through untouched (Hono parses regardless of the
    // declared content-type) — no 400 from the duplicate gate.
    expect(form.status).toBe(200)

    const empty = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "",
    })
    // An empty body is not the gate's concern: it passes through, and the
    // route's own json() parse fails (not a gate 400).
    expect(empty.status).not.toBe(400)
    expect(empty.status).toBe(500)
  })
})
