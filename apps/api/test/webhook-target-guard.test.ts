// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Webhook target allowlist tests (gateway isAllowedWebhookUrl borrowing):
 *   - loopback / RFC 1918 / link-local / cloud metadata targets are rejected
 *     for user-controlled webhook subscriptions (SSRF)
 *   - IPv6 loopback / ULA / link-local and IPv4-mapped forms are rejected
 *   - non-http(s) schemes and unparseable URLs are rejected
 *   - public IP literals and DNS names pass
 *   - the `allowInsecure` escape hatch overrides the guard (test-only)
 */

import { describe, it, expect } from "vitest"
import {
  isAllowedWebhookUrl,
  webhookTargetRejectionReason,
  WebhookTargetRejectedError,
} from "../src/lib/webhook-target-guard.js"

describe("isAllowedWebhookUrl — SSRF ranges", () => {
  const rejected = [
    "http://127.0.0.1/hook",
    "http://127.0.0.1:8080/hook",
    "http://localhost/hook",
    "http://LOCALHOST/hook",
    "http://sub.localhost/hook",
    "http://0.0.0.0/hook",
    "http://10.1.2.3/hook",
    "http://172.16.0.1/hook",
    "http://172.31.255.255/hook",
    "http://192.168.1.1/hook",
    "http://169.254.169.254/latest/meta-data",
    "http://169.254.170.2/latest/meta-data",
    "http://100.64.0.1/hook",
    "http://[::1]/hook",
    "http://[::ffff:127.0.0.1]/hook",
    "http://[fe80::1]/hook",
    "http://[fd00::1]/hook",
    "http://service.local/hook",
    "http://metadata.google.internal/computeMetadata/v1/",
  ]

  for (const url of rejected) {
    it(`rejects ${url}`, () => {
      const verdict = isAllowedWebhookUrl(url)
      expect(verdict.ok).toBe(false)
      if (!verdict.ok) expect(verdict.reason.length).toBeGreaterThan(0)
      expect(webhookTargetRejectionReason(url)).not.toBeNull()
    })
  }

  it("rejects non-http(s) schemes and malformed URLs", () => {
    expect(isAllowedWebhookUrl("file:///etc/passwd").ok).toBe(false)
    expect(isAllowedWebhookUrl("ftp://example.com/hook").ok).toBe(false)
    expect(isAllowedWebhookUrl("not a url").ok).toBe(false)
    expect(isAllowedWebhookUrl("").ok).toBe(false)
  })

  it("allows public IP literals and DNS names", () => {
    expect(isAllowedWebhookUrl("https://example.com/hook")).toEqual({ ok: true })
    expect(isAllowedWebhookUrl("https://hooks.example.com:8443/hook?x=1")).toEqual({ ok: true })
    expect(isAllowedWebhookUrl("http://8.8.8.8/hook")).toEqual({ ok: true })
    expect(isAllowedWebhookUrl("http://[2606:4700::1111]/hook")).toEqual({ ok: true })
    expect(webhookTargetRejectionReason("https://example.com/hook")).toBeNull()
  })

  it("allowInsecure overrides every rejection", () => {
    for (const url of rejected) {
      expect(isAllowedWebhookUrl(url, { allowInsecure: true })).toEqual({ ok: true })
      expect(webhookTargetRejectionReason(url, { allowInsecure: true })).toBeNull()
    }
  })

  it("rejects an IPv4-mapped private address inside IPv6", () => {
    const verdict = isAllowedWebhookUrl("http://[::ffff:192.168.0.10]/hook")
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain("IPv4-mapped")
  })

  it("WebhookTargetRejectedError carries target and reason", () => {
    const err = new WebhookTargetRejectedError("http://127.0.0.1/x", "loopback")
    expect(err).toBeInstanceOf(Error)
    expect(err.target).toBe("http://127.0.0.1/x")
    expect(err.reason).toBe("loopback")
    expect(err.message).toContain("loopback")
  })
})
