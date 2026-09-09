// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SafeRollout — Phase 7 rollback path tests.
 *
 * Pins the new contract:
 *   - apply() with mode !== shadow records a RolloutSnapshot
 *   - revert(id) invokes the inverse mutation supplied at apply-time
 *   - revert() is idempotent (second call is a no-op)
 *   - revert() without an inverse returns ok: false
 *   - shadow mode does NOT snapshot
 *   - bounded eviction kicks in after MAX_REVERT_HISTORY entries
 */

import { describe, it, expect } from "vitest";
import { SafeRollout } from "../src/safe-rollout.js";
import type { Proposal, RolloutApplyInput } from "../src/safe-rollout.js";

function createProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: overrides.id ?? "prop-1",
    kind: "agent-retirement",
    subject: "agent/old",
    target: "agent/new",
    rationale: "swap agent",
    utility: 0.5,
    createdAt: new Date().toISOString(),
    status: "pending",
    ...overrides,
  } as Proposal;
}

function buildInput(
  proposal: Proposal,
  opts: {
    applyFn?: () => Promise<void>;
    revertFn?: () => Promise<void>;
    recordFn?: (p: Proposal, m: string, applied: boolean) => Promise<void>;
  } = {},
): RolloutApplyInput {
  return {
    proposal,
    applyMutation: opts.applyFn ?? (async () => {}),
    ...(opts.revertFn ? { revertMutation: opts.revertFn } : {}),
    record: opts.recordFn ?? (async () => {}),
  };
}

describe("Phase 7 — SafeRollout rollback", () => {
  it("snapshots successful canary applies so a later revert can undo them", async () => {
    const r = new SafeRollout("canary");
    // Use a canaryKey that *will* pass the hash fraction so the apply
    // succeeds. We just iterate keys until one lands in-canary.
    let appliedProposalId: string | undefined;
    for (let i = 0; i < 50 && !appliedProposalId; i++) {
      const proposal = createProposal({ id: `canary-${i}`, subject: `a-${i}` });
      const res = await r.apply(buildInput(proposal));
      if (res.applied) appliedProposalId = proposal.id;
    }
    expect(appliedProposalId).toBeDefined();

    const snap = r.snapshot(appliedProposalId!);
    expect(snap).toBeDefined();
    expect(snap?.proposalId).toBe(appliedProposalId);
    expect(snap?.mode).toBe("canary");
  });

  it("revert(id) invokes the inverse mutation supplied at apply-time", async () => {
    const r = new SafeRollout("full");
    let applied = 0;
    let reverted = 0;
    const proposal = createProposal({ id: "p1" });
    await r.apply(
      buildInput(proposal, {
        applyFn: async () => {
          applied++;
        },
        revertFn: async () => {
          reverted++;
        },
      }),
    );
    expect(applied).toBe(1);
    expect(reverted).toBe(0);

    const out = await r.revert("p1");
    expect(out.ok).toBe(true);
    expect(out.proposalId).toBe("p1");
    expect(reverted).toBe(1);
    // Snapshot is gone after a successful revert.
    expect(r.snapshot("p1")).toBeUndefined();
  });

  it("revert(id) is idempotent — second call returns ok: false", async () => {
    const r = new SafeRollout("full");
    const proposal = createProposal({ id: "p-idem" });
    await r.apply(
      buildInput(proposal, {
        revertFn: async () => {},
      }),
    );
    const first = await r.revert("p-idem");
    expect(first.ok).toBe(true);
    const second = await r.revert("p-idem");
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/no snapshot/i);
  });

  it("revert(id) returns ok: false when no inverse was supplied at apply-time", async () => {
    const r = new SafeRollout("full");
    const proposal = createProposal({ id: "p-no-revert" });
    await r.apply(buildInput(proposal)); // no revertFn
    const out = await r.revert("p-no-revert");
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/no inverse/i);
    // Snapshot still exists — caller can wire up its own inverse path.
    expect(r.snapshot("p-no-revert")).toBeDefined();
  });

  it("revert(id) returns ok: false for unknown proposal ids", async () => {
    const r = new SafeRollout("full");
    const out = await r.revert("not-applied");
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/no snapshot/i);
  });

  it("revert(id) returns ok: false when the inverse mutation throws", async () => {
    const r = new SafeRollout("full");
    const proposal = createProposal({ id: "p-throws" });
    await r.apply(
      buildInput(proposal, {
        revertFn: async () => {
          throw new Error("crashed");
        },
      }),
    );
    const out = await r.revert("p-throws");
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/crashed/);
    // Snapshot is preserved so the caller can retry.
    expect(r.snapshot("p-throws")).toBeDefined();
  });

  it("shadow mode never records a snapshot (only canary/full do)", async () => {
    const r = new SafeRollout("shadow");
    const proposal = createProposal({ id: "p-shadow" });
    await r.apply(buildInput(proposal));
    expect(r.snapshot("p-shadow")).toBeUndefined();
    expect(r.revertHistorySize()).toBe(0);
  });

  it("bounded eviction drops oldest entries beyond MAX_REVERT_HISTORY", async () => {
    const r = new SafeRollout("full");
    // Push 100 + 5 = 105 applies. The first 5 should be evicted.
    for (let i = 0; i < 105; i++) {
      const proposal = createProposal({ id: `p-${i.toString().padStart(3, "0")}` });
      await r.apply(buildInput(proposal));
    }
    expect(r.revertHistorySize()).toBe(100);
    // The first 5 (p-000..p-004) should be evicted.
    expect(r.snapshot("p-000")).toBeUndefined();
    expect(r.snapshot("p-004")).toBeUndefined();
    // The latest (p-099 .. p-104) should still be there.
    expect(r.snapshot("p-099")).toBeDefined();
    expect(r.snapshot("p-104")).toBeDefined();
  });

  it("clearRevertHistory drops everything", async () => {
    const r = new SafeRollout("full");
    for (let i = 0; i < 5; i++) {
      const proposal = createProposal({ id: `c-${i}` });
      await r.apply(buildInput(proposal));
    }
    expect(r.revertHistorySize()).toBe(5);
    r.clearRevertHistory();
    expect(r.revertHistorySize()).toBe(0);
  });
});