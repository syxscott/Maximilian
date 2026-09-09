// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ReplayEngine — M8 regression test.
 *
 * When zero historical executions match the proposal's subject / target,
 * the engine must NOT fabricate a baseline of 0 and report a fake
 * quality delta. It should short-circuit with `affectedExecutions: 0`
 * so callers can branch on zero-affected semantics without misleading
 * downstream decision logic.
 */

import { describe, it, expect } from "vitest";
import { ReplayEngine } from "../src/replay-engine.js";
import type { Execution, ReplayInput, Proposal } from "../src/types.js";

function makeProposal(): Proposal {
  return {
    id: "prop-1",
    kind: "agent-retirement",
    subject: "general/retire-candidate",
    target: "general/successor",
    rationale: "swap under-performing agent",
    utility: 0.5,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
}

describe("ReplayEngine — M8 zero-affected short-circuit", () => {
  it("returns affectedExecutions: 0 when no executions match the subject or target", async () => {
    const engine = new ReplayEngine({
      getExecutions: async () => [] as Execution[],
    });
    const input: ReplayInput = { proposal: makeProposal() };
    const out = await engine.replay(input);
    expect(out.affectedExecutions).toBe(0);
    expect(out.baselineQuality).toBe(0);
    expect(out.simulatedQuality).toBe(0);
    expect(out.qualityDelta).toBe(0);
  });

  it("does not invoke simulation when affected.length === 0", async () => {
    let simCalls = 0;
    const engine = new ReplayEngine({
      getExecutions: async () => [] as Execution[],
      simulation: {
        async simulateDelta() {
          simCalls++;
          return { qualityDelta: 0.5 };
        },
      },
      captureSimulation: async () => ({ before: {} as never, after: {} as never }),
    });
    await engine.replay({ proposal: makeProposal() });
    expect(simCalls).toBe(0);
  });

  it("computes baseline from matching executions when present", async () => {
    const execs: Execution[] = [
      {
        id: "e1",
        agentRole: "general/retire-candidate",
        blueprintId: "bp-1",
        review: { score: 0.8 },
        createdAt: new Date().toISOString(),
      },
      {
        id: "e2",
        agentRole: "general/successor",
        blueprintId: "bp-2",
        review: { score: 0.6 },
        createdAt: new Date().toISOString(),
      },
      // unrelated — must NOT be counted
      (() => {
        const e: Execution = {
          id: "e3",
          agentRole: "backend/other",
          blueprintId: "bp-3",
          review: { score: 0.0 },
          createdAt: new Date().toISOString(),
        };
        return e;
      })(),
    ];
    const engine = new ReplayEngine({ getExecutions: async () => execs });
    const out = await engine.replay({ proposal: makeProposal(), scoreDelta: 0.1 });
    expect(out.affectedExecutions).toBe(2);
    expect(out.baselineQuality).toBeCloseTo(0.7);
    expect(out.simulatedQuality).toBeCloseTo(0.8);
    expect(out.qualityDelta).toBeCloseTo(0.1);
  });
});