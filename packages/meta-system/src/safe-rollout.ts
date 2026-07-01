/**
 * Phase 8.4 — Safe Rollout.
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

export class SafeRollout {
  private counter = 0;

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
    await input.record(input.proposal, mode, true);
    return {
      proposal: { ...input.proposal, status: "applied" },
      mode,
      applied: true,
      reason: "full rollout: applied",
    };
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