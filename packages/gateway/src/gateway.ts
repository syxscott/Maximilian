// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Gateway — resident channel layer (openclaw borrowing). See types.ts for
 * the model: inbound normalization → sender authorization → handler;
 * outbound notifications dispatch through adapters with drain tracking.
 */

import type {
  ChannelAdapter,
  ChannelPolicy,
  InboundMessage,
  OutboundNotification,
  TrustLevel,
} from "./types.js"

const TRUST_ORDER: Record<TrustLevel, number> = {
  unknown: 0,
  known: 1,
  trusted: 2,
  owner: 3,
}

export interface GatewayOptions {
  /** Per-channel policies. Unlisted channels use the default policy. */
  policies?: Record<string, ChannelPolicy>
  defaultPolicy?: ChannelPolicy
  /** Dedupe window size per channel. Default 1024 message ids. */
  dedupeCapacity?: number
  /** `close()` gives in-flight deliveries this long before giving up. Default 10s. */
  drainTimeoutMs?: number
  /** Owner sender ids (per channel) — always allowed, max trust. */
  owners?: Record<string, string[]>
  now?: () => string
}

export type InboundResult =
  | { ok: true; message: InboundMessage }
  | { ok: false; reason: "duplicate" | "unauthorized" | "malformed"; detail?: string }

export class Gateway {
  private readonly adapters = new Map<string, ChannelAdapter>()
  private readonly seen = new Map<string, Set<string>>()
  private readonly inFlight = new Set<Promise<void>>()
  private closed = false

  constructor(private readonly opts: GatewayOptions = {}) {}

  registerAdapter(adapter: ChannelAdapter): this {
    this.adapters.set(adapter.channel, adapter)
    return this
  }

  hasAdapter(channel: string): boolean {
    return this.adapters.has(channel)
  }

  /**
   * Normalize, dedupe and authorize an inbound payload. Rejects with
   * `unauthorized` when the sender's trust is below the channel policy —
   * `unknown` senders never pass unless explicitly allowlisted (openclaw
   * fail-closed ingress).
   */
  acceptInbound(channel: string, raw: import("./types.js").RawInbound): InboundResult {
    const adapter = this.adapters.get(channel)
    if (!adapter) {
      return { ok: false, reason: "malformed", detail: `no adapter for channel ${channel}` }
    }
    // Dedupe before normalization work — replays are cheap to drop.
    const seenSet = this.seen.get(channel) ?? new Set<string>()
    if (seenSet.has(raw.messageId)) {
      return { ok: false, reason: "duplicate" }
    }
    this.seen.set(channel, seenSet)

    let message: InboundMessage
    try {
      message = adapter.normalizeInbound(raw)
    } catch (err) {
      return { ok: false, reason: "malformed", detail: (err as Error).message }
    }

    seenSet.add(raw.messageId)
    // Bound the dedupe set (LRU-ish: delete oldest insertion).
    const capacity = this.opts.dedupeCapacity ?? 1024
    if (seenSet.size > capacity) {
      const oldest = seenSet.values().next().value
      if (oldest !== undefined) seenSet.delete(oldest)
    }

    if (!this.isAuthorized(channel, message)) {
      return { ok: false, reason: "unauthorized" }
    }
    return { ok: true, message }
  }

  /**
   * Queue an outbound notification through the channel adapter. Returns
   * false (without throwing) when the gateway is closed or the channel is
   * unknown. Delivery is tracked so `close()` can drain.
   */
  notify(notification: OutboundNotification): boolean {
    if (this.closed) return false
    const adapter = this.adapters.get(notification.channel)
    if (!adapter) return false
    const delivery = adapter
      .send(notification)
      .then(() => {})
      .catch(() => {
        // Delivery failures are the adapter's problem to log; the gateway
        // must not crash on one bad endpoint.
      })
      .finally(() => {
        this.inFlight.delete(delivery)
      })
    this.inFlight.add(delivery)
    return true
  }

  /**
   * Stop accepting notifications and wait for in-flight deliveries
   * (openclaw shutdown-drain borrowing). Resolves when drained or when the
   * drain timeout elapses, whichever comes first.
   */
  async close(): Promise<void> {
    this.closed = true
    const timeoutMs = this.opts.drainTimeoutMs ?? 10_000
    if (this.inFlight.size === 0) return
    await Promise.race([
      Promise.all([...this.inFlight]),
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, timeoutMs)
        t.unref?.()
      }),
    ])
  }

  get pendingDeliveries(): number {
    return this.inFlight.size
  }

  // ── internals ───────────────────────────────────────────────────────────

  private isAuthorized(channel: string, message: InboundMessage): boolean {
    const owners = this.opts.owners?.[channel] ?? []
    const effectiveTrust: TrustLevel = owners.includes(message.sender.senderId)
      ? "owner"
      : message.sender.trust

    const policy = this.opts.policies?.[channel] ?? this.opts.defaultPolicy ?? {}
    const allowlist = policy.allowlist ?? []
    if (allowlist.length > 0 && allowlist.includes(message.sender.senderId)) return true

    const minTrust = policy.minTrust ?? "trusted"
    return TRUST_ORDER[effectiveTrust] >= TRUST_ORDER[minTrust]
  }
}
