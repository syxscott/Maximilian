// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Webhook subscription hardening tests (cc-switch usage_script.rs borrowing):
 *   - createSubscription rejects SSRF targets at the domain layer; the
 *     OpenAPI request schema rejects them at the HTTP boundary too
 *   - delivery never follows redirects (`redirect: "manual"`), so a 302 to
 *     cloud metadata is delivered nowhere and the HMAC signature header is
 *     never handed to the redirect target
 *   - an oversized response aborts immediately (no retries) and counts as a
 *     failure, never as a delivery
 *   - the target allowlist is re-checked at delivery time; `allowInsecure`
 *     is the explicit test-only escape hatch
 */

import { describe, it, expect } from "vitest"
import { createHmac } from "node:crypto"
import { OpenAPIHono } from "@hono/zod-openapi"
import {
  createSubscription,
  deleteSubscription,
  publishEvent,
  createSubscriptionRoute,
  CreateSubscriptionRequest,
} from "../src/routes/subscriptions.js"

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>

interface RecordedCall {
  url: string
  init: FetchInit
}

function recordFetch(responder: () => Response) {
  const calls: RecordedCall[] = []
  const fetchImpl = (async (input: FetchInput, init?: FetchInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : (input.url as string)
    calls.push({ url, init: init ?? {} })
    return responder()
  }) as typeof fetch
  return { calls, fetchImpl }
}

function oversizedResponse(maxBytes: number): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(maxBytes + 1))
        controller.close()
      },
    }),
  )
}

describe("createSubscription — webhook target guard", () => {
  it("rejects loopback / private / link-local / metadata targets", () => {
    const targets = [
      "http://127.0.0.1/hook",
      "http://localhost/hook",
      "http://10.0.0.5/hook",
      "http://192.168.1.2/hook",
      "http://169.254.169.254/latest/meta-data",
    ]
    for (const target of targets) {
      expect(() => createSubscription({ type: "webhook", target })).toThrow(/webhook target/)
    }
  })

  it("accepts a public target", () => {
    const sub = createSubscription({ type: "webhook", target: "https://example.com/hook" })
    expect(sub.target).toBe("https://example.com/hook")
    deleteSubscription(sub.id)
  })

  it("accepts an insecure target only via the explicit escape hatch", () => {
    const sub = createSubscription({
      type: "webhook",
      target: "http://127.0.0.1:9/hook",
      allowInsecureWebhookTargets: true,
    })
    expect(sub.target).toBe("http://127.0.0.1:9/hook")
    deleteSubscription(sub.id)
  })

  it("does not gate SSE targets (delivery ignores them)", () => {
    const sub = createSubscription({ type: "sse", target: "not-a-url" })
    deleteSubscription(sub.id)
  })

  it("the OpenAPI request schema rejects disallowed webhook targets", () => {
    const bad = CreateSubscriptionRequest.safeParse({
      type: "webhook",
      target: "http://169.254.169.254/latest/meta-data",
    })
    expect(bad.success).toBe(false)

    const good = CreateSubscriptionRequest.safeParse({
      type: "webhook",
      target: "https://hooks.example.com/endpoint",
    })
    expect(good.success).toBe(true)

    // SSE target is ignored by delivery, so only webhook targets are gated.
    const sse = CreateSubscriptionRequest.safeParse({
      type: "sse",
      target: "http://127.0.0.1/ignored",
    })
    expect(sse.success).toBe(true)
  })

  it("the registered route answers 400 before the handler for a bad target", async () => {
    const app = new OpenAPIHono()
    app.openapi(createSubscriptionRoute, (c) => {
      const { type, target, events } = c.req.valid("json")
      return c.json(createSubscription({ type, target, events }), 201)
    })

    const bad = await app.request("/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "webhook", target: "http://169.254.169.254/latest/meta-data" }),
    })
    expect(bad.status).toBe(400)

    const good = await app.request("/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "webhook", target: "https://hooks.example.com/endpoint" }),
    })
    expect(good.status).toBe(201)
    const created = (await good.json()) as { id: string }
    deleteSubscription(created.id)
  })
})

describe("publishEvent — redirect and response limits", () => {
  it("does not follow a 302 and does not leak the signature header", async () => {
    const sub = createSubscription({
      type: "webhook",
      target: "https://hooks.example.test/endpoint",
    })
    const { calls, fetchImpl } = recordFetch(
      () =>
        new Response("redirected", {
          status: 302,
          headers: {
            location: "http://169.254.169.254/latest/meta-data",
            "x-maximilian-signature": "sha256=echoed",
          },
        }),
    )

    await publishEvent("task-complete", { workspaceId: "w1" }, undefined, { fetchImpl })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe("https://hooks.example.test/endpoint")
    // The chosen no-follow policy: undici returns the real 3xx response.
    expect(calls[0]!.init.redirect).toBe("manual")
    // Signature header went to the allowlisted target only…
    const headers = new Headers(calls[0]!.init.headers)
    expect(headers.get("x-maximilian-signature")).toMatch(/^sha256=/)
    // …and no request was ever made to the redirect target.
    expect(calls.some((call) => call.url.includes("169.254.169.254"))).toBe(false)

    // A 302 is not a successful delivery.
    expect(sub.totalDeliveries).toBe(1)
    expect(sub.totalFailures).toBe(1)
    deleteSubscription(sub.id)
  })

  it("delivers a small 200 response and records success", async () => {
    const sub = createSubscription({
      type: "webhook",
      target: "https://hooks.example.test/ok",
    })
    const { calls, fetchImpl } = recordFetch(() => new Response("", { status: 200 }))

    await publishEvent("task-update", {}, undefined, { fetchImpl })

    expect(calls).toHaveLength(1)
    expect(sub.totalDeliveries).toBe(1)
    expect(sub.totalFailures).toBe(0)
    deleteSubscription(sub.id)
  })

  it("aborts an oversized response immediately and does not count it delivered", async () => {
    const sub = createSubscription({
      type: "webhook",
      target: "https://hooks.example.test/huge",
    })
    const { calls, fetchImpl } = recordFetch(() => oversizedResponse(64))

    await publishEvent("task-update", {}, undefined, { fetchImpl, maxResponseBytes: 64 })

    // One attempt only: retrying cannot shrink the body.
    expect(calls).toHaveLength(1)
    expect(sub.totalDeliveries).toBe(0)
    expect(sub.totalFailures).toBe(1)
    deleteSubscription(sub.id)
  })

  it("re-checks the allowlist at delivery time", async () => {
    const sub = createSubscription({
      type: "webhook",
      target: "http://127.0.0.1:9/hook",
      allowInsecureWebhookTargets: true,
    })
    const blocked = recordFetch(() => new Response("", { status: 200 }))
    await publishEvent("task-update", {}, undefined, { fetchImpl: blocked.fetchImpl })
    expect(blocked.calls).toHaveLength(0)
    expect(sub.totalDeliveries).toBe(0)
    expect(sub.totalFailures).toBe(1)

    const allowed = recordFetch(() => new Response("", { status: 200 }))
    await publishEvent("task-update", {}, undefined, {
      fetchImpl: allowed.fetchImpl,
      allowInsecureWebhookTargets: true,
    })
    expect(allowed.calls).toHaveLength(1)
    expect(sub.totalDeliveries).toBe(1)
    deleteSubscription(sub.id)
  })

  it("signs exactly the POSTed body (HMAC over the wire payload)", async () => {
    const sub = createSubscription({
      type: "webhook",
      target: "https://hooks.example.test/signed",
    })
    let capturedBody = ""
    let capturedSignature = ""
    const capturing = (async (_input: FetchInput, init?: FetchInit) => {
      capturedBody = String(init?.body ?? "")
      capturedSignature = new Headers(init?.headers).get("x-maximilian-signature") ?? ""
      return new Response("", { status: 200 })
    }) as typeof fetch

    await publishEvent("signed-event", { n: 1 }, undefined, { fetchImpl: capturing })

    const expected = `sha256=${createHmac("sha256", sub.secret).update(capturedBody).digest("hex")}`
    expect(capturedSignature).toBe(expected)
    deleteSubscription(sub.id)
  })
})
