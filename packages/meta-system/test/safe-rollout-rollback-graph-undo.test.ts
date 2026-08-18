// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Phase 13 — graph-undo integration proof.
 *
 * `safe-rollout.ts` accepts any `() => Promise<void>` as the
 * `revertMutation` callback. This test demonstrates that
 * `GraphUndoStack` (from `graph-undo.ts`) is a viable source for
 * that callback — the "reverseDelta + apply" pair is wired through
 * the rollback path end-to-end.
 *
 * Before Phase 13, `graph-undo.ts` had tests but no production
 * caller. This test is the first time a SafeRollout.revert() actually
 * invokes a GraphUndoStack.undo() result.
 */

import { describe, it, expect } from "vitest";
import { SafeRollout } from "../src/safe-rollout.js";
import { GraphUndoStack } from "../src/graph-undo.js";
import type { GraphDelta } from "../src/graph-undo.js";
import type { Proposal, RolloutApplyInput } from "../src/safe-rollout.js";

function createProposal(id = "p-graph-1"): Proposal {
  return {
    id,
    kind: "agent-birth",
    subject: "node/new",
    target: "node/new",
    rationale: "add a node",
    utility: 0.5,
    createdAt: new Date().toISOString(),
    status: "pending",
  } as Proposal;
}

describe("SafeRollout + GraphUndoStack (Phase 13 integration)", () => {
  it("revert() invokes GraphUndoStack.undo() to recover the prior graph state", async () => {
    // 1. Build a graph CRDT undo stack.
    const stack = new GraphUndoStack({ maxSize: 50 });
    const initialNodes = new Set<string>();
    const applyDelta = (d: GraphDelta) => {
      // node:add: after is the new node payload
      // node:remove: before is the removed node payload (after is null
      //   because the node doesn't exist post-removal)
      if (d.op === "node:add") initialNodes.add(d.after.id);
      else if (d.op === "node:remove" && d.before) initialNodes.delete(d.before.id);
    };

    // 2. Simulate a successful proposal — apply a delta and capture
    //    the inverse for rollback.
    const delta: GraphDelta = {
      op: "node:add",
      after: { id: "node-A", payload: { type: "agent" } },
      before: null,
      at: 0,
    };
    stack.push(delta);

    // 3. Wire SafeRollout with the inverse as the revertMutation.
    const proposal = createProposal();
    const input: RolloutApplyInput = {
      proposal,
      mode: "full",
      applyMutation: async () => {
        applyDelta(delta);
      },
      revertMutation: async () => {
        const inverse = stack.undo();
        if (inverse) applyDelta(inverse);
      },
    };

    const rollout = new SafeRollout();
    rollout.setMode("full");  // default is "shadow" — flip to apply mutations
    const applied = await rollout.apply({ ...input, record: async () => {} });
    expect(applied.applied).toBe(true);
    expect(initialNodes.has("node-A")).toBe(true);
    // Confirm the snapshot was recorded so revert() has something to undo.
    const snap = rollout.snapshot(proposal.id);
    expect(snap).toBeDefined();
    expect(snap?.revertMutation).toBeDefined();

    // 4. Revert and confirm the inverse delta is applied.
    const result = await rollout.revert(proposal.id);
    expect(result.ok).toBe(true);
    expect(initialNodes.has("node-A")).toBe(false);

    // 5. Idempotent — second revert is a no-op.
    const second = await rollout.revert(proposal.id);
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/no snapshot/i);
  });
});