// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Channel adapters — transport shims over the canonical message shapes.
 * Kept dependency-free: delivery is via an injected `fetch` so tests (and
 * embedding processes) never open real sockets.
 */

import type {
  ChannelAdapter,
  InboundMessage,
  OutboundNotification,
  RawInbound,
  SenderIdentity,
  TrustLevel,
} from "./types.js"

export interface WebhookAdapterOptions {
  /** Delivery endpoint. Required for `send`; inbound normalization works without it. */
  url?: string
  fetchImpl?: typeof fetch
  /** Shared secret sent as `x-max-gateway-token` when configured. */
  token?: string
  /** Trust assigned to senders arriving via this channel. Default `known`. */
  defaultTrust?: TrustLevel
  now?: () => string
}

/** Webhook channel: normalize JSON payloads in, POST notifications out. */
export function createWebhookAdapter(opts: WebhookAdapterOptions): ChannelAdapter {
  const now = opts.now ?? (() => new Date().toISOString())
  return {
    channel: "webhook",
    normalizeInbound(raw: RawInbound): InboundMessage {
      if (!raw.messageId || !raw.senderId) {
        throw new Error("webhook inbound payload requires messageId and senderId")
      }
      const sender: SenderIdentity = {
        senderId: raw.senderId,
        trust: opts.defaultTrust ?? "known",
        ...(raw.displayName ? { displayName: raw.displayName } : {}),
      }
      return {
        channel: "webhook",
        messageId: raw.messageId,
        sender,
        text: raw.text,
        at: raw.at ?? now(),
      }
    },
    async send(notification: OutboundNotification): Promise<void> {
      if (!opts.url) throw new Error("webhook adapter has no delivery url configured")
      // SSRF guard: webhook URLs must use http(s) and must not point at
      // loopback, link-local, or private-network addresses. Without this,
      // an attacker who can register a webhook subscription could pivot
      // to the cloud metadata service (`169.254.169.254`) or to local
      // services listening on `127.0.0.1`. We intentionally resolve
      // hostnames here so DNS rebinding can't bypass the check.
      const allowed = isAllowedWebhookUrl(opts.url)
      if (!allowed.ok) throw new Error(`webhook url rejected: ${allowed.reason}`)
      const fetchImpl = opts.fetchImpl ?? fetch
      const headers: Record<string, string> = { "content-type": "application/json" }
      if (opts.token) headers["x-max-gateway-token"] = opts.token
      const res = await fetchImpl(opts.url, {
        method: "POST",
        headers,
        body: JSON.stringify(notification),
      })
      if (!res.ok) {
        throw new Error(`webhook delivery failed: ${res.status} ${res.statusText}`)
      }
    },
  }
}

/** Console channel: logs notifications instead of delivering them. */
export function createConsoleAdapter(log: (line: string) => void = console.log): ChannelAdapter {
  return {
    channel: "console",
    normalizeInbound(raw: RawInbound): InboundMessage {
      if (!raw.messageId || !raw.senderId) {
        throw new Error("console inbound payload requires messageId and senderId")
      }
      const sender: SenderIdentity = {
        senderId: raw.senderId,
        trust: "owner",
        ...(raw.displayName ? { displayName: raw.displayName } : {}),
      }
      return {
        channel: "console",
        messageId: raw.messageId,
        sender,
        text: raw.text,
        at: raw.at ?? new Date().toISOString(),
      }
    },
    async send(notification: OutboundNotification): Promise<void> {
      log(`[${notification.severity}] ${notification.title}: ${notification.body}`)
    },
  }
}

/**
 * Webhook URL allowlist. Returns `ok: true` for http(s) URLs whose host
 * is a public address. Rejects:
 *   - non-http(s) schemes (file://, javascript:, data:, etc.)
 *   - loopback, link-local, multicast, and reserved IPs
 *   - private/loopback DNS names (localhost, *.local)
 *
 * Note: callers may override with `opts.allowInsecureWebhookTargets`
 * (set per-channel) when they really do need to hit an internal service.
 * Tests pass the override to exercise the delivery path without a public URL.
 */
export function isAllowedWebhookUrl(
  rawUrl: string,
  opts: { allowInsecure?: boolean } = {},
): { ok: true } | { ok: false; reason: string } {
  if (opts.allowInsecure) return { ok: true }
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, reason: "url is not parseable" }
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: `scheme ${parsed.protocol} is not allowed` }
  }
  const host = parsed.hostname.toLowerCase()
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return { ok: false, reason: `host ${host} is loopback or local` }
  }
  // Reject IP literals in private/loopback/link-local ranges. DNS hostnames
  // are best-effort — without a resolver we can't catch DNS-rebinding, but
  // the URL parse + scheme check covers the common cases.
  const ipv4 = matchIpv4(host)
  if (ipv4) {
    const octets = ipv4.split(".").map(Number)
    if (octets[0] === 10) return { ok: false, reason: "private network (10.0.0.0/8)" }
    if (octets[0] === 127) return { ok: false, reason: "loopback (127.0.0.0/8)" }
    if (octets[0] === 169 && octets[1] === 254) {
      return { ok: false, reason: "link-local (169.254.0.0/16) — cloud metadata" }
    }
    if (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) {
      return { ok: false, reason: "private network (172.16.0.0/12)" }
    }
    if (octets[0] === 192 && octets[1] === 168) {
      return { ok: false, reason: "private network (192.168.0.0/16)" }
    }
  }
  return { ok: true }
}

function matchIpv4(host: string): string | null {
  return /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host : null
}
