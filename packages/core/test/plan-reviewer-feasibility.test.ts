// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Feasibility-scorer cycle detection tests (Kahn's algorithm over dependsOn).
 *
 * Regression guard: the id→index table must stay aligned with task indexes.
 * A previous implementation compacted the id array with .filter(), which
 * shifted every index after an id-less task and produced both false cycles
 * and missed cycles (cases 1 and 2 below).
 */
import { describe, it, expect } from "vitest"
import { reviewPlan, type PlanLike } from "../src/validation/plan-reviewer.js"

type DepTask = {
  id?: string
  agentRole?: string
  type?: string
  description?: string
  dependsOn?: string[]
}

function feasibility(tasks: DepTask[]): number {
  // id/dependsOn are read by the scorer via internal casts; PlanLike
  // deliberately doesn't declare them.
  const plan = {
    objective: "feasibility cycle-detection probe plan",
    tasks,
  } as unknown as PlanLike
  return reviewPlan(plan).scores.feasibility
}

// ≤12 tasks score 8 when acyclic, capped at 5 when a cycle is detected.
const ACYCLIC = 8
const CYCLIC = 5

describe("plan-reviewer feasibility cycle detection", () => {
  it("ignores a self-loop", () => {
    expect(feasibility([{ id: "a", dependsOn: ["a"] }])).toBe(ACYCLIC)
  })

  it("ignores unknown deps instead of flagging a cycle", () => {
    expect(feasibility([{ dependsOn: ["does-not-exist"] }])).toBe(ACYCLIC)
  })

  it("detects an index-referenced 2-cycle", () => {
    expect(feasibility([{ dependsOn: ["1"] }, { dependsOn: ["0"] }])).toBe(CYCLIC)
  })

  it("stays acyclic for index deps without a cycle", () => {
    expect(feasibility([{ dependsOn: ["1"] }, {}])).toBe(ACYCLIC)
  })

  it("does not report a false cycle when id-less tasks precede id'd ones", () => {
    // Pre-fix: "b" compacted to index 0, so task 1 depended on itself
    // transitively and the scorer reported a phantom cycle.
    expect(feasibility([{ id: "a", dependsOn: ["b"] }, { dependsOn: ["a"] }, { id: "b" }])).toBe(
      ACYCLIC,
    )
  })

  it("detects a real cycle among tasks that follow id-less tasks", () => {
    // Pre-fix: the x↔y cycle resolved to compacted indexes and was swallowed.
    expect(feasibility([{}, { id: "x", dependsOn: ["y"] }, { id: "y", dependsOn: ["x"] }])).toBe(
      CYCLIC,
    )
  })

  it("resolves id references and role references to distinct tasks", () => {
    expect(
      feasibility([
        { id: "build", dependsOn: ["reviewer"] },
        { agentRole: "reviewer", dependsOn: ["build"] },
      ]),
    ).toBe(CYCLIC)
    expect(feasibility([{ id: "build" }, { agentRole: "reviewer", dependsOn: ["build"] }])).toBe(
      ACYCLIC,
    )
  })

  it("keeps duplicate deps self-consistent (no phantom cycle)", () => {
    expect(feasibility([{ dependsOn: ["1", "1"] }, {}])).toBe(ACYCLIC)
  })
})
