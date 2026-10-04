// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Remote approval gate (oh-my-claudecode remote-approval borrowing).
 *
 * Permission prompts answered "allow" from a NON-loopback client are held
 * in a pending-gate registry instead of resolving the parked prompt. The
 * decision only reaches the runtime after a second, explicit release by a
 * loopback caller (`POST /api/permissions/gate/release`), which then
 * applies the held decision verbatim. A forged or compromised remote
 * client can therefore never enable anything on its own.
 *
 * Deny answers pass straight through: rejecting remotely can never enable
 * anything. With the gate disabled (REMOTE_APPROVAL_GATE=false) every
 * answer behaves exactly as before.
 *
 * The existing `permission-request` / `permission-resolved` event contract
 * is untouched — held answers resolve nothing, so nothing is emitted until
 * the gate releases (and then only via the normal runtime resolution path).
 */

import type { Context } from "hono"

/** Decisions the API answer route accepts (`AnswerRequestSchema`). */
export type GateDecision = "allow" | "deny"

export interface GateEntry {
  readonly requestId: string
  /** The held approving decision, applied verbatim on release. */
  readonly decision: "allow"
  readonly requestedAt: string
  /** Client address of the original (held) answer, when observable. */
  readonly remoteAddress?: string
  readonly status: "pending-gate" | "released"
}

export type GateSubmitVerdict = { action: "pass" } | { action: "hold"; entry: GateEntry }

export type GateReleaseResult =
  | { ok: true; entry: GateEntry }
  | { ok: false; reason: "unknown" | "already-released" | "remote-release-forbidden" }

export interface GateSnapshot {
  readonly enabled: boolean
  readonly pending: number
  /** Total answers ever held by the gate. */
  readonly held: number
  readonly released: number
  /** Pending entries dropped because the registry overflowed. */
  readonly expired: number
}

/** Pending registrations kept before the oldest is dropped (fail-closed:
 *  a dropped entry can no longer be released; the runtime prompt itself
 *  still times out deny). */
const MAX_PENDING = 1_000

/**
 * True when the address is the local machine. Unobservable addresses
 * (unix-socket peers, internal dispatch) count as local — the gate exists
 * to guard the network boundary, not in-process callers.
 */
export function isLoopbackAddress(addr: string | undefined): boolean {
  if (addr === undefined || addr === "") return true
  const normalized = addr.trim().toLowerCase()
  if (normalized === "::1" || normalized === "localhost") return true
  // IPv6-mapped IPv4 (::ffff:127.0.0.1) and plain IPv4 loopback /8.
  const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : normalized
  if (ipv4 === "127.0.0.1") return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ipv4)
}

/**
 * Peer address of the current request, read from the @hono/node-server
 * env (same shape the rate limiter in index.ts uses). Returns undefined
 * when there is no socket (tests, non-node adapters).
 */
export function requestRemoteAddress(c: Context): string | undefined {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: unknown } } } | undefined
  const addr = env?.incoming?.socket?.remoteAddress
  return typeof addr === "string" ? addr : undefined
}

export interface RemoteApprovalGateOptions {
  enabled: boolean
  now?: () => string
}

export class RemoteApprovalGate {
  readonly enabled: boolean
  private readonly now: () => string
  private readonly entries = new Map<string, GateEntry>()
  private heldCount = 0
  private releasedCount = 0
  private expiredCount = 0

  constructor(opts: RemoteApprovalGateOptions) {
    this.enabled = opts.enabled
    this.now = opts.now ?? (() => new Date().toISOString())
  }

  /**
   * Vet one answer to a permission prompt. Approving decisions from
   * non-loopback clients are held (the caller must NOT resolve the prompt)
   * and reported via `{ action: "hold" }`.
   */
  submit(requestId: string, decision: GateDecision, remoteAddress?: string): GateSubmitVerdict {
    if (!this.enabled || decision === "deny" || isLoopbackAddress(remoteAddress)) {
      return { action: "pass" }
    }
    const existing = this.entries.get(requestId)
    if (existing !== undefined && existing.status === "pending-gate") {
      // Same prompt answered again while still gated: keep the FIRST
      // decision and the FIRST origin — a repeat answer must not be able
      // to mutate what a release would apply.
      return { action: "hold", entry: existing }
    }
    this.heldCount += 1
    const entry: GateEntry = {
      requestId,
      decision,
      requestedAt: this.now(),
      ...(remoteAddress !== undefined ? { remoteAddress } : {}),
      status: "pending-gate",
    }
    this.entries.set(requestId, entry)
    this.evictOverflow()
    return { action: "hold", entry }
  }

  /**
   * Explicitly release a held decision. Only loopback callers may release;
   * the returned entry's decision is applied by the caller through the
   * normal runtime resolution path.
   */
  release(requestId: string, remoteAddress?: string): GateReleaseResult {
    const entry = this.entries.get(requestId)
    if (this.enabled && !isLoopbackAddress(remoteAddress)) {
      return { ok: false, reason: "remote-release-forbidden" }
    }
    if (entry === undefined) return { ok: false, reason: "unknown" }
    if (entry.status !== "pending-gate") return { ok: false, reason: "already-released" }
    const released: GateEntry = { ...entry, status: "released" }
    this.entries.set(requestId, released)
    this.releasedCount += 1
    return { ok: true, entry: released }
  }

  /** Unresolved held answers, oldest first. */
  listPending(): GateEntry[] {
    return [...this.entries.values()]
      .filter((e) => e.status === "pending-gate")
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
  }

  snapshot(): GateSnapshot {
    const pending = this.listPending().length
    return {
      enabled: this.enabled,
      pending,
      held: this.heldCount,
      released: this.releasedCount,
      expired: this.expiredCount,
    }
  }

  /** Drop the oldest pending entries when the registry exceeds its bound. */
  private evictOverflow(): void {
    const pending = this.listPending()
    for (let i = 0; i < pending.length - MAX_PENDING; i++) {
      const oldest = pending[i]
      if (oldest === undefined) break
      this.entries.delete(oldest.requestId)
      this.expiredCount += 1
    }
  }
}
