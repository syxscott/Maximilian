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

/**
 * Evidence attached to a held answer (oh-my-claudecode `77ba93621`
 * diff-first gate borrowing). All fields are OPTIONAL: an undeclared field
 * never loosens the gate — it only grades when the client explicitly
 * declared a value.
 */
export interface GateEvidence {
  /**
   * Primary-source declaration: the sign-off references the diff or the
   * changed-file list, not the agent's own summary. Explicitly `false`
   * means the answer's author admitted the diff was NOT attached.
   */
  readonly diffAttached?: boolean
}

/** The diff-first refusal message, shared by the gate and the release route. */
export const DIFF_FIRST_CRITERION =
  "diff not attached: the summary is a second-hand source (written by the party under review); sign-off must be based on the primary source (the diff or the changed-file list)"

export interface GateEntry {
  readonly requestId: string
  /** The held approving decision, applied verbatim on release. */
  readonly decision: "allow"
  readonly requestedAt: string
  /** Client address of the original (held) answer, when observable. */
  readonly remoteAddress?: string
  /** Evidence declared by the answer, when any was. */
  readonly evidence?: GateEvidence
  readonly status: "pending-gate" | "released"
}

export type GateSubmitVerdict = { action: "pass" } | { action: "hold"; entry: GateEntry }

export type GateReleaseResult =
  | { ok: true; entry: GateEntry }
  | { ok: false; reason: "unknown" | "already-released" | "remote-release-forbidden" }
  | { ok: false; reason: "diff-not-attached"; criterion: string }

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
 * Validate a client-supplied evidence object. Only well-typed fields are
 * kept; anything absent/mistyped counts as UNDECLARED (which never
 * tightens the gate). Returns undefined when nothing valid was declared.
 */
export function parseGateEvidence(value: unknown): GateEvidence | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const raw = value as { diffAttached?: unknown }
  if (typeof raw.diffAttached !== "boolean") return undefined
  return { diffAttached: raw.diffAttached }
}

/**
 * Pure diff-first grading for a release (oh-my-claudecode `77ba93621`
 * borrowing). Declared-missing evidence (`diffAttached: false`) refuses
 * BEFORE the structural human judgment would apply the held allow — the
 * summary is a second-hand source. Undeclared (`undefined`) or satisfied
 * (`true`) evidence never blocks: the optional tightening field can only
 * tighten, never loosen.
 */
export function gradeRelease(
  entry: Pick<GateEntry, "evidence">,
): { ok: true } | { ok: false; reason: "diff-not-attached"; criterion: string } {
  if (entry.evidence?.diffAttached === false) {
    return { ok: false, reason: "diff-not-attached", criterion: DIFF_FIRST_CRITERION }
  }
  return { ok: true }
}

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
   * and reported via `{ action: "hold" }`. `evidence` is stored with the
   * first decision — a repeat answer cannot mutate it.
   */
  submit(
    requestId: string,
    decision: GateDecision,
    remoteAddress?: string,
    evidence?: GateEvidence,
  ): GateSubmitVerdict {
    if (!this.enabled || decision === "deny" || isLoopbackAddress(remoteAddress)) {
      return { action: "pass" }
    }
    const existing = this.entries.get(requestId)
    if (existing !== undefined && existing.status === "pending-gate") {
      // Same prompt answered again while still gated: keep the FIRST
      // decision, origin and evidence — a repeat answer must not be able
      // to mutate what a release would apply.
      return { action: "hold", entry: existing }
    }
    this.heldCount += 1
    const entry: GateEntry = {
      requestId,
      decision,
      requestedAt: this.now(),
      ...(remoteAddress !== undefined ? { remoteAddress } : {}),
      ...(evidence !== undefined ? { evidence } : {}),
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
   *
   * Diff-first grading (oh-my-claudecode `77ba93621` borrowing): when the
   * held answer explicitly DECLARED `diffAttached: false`, the release is
   * refused BEFORE the structural step that would apply it — a sign-off
   * must rest on the primary source, not on the reviewed party's summary.
   * The entry stays pending-gate so a later release can succeed once real
   * evidence lands. Undeclared evidence never blocks (the optional field
   * tightens, never loosens).
   */
  release(requestId: string, remoteAddress?: string): GateReleaseResult {
    const entry = this.entries.get(requestId)
    if (this.enabled && !isLoopbackAddress(remoteAddress)) {
      return { ok: false, reason: "remote-release-forbidden" }
    }
    if (entry === undefined) return { ok: false, reason: "unknown" }
    if (entry.status !== "pending-gate") return { ok: false, reason: "already-released" }
    const grade = gradeRelease(entry)
    if (!grade.ok) return grade
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
