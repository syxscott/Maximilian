// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Workflow-candidate static scan tests (borrowing MiniMax-Code-MiniApps
 * docs/package-contract.md ACCESS_UNDECLARED + workflow-engine step-gate
 * rules): declared vs referenced tools must agree, and undeclared side
 * effects never reach the chain — the static twin of the runtime gate.
 */

import { describe, it, expect } from "vitest"
import { lintWorkflowCandidate, workflowLintBlocksShipment } from "../src/artifact-lint.js"

describe("lintWorkflowCandidate", () => {
  it("rejects a candidate whose step body references an undeclared tool", () => {
    const violations = lintWorkflowCandidate({
      steps: [
        {
          siteId: "step-1",
          tool: "declared_tool",
          body: "first call read_file on the config, then grep_code for the handler",
        },
      ],
      declaredTools: ["declared_tool"],
      knownTools: ["declared_tool", "read_file", "grep_code"],
      toolHasSideEffects: { declared_tool: false, read_file: false, grep_code: false },
    })
    const undeclared = violations.filter((v) => v.code === "undeclared-tool")
    expect(undeclared).toHaveLength(2)
    expect(undeclared.map((v) => v.severity)).toEqual(["error", "error"])
    expect(undeclared[0]!.detail).toContain("read_file")
    // The gate refuses: error severity blocks shipment.
    expect(workflowLintBlocksShipment(violations)).toBe(true)
  })

  it("warns (but does not block) on a declared tool no step references", () => {
    const violations = lintWorkflowCandidate({
      steps: [{ siteId: "step-1", tool: "used_tool", body: "" }],
      declaredTools: ["used_tool", "ghost_tool"],
      toolHasSideEffects: { used_tool: false, ghost_tool: false },
    })
    const unused = violations.filter((v) => v.code === "unused-declaration")
    expect(unused).toHaveLength(1)
    expect(unused[0]!.severity).toBe("warning")
    expect(unused[0]!.detail).toContain("ghost_tool")
    expect(workflowLintBlocksShipment(violations)).toBe(false)
  })

  it("refuses tools whose hasSideEffects is not declared (static twin of step-gate)", () => {
    const violations = lintWorkflowCandidate({
      steps: [{ siteId: "step-1", tool: "mystery_tool", body: "" }],
      declaredTools: ["mystery_tool"],
      // registry view missing the flag entirely
      toolHasSideEffects: {},
    })
    expect(violations.map((v) => v.code)).toContain("side-effects-undeclared")
    expect(workflowLintBlocksShipment(violations)).toBe(true)
  })

  it("refuses side-effecting tools outside the host whitelist", () => {
    const violations = lintWorkflowCandidate({
      steps: [{ siteId: "step-1", tool: "deploy_tool", body: "" }],
      declaredTools: ["deploy_tool"],
      toolHasSideEffects: { deploy_tool: true },
      sideEffectingTools: ["other_tool"],
    })
    expect(violations.map((v) => v.code)).toContain("side-effects-not-whitelisted")
    expect(workflowLintBlocksShipment(violations)).toBe(true)
  })

  it("a clean candidate produces no violations", () => {
    const violations = lintWorkflowCandidate({
      steps: [
        { siteId: "step-1", tool: "read_file", body: "read the file" },
        { siteId: "step-2", tool: "grep_code", body: "grep for the handler" },
      ],
      declaredTools: ["read_file", "grep_code"],
      toolHasSideEffects: { read_file: false, grep_code: false },
    })
    expect(violations).toEqual([])
    expect(workflowLintBlocksShipment(violations)).toBe(false)
  })

  it("body scans match whole words only (no substring false positives)", () => {
    const violations = lintWorkflowCandidate({
      steps: [{ siteId: "step-1", tool: "runner", body: "the runner takes over" }],
      declaredTools: ["runner"],
      knownTools: ["run", "runner"],
      toolHasSideEffects: { run: false, runner: false },
    })
    // "run" appears only as a substring of "runner" → no false reference,
    // and no unused-declaration warning for it either (it was never declared).
    expect(violations).toEqual([])
  })
})
