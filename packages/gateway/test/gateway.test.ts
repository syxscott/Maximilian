// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Gateway tests — sender tiers (fail-closed ingress), dedupe, outbound
 * delivery with graceful drain.
 */

import { describe, it, expect, vi } from "vitest"
import { Gateway } from "../src/gateway.js"
import { createWebhookAdapter, createConsoleAdapter } from "../src/adapters.js"
import { workspaceCompletedNotification } from "../src/index.js"
import type { OutboundNotification } from "../src/types.js"

function okWebhook(deliveries: OutboundNotification[]) {
  return createWebhookAdapter({
    url: "https://hooks.example/x",
    fetchImpl: (async (_url: unknown, init?: RequestInit) => {
      deliveries.push(JSON.parse(String(init?.body)))
      return new Response("ok", { status: 200 })
    }) as unknown as typeof fetch,
  })
}

describe("Gateway inbound", () => {
  it("normalizes and accepts messages from trusted senders", () => {
    const gw = new Gateway().registerAdapter(createConsoleAdapter())
    const res = gw.acceptInbound("console", {
      messageId: "m1",
      senderId: "boss",
      text: "deploy now",
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.message.sender.trust).toBe("owner") // console adapter default
      expect(res.message.channel).toBe("console")
    }
  })

  it("rejects unknown senders fail-closed (no allowlist, minTrust=trusted)", () => {
    const gw = new Gateway({ defaultPolicy: { minTrust: "trusted" } }).registerAdapter(
      createWebhookAdapter({ url: "https://x" }),
    )
    const res = gw.acceptInbound("webhook", {
      messageId: "m2",
      senderId: "stranger",
      text: "run rm -rf",
    })
    // webhook default trust is 'known' (1) < trusted (2)
    expect(res).toEqual({ ok: false, reason: "unauthorized" })
  })

  it("allowlisted senders pass even with low trust", () => {
    const gw = new Gateway({
      policies: { webhook: { allowlist: ["svc-bot"] } },
    }).registerAdapter(createWebhookAdapter({ url: "https://x" }))
    const res = gw.acceptInbound("webhook", {
      messageId: "m3",
      senderId: "svc-bot",
      text: "status",
    })
    expect(res.ok).toBe(true)
  })

  it("drops replayed messageIds as duplicates", () => {
    const gw = new Gateway().registerAdapter(createConsoleAdapter())
    const first = gw.acceptInbound("console", { messageId: "same", senderId: "boss", text: "hi" })
    const replay = gw.acceptInbound("console", { messageId: "same", senderId: "boss", text: "hi" })
    expect(first.ok).toBe(true)
    expect(replay).toEqual({ ok: false, reason: "duplicate" })
  })

  it("rejects malformed payloads and unknown channels", () => {
    const gw = new Gateway().registerAdapter(createConsoleAdapter())
    const bad = gw.acceptInbound("console", { senderId: "boss", text: "x" } as never)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toBe("malformed")
    const noAdapter = gw.acceptInbound("telegram", { messageId: "m", senderId: "s", text: "x" })
    expect(noAdapter.ok).toBe(false)
    if (!noAdapter.ok) expect(noAdapter.reason).toBe("malformed")
  })

  it("owners configured per channel get owner trust", () => {
    const gw = new Gateway({
      owners: { webhook: ["the-boss"] },
    }).registerAdapter(createWebhookAdapter({ url: "https://x" }))
    const res = gw.acceptInbound("webhook", { messageId: "m9", senderId: "the-boss", text: "go" })
    expect(res.ok).toBe(true)
  })
})

describe("Gateway outbound", () => {
  it("delivers notifications through the adapter", async () => {
    const deliveries: OutboundNotification[] = []
    const gw = new Gateway().registerAdapter(okWebhook(deliveries))
    expect(
      gw.notify({
        channel: "webhook",
        recipientId: "boss",
        title: "done",
        body: "workspace finished",
        severity: "info",
      }),
    ).toBe(true)
    await gw.close()
    expect(deliveries).toHaveLength(1)
    expect(gw.pendingDeliveries).toBe(0)
  })

  it("returns false for unknown channels and after close()", async () => {
    const gw = new Gateway()
    expect(
      gw.notify({ channel: "nope", recipientId: "x", title: "t", body: "b", severity: "info" }),
    ).toBe(false)
    await gw.close()
    const deliveries: OutboundNotification[] = []
    expect(
      gw.notify({ channel: "webhook", recipientId: "x", title: "t", body: "b", severity: "info" }),
    ).toBe(false)
    expect(deliveries).toHaveLength(0)
  })

  it("close() drains in-flight deliveries", async () => {
    let resolveDelivery!: () => void
    const gate = new Promise<void>((r) => (resolveDelivery = r))
    let delivered = false
    const slow = createWebhookAdapter({
      url: "https://x",
      fetchImpl: (async () => {
        await gate
        delivered = true
        return new Response("ok", { status: 200 })
      }) as unknown as typeof fetch,
    })
    const gw = new Gateway({ drainTimeoutMs: 2_000 }).registerAdapter(slow)
    gw.notify({ channel: "webhook", recipientId: "r", title: "t", body: "b", severity: "info" })
    setTimeout(() => resolveDelivery(), 5)
    await gw.close()
    expect(delivered).toBe(true)
  })

  it("adapter delivery failures never crash the gateway", async () => {
    const failing = createWebhookAdapter({
      fetchImpl: (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
    })
    const gw = new Gateway({ drainTimeoutMs: 500 }).registerAdapter(failing)
    expect(
      gw.notify({ channel: "webhook", recipientId: "r", title: "t", body: "b", severity: "info" }),
    ).toBe(true)
    await gw.close()
    expect(gw.pendingDeliveries).toBe(0)
  })
})

describe("workspaceCompletedNotification", () => {
  it("marks failures as error severity", () => {
    const failed = workspaceCompletedNotification({
      channel: "webhook",
      recipientId: "boss",
      workspaceId: "ws-1",
      status: "failed",
      error: "boom",
    })
    expect(failed.severity).toBe("error")
    expect(failed.body).toBe("boom")

    const ok = workspaceCompletedNotification({
      channel: "webhook",
      recipientId: "boss",
      workspaceId: "ws-1",
      status: "completed",
      taskCount: 3,
    })
    expect(ok.severity).toBe("info")
    expect(ok.body).toContain("3 task(s)")
  })
})
