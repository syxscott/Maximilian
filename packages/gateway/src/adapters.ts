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
