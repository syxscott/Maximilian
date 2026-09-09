/**
 * Phase 7.8 — Safe Rollout.
 *
 * Three rollout modes:
 *   - shadow:   simulate only; nothing is written to live state.
 *   - canary:   apply to a fraction of future requests.
 *   - full:     apply to all subsequent requests.
 *
 * Default is `shadow` (ROLLOUT_CONFIG.defaultMode).
 *
 * The orchestrator calls apply() to dispatch a proposal that has been
 * approved by the pipeline. Whether the call actually mutates state
 * depends on the chosen mode and the rollout's internal counters.
 *
 * Phase 7 rollback: every successful `apply()` stores an
 * {@link RolloutSnapshot} keyed by `proposal.id`. Callers can then call
 * `revert(id)` to receive the inverse mutation closure and a
 * `snapshot()` accessor for diagnostics. The inverse mutation is the
 * caller's responsibility to implement (since the SafeRollout doesn't
 * know the shape of every domain mutation) — but the wiring contract
 * is now stable: a proposal that was applied can be reverted.
 */

import {
  RolloutModeSchema,
  ROLLOUT_CONFIG,
  type RolloutMode,
  type Proposal,
} from "./types.js";

export interface RolloutApplyInput {
  proposal: Proposal;
  /** Mutation to apply when the rollout mode says "yes". */
  applyMutation: () => Promise<void>;
  /**
   * Optional inverse mutation. When provided AND the proposal is
   * actually applied, the SafeRollout stores a reference so a later
   * `revert(id)` can hand the inverse back to the caller. Callers that
   * have a true inverse (e.g. CRDT undo via `graph-undo` /
   * `digital-twin-undo`) should always pass this; callers that don't
   * (e.g. one-shot side effects) can omit it — `revert` will report
   * `reason: "no_inverse_provided"` and the caller can fall back to
   * their own rollback path.
   */
  revertMutation?: () => Promise<void>;
  /** Always recorded regardless of mode (audit). */
  record: (proposal: Proposal, mode: RolloutMode, applied: boolean) => Promise<void>;
  /** For canary: deterministic hash key to decide inclusion. */
  canaryKey?: string;
}

export interface RolloutResult {
  proposal: Proposal;
  mode: RolloutMode;
  applied: boolean;
  reason: string;
}

/**
 * Snapshot of a successfully-applied proposal. The SafeRollout keeps one
 * of these in memory per applied proposal; size is bounded by
 * {@link MAX_REVERT_HISTORY}.
 */
export interface RolloutSnapshot {
  proposalId: string
  mode: RolloutMode
  /** ISO timestamp of the apply. */
  appliedAt: string
  /** Optional inverse mutation, if the caller supplied one. */
  revertMutation?: () => Promise<void>
}

export interface RolloutRevertResult {
  /** Whether the revert succeeded. False when no snapshot exists or revertMutation was missing. */
  ok: boolean
  proposalId: string
  reason: string
}

/** Cap on the in-memory revert history. Newest proposals evict oldest. */
export const MAX_REVERT_HISTORY = 100

export class SafeRollout {
  private counter = 0;
  /**
   * Insertion-ordered map of proposal id → snapshot. We keep insertion
   * order so a bounded eviction can drop the oldest entries first.
   */
  private readonly snapshots = new Map<string, RolloutSnapshot>();

  constructor(private mode: RolloutMode = ROLLOUT_CONFIG.defaultMode) {}

  setMode(mode: RolloutMode): void {
    RolloutModeSchema.parse(mode);
    this.mode = mode;
  }

  getMode(): RolloutMode {
    return this.mode;
  }

  /**
   * Apply a proposal under the current rollout mode.
   *
   * shadow:  NEVER apply mutation; record only.
   * canary:  apply only when canaryKey.hash % 1 < canaryFraction.
   * full:    always apply.
   *
   * On a successful apply (canary-passes or full), the proposal is
   * snapshotted so a later `revert(id)` can recover the inverse.
   */
  async apply(input: RolloutApplyInput): Promise<RolloutResult> {
    this.counter++;
    const mode = this.mode;

    if (mode === "shadow") {
      await input.record(input.proposal, mode, false);
      return {
        proposal: { ...input.proposal, status: "rolling_out" },
        mode,
        applied: false,
        reason: "shadow mode: simulation only, no live mutation",
      };
    }

    if (mode === "canary") {
      const key = input.canaryKey ?? input.proposal.id;
      const fraction = hashFraction(key);
      const inCanary = fraction < ROLLOUT_CONFIG.canaryFraction;
      if (!inCanary) {
        await input.record(input.proposal, mode, false);
        return {
          proposal: { ...input.proposal, status: "rolling_out" },
          mode,
          applied: false,
          reason: `canary: key=${key} hash=${fraction.toFixed(3)} ≥ ${ROLLOUT_CONFIG.canaryFraction}, skipped`,
        };
      }
      await input.applyMutation();
      this.recordSnapshot(input, mode);
      await input.record(input.proposal, mode, true);
      return {
        proposal: { ...input.proposal, status: "applied" },
        mode,
        applied: true,
        reason: `canary: key=${key} hash=${fraction.toFixed(3)} < ${ROLLOUT_CONFIG.canaryFraction}, applied`,
      };
    }

    // full
    await input.applyMutation();
    this.recordSnapshot(input, mode);
    await input.record(input.proposal, mode, true);
    return {
      proposal: { ...input.proposal, status: "applied" },
      mode,
      applied: true,
      reason: "full rollout: applied",
    };
  }

  /**
   * Revert a previously-applied proposal by invoking the inverse mutation
   * the caller supplied at apply-time. Returns `ok: false` when no
   * snapshot exists or the caller never provided an inverse mutation.
   *
   * After a successful revert, the snapshot is removed from the in-memory
   * history so a second `revert(id)` is a no-op (idempotent rollback).
   */
  async revert(proposalId: string): Promise<RolloutRevertResult> {
    const snap = this.snapshots.get(proposalId);
    if (!snap) {
      return {
        ok: false,
        proposalId,
        reason: `no snapshot for proposalId=${proposalId} (was it applied?)`,
      };
    }
    if (!snap.revertMutation) {
      return {
        ok: false,
        proposalId,
        reason: `snapshot exists but no inverse mutation was supplied at apply-time`,
      };
    }
    try {
      await snap.revertMutation();
      this.snapshots.delete(proposalId);
      return {
        ok: true,
        proposalId,
        reason: `reverted (mode=${snap.mode}, appliedAt=${snap.appliedAt})`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        proposalId,
        reason: `inverse mutation threw: ${message}`,
      };
    }
  }

  /**
   * Read-only snapshot accessor — useful for diagnostics / dashboard /
   * tests. Returns the snapshot for `proposalId` or `undefined`.
   */
  snapshot(proposalId: string): RolloutSnapshot | undefined {
    return this.snapshots.get(proposalId);
  }

  /** Number of proposals currently in the revert history. */
  revertHistorySize(): number {
    return this.snapshots.size;
  }

  /** Drop all snapshots (e.g. on engine restart). */
  clearRevertHistory(): void {
    this.snapshots.clear();
  }

  private recordSnapshot(input: RolloutApplyInput, mode: RolloutMode): void {
    // Bounded eviction: if we're at capacity, drop the oldest entry
    // (Map preserves insertion order, so the first key is the oldest).
    if (this.snapshots.size >= MAX_REVERT_HISTORY) {
      const oldest = this.snapshots.keys().next().value;
      if (oldest !== undefined) this.snapshots.delete(oldest);
    }
    const snap: RolloutSnapshot = {
      proposalId: input.proposal.id,
      mode,
      appliedAt: new Date().toISOString(),
      ...(input.revertMutation ? { revertMutation: input.revertMutation } : {}),
    };
    this.snapshots.set(input.proposal.id, snap);
  }
}

/** Deterministic 0..1 hash for canary key selection. */
function hashFraction(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h % 10000) / 10000;
}