// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ToolCalls-Trigger F1 on the evolution side (flip-matrix companion;
 * borrowing MiniMax-Provider-Verifier calculate_toolcall_similarity.py).
 */

import { describe, it, expect } from "vitest"
import { classifyFinishReason, computeTriggerF1 } from "../src/flip-matrix.js"

describe("computeTriggerF1 (flip-matrix)", () => {
  it("scores aligned finish-reason arrays with error classification", () => {
    const f1 = computeTriggerF1(
      ["tool_calls", "tool_calls", "stop", "stop", "tool_calls"],
      ["tool_calls", "stop", "tool_calls", "stop", "error_no_response"],
    )
    expect(f1.tp).toBe(1)
    expect(f1.fn).toBe(2) // stop + error_no_response against a tool_calls baseline
    expect(f1.fp).toBe(1)
    expect(f1.tn).toBe(1)
    expect(f1.precision).toBeCloseTo(0.5, 4)
    expect(f1.recall).toBeCloseTo(1 / 3, 4)
    expect(f1.f1).toBeCloseTo(0.4, 4)
    expect(f1.errorCount).toBe(1)
    expect(f1.errorDetail).toEqual({ error_no_response: 1 })
    expect(f1.totalSamples).toBe(5)
  })

  it("throws on sample-count mismatch", () => {
    expect(() => computeTriggerF1(["tool_calls", "stop"], ["tool_calls"])).toThrow(
      "Sample count mismatch: baseline 2, candidate 1",
    )
  })

  it("treats missing reasons as error_no_finish_reason", () => {
    expect(classifyFinishReason(undefined)).toBe("error_no_finish_reason")
    expect(classifyFinishReason(null)).toBe("error_no_finish_reason")
    const f1 = computeTriggerF1(["stop"], [undefined])
    expect(f1.errorDetail).toEqual({ error_no_finish_reason: 1 })
    expect(f1.tn).toBe(1) // neither side triggered
  })

  it("is the trigger-level twin of the flip matrix (perfect agreement → F1 1)", () => {
    const reasons = ["tool_calls", "stop", "tool_calls", "stop"]
    expect(computeTriggerF1(reasons, reasons).f1).toBe(1)
  })
})
