// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Capability tickets — one-time, short-TTL elevation credentials
 * (ZCode zcode-server borrowing: hostCapability.ts).
 *
 * Use case: an already-authenticated client needs to perform ONE sensitive
 * operation (e.g. promote a WebSocket from "web" role to a privileged
 * host role, or answer a permission prompt across tenants). Instead of
 * long-lived authority, mint a random ticket with a short TTL; the ticket
 * is consumed on first use (deleted — replay is impossible) and expires
 * automatically.
 */

import { randomBytes } from "node:crypto"

export interface CapabilityTicket {
  ticket: string
  scope: string
  createdAt: number
  expiresAt: number
}

export class CapabilityTicketStore {
  private readonly tickets = new Map<string, CapabilityTicket>()
  private readonly ttlMs: number
  private now: () => number

  constructor(opts: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = opts.ttlMs ?? 30_000
    this.now = opts.now ?? Date.now
  }

  /** Mint a ticket for a scope. Returns the random ticket string. */
  mint(scope: string): string {
    this.prune()
    const ticket = randomBytes(32).toString("hex")
    const now = this.now()
    this.tickets.set(ticket, { ticket, scope, createdAt: now, expiresAt: now + this.ttlMs })
    return ticket
  }

  /**
   * Consume a ticket: valid + unexpired tickets are DELETED on use
   * (single-use, replay-impossible). Returns the scope, or null.
   */
  consume(ticket: string): string | null {
    this.prune()
    const entry = this.tickets.get(ticket)
    if (!entry) return null
    this.tickets.delete(ticket)
    if (this.now() > entry.expiresAt) return null
    return entry.scope
  }

  private prune(): void {
    const now = this.now()
    for (const [ticket, entry] of this.tickets) {
      if (now > entry.expiresAt) this.tickets.delete(ticket)
    }
  }

  get size(): number {
    this.prune()
    return this.tickets.size
  }
}
