// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * PermissionService — session-scoped tool-approval coordinator.
 *
 * Borrowed from two sources:
 *   - **opencode** `packages/opencode/src/permission/index.ts`: answering
 *     "always" stores a pattern rule and then *retroactively approves*
 *     every matching pending request already parked in this session.
 *     Deliberate deviation from upstream: rejecting one request here
 *     batch-rejects only pending requests that match the same pattern,
 *     whereas upstream rejects ALL pending in the session regardless of
 *     pattern. In a DAG runtime a whole wave of agents can ask for the
 *     same thing at once; one answer should unblock them all instead of
 *     N rounds of prompts — but unrelated pending asks are left for
 *     their own human decision.
 *   - **deepseek-harness** `docs/subsystems/approval.md`: fail-closed
 *     answers only — the decision set is exactly
 *     `allowed-once | always | rejected | cancelled | unavailable`.
 *     An unknown requestId, a missing answerer, or an answering error all
 *     resolve to `unavailable` and approve nothing. Every decision is
 *     appended to an audit event list; `replay()` rebuilds the rule state
 *     from events alone, so the log *is* the policy.
 */

import { matchPattern, type ToolName } from "./permission.js"

// ── Decisions ────────────────────────────────────────────────────────────────

export type AlwaysDecision = "allowed-once" | "always" | "rejected" | "cancelled"

/** Fail-closed resolution set (deepseek-harness approval.md). */
export type ApprovalResolution =
  | { outcome: "allowed"; via: "once" | "always-rule" }
  | { outcome: "rejected" }
  | { outcome: "cancelled" }
  | { outcome: "unavailable"; reason: string }

// ── Audit events (the log is the policy) ────────────────────────────────────

export type ApprovalEvent =
  | { type: "requested"; requestId: string; tool: ToolName; target: string; at: string }
  | { type: "auto-approved"; requestId: string; pattern: string; at: string }
  | { type: "answered"; requestId: string; decision: AlwaysDecision; pattern?: string; at: string }
  | { type: "retro-approved"; requestIds: string[]; pattern: string; at: string }
  | { type: "retro-rejected"; requestIds: string[]; pattern: string; at: string }
  | { type: "unavailable"; requestId: string; reason: string; at: string }

export interface PendingRequest {
  requestId: string
  tool: ToolName
  target: string
  askedAt: string
}

export interface PermissionRequestInput {
  tool: ToolName
  target: string
  /** Optional explicit pattern for "always" (defaults to the exact target). */
  pattern?: string
  /** Resolve to `unavailable` after this long without an answer. */
  timeoutMs?: number
}

export interface PermissionServiceOptions {
  /** Audit sink (e.g. append to the session/event log). May be async; errors are swallowed. */
  onEvent?: (event: ApprovalEvent) => void | Promise<void>
  now?: () => string
  nextId?: () => string
}

interface PendingEntry extends PendingRequest {
  pattern?: string
  resolve: (r: ApprovalResolution) => void
  timer?: ReturnType<typeof setTimeout>
}

export class PermissionService {
  private readonly pending = new Map<string, PendingEntry>()
  private readonly alwaysPatterns: Array<{ pattern: string; addedAt: string }> = []
  private readonly audit: ApprovalEvent[] = []
  private readonly opts: PermissionServiceOptions

  constructor(opts: PermissionServiceOptions = {}) {
    this.opts = opts
  }

  // ── Asking ──────────────────────────────────────────────────────────────

  /**
   * Register a permission request. Returns a promise that settles when the
   * request is answered (or auto-approved by an "always" rule, or timed
   * out → `unavailable`). Never throws.
   */
  request(input: PermissionRequestInput): Promise<ApprovalResolution> {
    // 1. An existing "always" rule matching this target approves instantly.
    const rule = this.matchingAlwaysRule(input.tool, input.target)
    if (rule) {
      const requestId = this.nextId()
      const event: ApprovalEvent = {
        type: "auto-approved",
        requestId,
        pattern: rule.pattern,
        at: this.now(),
      }
      this.record(event)
      return Promise.resolve({ outcome: "allowed", via: "always-rule" })
    }

    // 2. Park the request until an answer (or timeout → fail closed).
    const requestId = this.nextId()
    const entry: PendingEntry = {
      requestId,
      tool: input.tool,
      target: input.target,
      pattern: input.pattern,
      askedAt: this.now(),
      resolve: () => {},
    }
    const promise = new Promise<ApprovalResolution>((resolve) => {
      entry.resolve = resolve
    })
    this.pending.set(requestId, entry)
    this.record({
      type: "requested",
      requestId,
      tool: input.tool,
      target: input.target,
      at: this.now(),
    })

    if (input.timeoutMs !== undefined) {
      entry.timer = setTimeout(() => {
        if (!this.pending.has(requestId)) return
        this.pending.delete(requestId)
        entry.resolve({
          outcome: "unavailable",
          reason: `no answer within ${input.timeoutMs}ms`,
        })
        this.record({
          type: "unavailable",
          requestId,
          reason: "timeout",
          at: this.now(),
        })
      }, input.timeoutMs)
      entry.timer.unref?.()
    }

    return promise
  }

  /**
   * Answer a pending request.
   *
   *   - `always`        → store the pattern, approve this request, and
   *                       retro-approve all pending requests matching it.
   *   - `rejected`      → reject this request and batch-reject every
   *                       pending request matching the same pattern.
   *   - `allowed-once`  → approve only this request.
   *   - `cancelled`     → resolve only this request as cancelled.
   *
   * Unknown/expired requestIds resolve to `unavailable` (fail closed) and
   * change no state beyond the audit event.
   */
  async answer(
    requestId: string,
    decision: AlwaysDecision,
    opts: { pattern?: string; reason?: string } = {},
  ): Promise<ApprovalResolution> {
    const entry = this.pending.get(requestId)
    if (!entry) {
      const reason = `unknown or already-settled request ${requestId}`
      this.record({ type: "unavailable", requestId, reason, at: this.now() })
      return { outcome: "unavailable", reason }
    }
    this.pending.delete(requestId)
    if (entry.timer) clearTimeout(entry.timer)

    const pattern = opts.pattern ?? entry.pattern ?? entry.target

    switch (decision) {
      case "allowed-once": {
        this.record({ type: "answered", requestId, decision, at: this.now() })
        entry.resolve({ outcome: "allowed", via: "once" })
        return { outcome: "allowed", via: "once" }
      }
      case "cancelled": {
        this.record({ type: "answered", requestId, decision, at: this.now() })
        entry.resolve({ outcome: "cancelled" })
        return { outcome: "cancelled" }
      }
      case "always": {
        this.alwaysPatterns.push({ pattern, addedAt: this.now() })
        this.record({ type: "answered", requestId, decision, pattern, at: this.now() })
        entry.resolve({ outcome: "allowed", via: "always-rule" })
        // Retro-approval sweep: one "always" unblocks the whole wave.
        const retro = this.takeMatchingPending(pattern)
        if (retro.length > 0) {
          this.record({
            type: "retro-approved",
            requestIds: retro.map((r) => r.requestId),
            pattern,
            at: this.now(),
          })
          for (const r of retro) r.resolve({ outcome: "allowed", via: "always-rule" })
        }
        return { outcome: "allowed", via: "always-rule" }
      }
      case "rejected": {
        this.record({ type: "answered", requestId, decision, pattern, at: this.now() })
        entry.resolve({ outcome: "rejected" })
        // Batch-reject: one "no" answers the whole matching wave, so the
        // user doesn't click "reject" N times.
        const retro = this.takeMatchingPending(pattern)
        if (retro.length > 0) {
          this.record({
            type: "retro-rejected",
            requestIds: retro.map((r) => r.requestId),
            pattern,
            at: this.now(),
          })
          for (const r of retro) r.resolve({ outcome: "rejected" })
        }
        return { outcome: "rejected" }
      }
    }
  }

  /** Current pending requests (for dashboards / SSE snapshots). */
  listPending(): PendingRequest[] {
    return [...this.pending.values()].map(({ requestId, tool, target, askedAt }) => ({
      requestId,
      tool,
      target,
      askedAt,
    }))
  }

  /** Always-rules currently in force. */
  listAlwaysPatterns(): Array<{ pattern: string; addedAt: string }> {
    return [...this.alwaysPatterns]
  }

  /** Full audit trail for this session. */
  events(): ApprovalEvent[] {
    return [...this.audit]
  }

  /**
   * Rebuild service state from a previously persisted event log (dsh:
   * "policy as events — replay rebuilds"). Always-rules are restored in
   * order; pending-request promises are inherently unrecoverable across
   * processes and are skipped.
   */
  static replay(events: ApprovalEvent[], opts: PermissionServiceOptions = {}): PermissionService {
    const svc = new PermissionService(opts)
    for (const e of events) {
      svc.audit.push(e)
      if (e.type === "answered" && e.decision === "always" && e.pattern) {
        svc.alwaysPatterns.push({ pattern: e.pattern, addedAt: e.at })
      }
    }
    return svc
  }

  // ── internals ───────────────────────────────────────────────────────────

  private matchingAlwaysRule(_tool: ToolName, target: string) {
    return this.alwaysPatterns.find((r) => matchPattern(r.pattern, target))
  }

  private takeMatchingPending(pattern: string): PendingEntry[] {
    const taken: PendingEntry[] = []
    for (const entry of this.pending.values()) {
      if (matchPattern(pattern, entry.target)) {
        taken.push(entry)
        if (entry.timer) clearTimeout(entry.timer)
        this.pending.delete(entry.requestId)
      }
    }
    return taken
  }

  private record(event: ApprovalEvent): void {
    this.audit.push(event)
    const cb = this.opts.onEvent
    if (!cb) return
    // Sink failures (sync throws AND async rejections) must never break the
    // approval flow — a rejected async sink would otherwise surface as an
    // unhandled rejection and take the process down.
    void Promise.resolve()
      .then(() => cb(event))
      .catch(() => {})
  }

  private now(): string {
    return (this.opts.now ?? (() => new Date().toISOString()))()
  }

  private nextId(): string {
    if (this.opts.nextId) return this.opts.nextId()
    return `apr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  }
}
