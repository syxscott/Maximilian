// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Request-body byte gates (cc-switch read_request_body_limited borrowing):
 *   - JSON gate: over the cap → 413; exactly at the cap passes; normal
 *     bodies and non-JSON content types are untouched
 *   - multipart gate: same boundary semantics with its own larger cap;
 *     chunked uploads (no Content-Length) are enforced by draining a clone
 *     while leaving the original body readable for the route
 */

import { describe, it, expect } from "vitest"
import { Hono } from "hono"
import { jsonBodyGate } from "../src/middleware/json-body-gate.js"
import { multipartBodyGate } from "../src/middleware/multipart-body-gate.js"
import {
  DEFAULT_JSON_BODY_MAX_BYTES,
  DEFAULT_MULTIPART_BODY_MAX_BYTES,
  PAYLOAD_TOO_LARGE_MESSAGE,
} from "../src/lib/request-body-limit.js"

describe("jsonBodyGate — byte cap", () => {
  function makeApp(maxBytes: number) {
    const app = new Hono()
    app.use("/api/*", jsonBodyGate({ maxBytes }))
    app.post("/api/chat", async (c) => c.json({ ok: true, received: await c.req.json() }))
    return app
  }

  const MAX = 2048

  it("rejects a body one byte over the cap with a stable 413", async () => {
    const app = makeApp(MAX)
    const body = '{"pad":"' + "a".repeat(MAX - 10) + '"}!' // MAX + 1 bytes
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    })
    expect(res.status).toBe(413)
    const payload = (await res.json()) as { error: string; message: string; maxBytes: number }
    expect(payload.error).toBe("payload_too_large")
    expect(payload.message).toBe(PAYLOAD_TOO_LARGE_MESSAGE)
    expect(payload.maxBytes).toBe(MAX)
  })

  it("accepts a body exactly at the cap", async () => {
    const app = makeApp(MAX)
    const body = '{"pad":"' + "a".repeat(MAX - 10) + '"}'
    expect(new TextEncoder().encode(body).byteLength).toBe(MAX)
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    })
    expect(res.status).toBe(200)
    const payload = (await res.json()) as { ok: boolean; received: { pad: string } }
    expect(payload.ok).toBe(true)
    expect(payload.received.pad).toHaveLength(MAX - 10)
  })

  it("lets normal bodies through", async () => {
    const app = makeApp(MAX)
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"message":"hi"}',
    })
    expect(res.status).toBe(200)
  })

  it("does not gate non-JSON requests", async () => {
    const app = makeApp(8)
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "this is definitely longer than eight bytes",
    })
    expect(res.status).toBe(500) // route tried to JSON.parse the text body
  })

  it("enforces the cap for chunked JSON (no Content-Length)", async () => {
    const app = makeApp(32)
    const body = new TextEncoder().encode('{"message":"chunked"}')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body)
        controller.close()
      },
    })
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    })
    const ok = await app.request(request)
    expect(ok.status).toBe(200)

    const huge = new TextEncoder().encode('{"message":"' + "a".repeat(64) + '"}')
    const hugeStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(huge)
        controller.close()
      },
    })
    const rejected = await app.request(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: hugeStream,
        duplex: "half",
      }),
    )
    expect(rejected.status).toBe(413)
  })

  it("defaults are exported and sane", () => {
    expect(DEFAULT_JSON_BODY_MAX_BYTES).toBe(512 * 1024)
  })
})

describe("multipartBodyGate — byte cap", () => {
  const BOUNDARY = "----maximilian-test-boundary"

  function multipartString(fileBytes: number): string {
    const head =
      `--${BOUNDARY}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="backup.zip"\r\n' +
      "Content-Type: application/zip\r\n\r\n"
    const tail = `\r\n--${BOUNDARY}--\r\n`
    return head + "a".repeat(fileBytes) + tail
  }

  function fileBytesForTotal(totalBytes: number): number {
    const overhead = multipartString(0).length
    return totalBytes - overhead
  }

  function makeApp(maxBytes: number) {
    const app = new Hono()
    app.use("/api/*", multipartBodyGate({ maxBytes }))
    app.post("/api/sessions/restore", async (c) => {
      const form = await c.req.parseBody()
      const file = form["file"]
      const size = typeof file === "object" && file !== null ? (file as File).size : 0
      return c.json({ restored: 0, size })
    })
    return app
  }

  const MAX = 4096

  it("rejects an upload one byte over the cap with 413", async () => {
    const app = makeApp(MAX)
    const body = multipartString(fileBytesForTotal(MAX + 1))
    const res = await app.request("/api/sessions/restore", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
      body,
    })
    expect(res.status).toBe(413)
    const payload = (await res.json()) as { error: string; message: string }
    expect(payload.error).toBe("payload_too_large")
    expect(payload.message).toBe(PAYLOAD_TOO_LARGE_MESSAGE)
  })

  it("accepts an upload exactly at the cap and parses the file", async () => {
    const app = makeApp(MAX)
    const body = multipartString(fileBytesForTotal(MAX))
    expect(new TextEncoder().encode(body).byteLength).toBe(MAX)
    const res = await app.request("/api/sessions/restore", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
      body,
    })
    expect(res.status).toBe(200)
    const payload = (await res.json()) as { size: number }
    expect(payload.size).toBe(fileBytesForTotal(MAX))
  })

  it("accepts a small archive", async () => {
    const app = makeApp(MAX)
    const body = multipartString(10)
    const res = await app.request("/api/sessions/restore", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
      body,
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { size: number }).size).toBe(10)
  })

  it("enforces the cap for chunked uploads without consuming the body", async () => {
    const app = makeApp(MAX)
    const under = new TextEncoder().encode(multipartString(fileBytesForTotal(MAX)))
    const underRes = await app.request(
      new Request("http://localhost/api/sessions/restore", {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(under)
            controller.close()
          },
        }),
        duplex: "half",
      }),
    )
    expect(underRes.status).toBe(200)
    expect(((await underRes.json()) as { size: number }).size).toBe(fileBytesForTotal(MAX))

    const over = new TextEncoder().encode(multipartString(fileBytesForTotal(MAX + 1)))
    const overRes = await app.request(
      new Request("http://localhost/api/sessions/restore", {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(over)
            controller.close()
          },
        }),
        duplex: "half",
      }),
    )
    expect(overRes.status).toBe(413)
  })

  it("defaults are exported and sane", () => {
    expect(DEFAULT_MULTIPART_BODY_MAX_BYTES).toBe(128 * 1024 * 1024)
  })
})
