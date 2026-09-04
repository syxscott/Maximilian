// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Gateway — the resident channel layer Maximilian never had (openclaw
 * borrowing): normalize inbound messages from chat channels, authorize the
 * sender, and push outbound notifications back out through channel
 * adapters.
 *
 * openclaw borrowings, in order of importance:
 *   - **Sender identity tiers** (`docs/gateway` ingress kernel): senders
 *     are classified `owner > trusted > known > unknown`; inbound commands
 *     from `unknown` senders are rejected fail-closed unless the channel
 *     allowlists them.
 *   - **Delivery dedupe**: replayed channel webhooks are ignored by
 *     messageId (bounded LRU per channel).
 *   - **Graceful drain** (`active-sessions-shutdown-drain`): `close()`
 *     waits for in-flight outbound deliveries up to a timeout instead of
 *     dropping notifications mid-send.
 */

// ── Inbound ─────────────────────────────────────────────────────────────────

export type TrustLevel = "owner" | "trusted" | "known" | "unknown"

export interface SenderIdentity {
  /** Channel-scoped sender id (user id / phone / email). */
  senderId: string
  /** Display name when the channel provides one. */
  displayName?: string
  trust: TrustLevel
}

export interface InboundMessage {
  /** Channel slug ("console", "webhook", "telegram", …). */
  channel: string
  /** Channel-native message id, used for dedupe. */
  messageId: string
  sender: SenderIdentity
  text: string
  at: string
}

/** Raw, channel-specific payload before normalization. */
export interface RawInbound {
  messageId: string
  senderId: string
  displayName?: string
  text: string
  at?: string
}

// ── Outbound ────────────────────────────────────────────────────────────────

export interface OutboundNotification {
  channel: string
  /** Target sender/conversation (where the work came from, or a subscriber). */
  recipientId: string
  title: string
  body: string
  /** Workspace that produced the notification, when applicable. */
  workspaceId?: string
  severity: "info" | "warn" | "error"
}

/**
 * A channel adapter owns one channel's transport. Inbound normalization is
 * pure; outbound delivery may be async and is tracked by the gateway's
 * drain.
 */
export interface ChannelAdapter {
  readonly channel: string
  /** Map a channel payload to the canonical shape. Throws on malformed payloads. */
  normalizeInbound(raw: RawInbound): InboundMessage
  /** Deliver a notification. Resolves when sent (or throws). */
  send(notification: OutboundNotification): Promise<void>
}

// ── Authorization ───────────────────────────────────────────────────────────

export interface ChannelPolicy {
  /**
   * Senders allowed to submit inbound commands. An empty allowlist means
   * "trust tiers `trusted` and above only" — `unknown` senders are always
   * rejected (openclaw fail-closed ingress).
   */
  allowlist?: string[]
  /** Minimum trust level for inbound commands. Default: `trusted`. */
  minTrust?: TrustLevel
}

const TRUST_ORDER: Record<TrustLevel, number> = {
  unknown: 0,
  known: 1,
  trusted: 2,
  owner: 3,
}
