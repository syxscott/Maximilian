// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Trigger-F1 drift detection tests (borrowing MiniMax-Provider-Verifier
 * calculate_toolcall_similarity.py:107-161 + compare_with_baseline.py):
 * equal-length alignment with error_* classification, length-mismatch
 * error path, multi-loop comparison report, and result→sample mapping.
 */

import { describe, it, expect } from "vitest"
import {
  classifyFinishReason,
  compareWithBaseline,
  computeTriggerF1,
  sampleFromResult,
  suitesToTriggerSamples,
  type TriggerSample,
} from "../src/trigger-drift.js"
import { canonicalJson, stableHash } from "../src/persistence.js"
import type { BenchmarkResult, BenchmarkSuiteResult } from "../src/types.js"

function s(finishReason: string | null, hasResponse = true): TriggerSample {
  return { finishReason, hasResponse }
}

function result(patch: Partial<BenchmarkResult>): BenchmarkResult {
  return {
    taskId: "t",
    passed: true,
    quality: 1,
    latencyMs: 1,
    tokenUsage: { prompt: 0, completion: 0, total: 0 },
    acceptanceScore: 1,
    output: "",
    ...patch,
  }
}

describe("computeTriggerF1", () => {
  it("scores an aligned run: TP/FP/FN/TN with error_* detail", () => {
    const baseline: TriggerSample[] = [
      s("tool_calls"),
      s("tool_calls"),
      s("stop"),
      s("stop"),
      s("tool_calls"),
    ]
    const candidate: TriggerSample[] = [
      s("tool_calls"), // TP
      s("stop"), // FN (baseline triggered, candidate did not)
      s("tool_calls"), // FP
      s("stop"), // TN
      s(null, false), // error_no_response — counts neither quadrant
    ]
    const f1 = computeTriggerF1(baseline, candidate)
    // Quadrants: TP at 0; FN at 1 (stop) and 4 (error_no_response);
    // FP at 2; TN at 3.
    expect(f1.tp).toBe(1)
    expect(f1.fn).toBe(2)
    expect(f1.fp).toBe(1)
    expect(f1.tn).toBe(1)
    expect(f1.precision).toBeCloseTo(0.5, 4)
    expect(f1.recall).toBeCloseTo(1 / 3, 4)
    expect(f1.f1).toBeCloseTo(0.4, 4)
    expect(f1.totalSamples).toBe(5)
    expect(f1.errorCount).toBe(1)
    expect(f1.errorDetail).toEqual({ error_no_response: 1 })
  })

  it("buckets multiple error kinds in the detail map", () => {
    const baseline = [s("tool_calls"), s("stop"), s("stop")]
    const candidate = [s(null, false), s(null), s("tool_calls")]
    const f1 = computeTriggerF1(baseline, candidate)
    expect(f1.errorDetail).toEqual({ error_no_response: 1, error_no_finish_reason: 1 })
    expect(f1.errorCount).toBe(2)
  })

  it("throws on length mismatch (silent zip would fabricate a score)", () => {
    expect(() => computeTriggerF1([s("tool_calls")], [])).toThrow(
      "Sample count mismatch: baseline 1, candidate 0",
    )
  })

  it("returns zero F1 when neither side ever triggers", () => {
    const f1 = computeTriggerF1([s("stop"), s("stop")], [s("stop"), s("stop")])
    expect(f1.f1).toBe(0)
    expect(f1.precision).toBe(0)
    expect(f1.recall).toBe(0)
  })

  it("classifies absent finish reasons as error_no_finish_reason", () => {
    expect(classifyFinishReason(null)).toBe("error_no_finish_reason")
    expect(classifyFinishReason(undefined)).toBe("error_no_finish_reason")
    expect(classifyFinishReason("stop")).toBe("stop")
  })
})

describe("sampleFromResult mapping", () => {
  it("maps an errored result to error_no_response", () => {
    const sample = sampleFromResult(result({ error: "provider timeout" }))
    expect(sample.hasResponse).toBe(false)
  })

  it("reads the finish reason recorded by the tool_calls validator", () => {
    const sample = sampleFromResult(
      result({ validatorFields: { tool_calls: { toolCallsFinishReason: "tool_calls" } } }),
    )
    expect(sample).toEqual({ finishReason: "tool_calls", hasResponse: true })
  })

  it("falls back to error_no_finish_reason when the provider hid it", () => {
    expect(sampleFromResult(result({}))).toEqual({ finishReason: null, hasResponse: true })
  })
})

describe("compareWithBaseline (multi-loop report)", () => {
  it("aligns per loop and averages F1 and token usage", () => {
    const baselineA = [s("tool_calls"), s("tool_calls"), s("stop"), s("stop")]
    const candidateA = [s("tool_calls"), s("stop"), s("tool_calls"), s("stop")]
    const baselineB = [s("tool_calls"), s("stop"), s("stop")]
    const candidateB = [s("tool_calls"), s("stop"), s("stop")]

    const report = compareWithBaseline([
      {
        loop: "loop_1",
        baseline: baselineA,
        candidate: candidateA,
        candidateTokenUsage: { prompt: 100, completion: 50, total: 150 },
      },
      {
        loop: "loop_2",
        baseline: baselineB,
        candidate: candidateB,
        candidateTokenUsage: { prompt: 200, completion: 100, total: 300 },
      },
    ])

    expect(report.loops).toHaveLength(2)
    // Loop 1: TP=1, FP=1, FN=1, TN=1 → F1 0.5.
    expect(report.loops[0]).toMatchObject({ loop: "loop_1", tp: 1, fp: 1, fn: 1, tn: 1, f1: 0.5 })
    // Loop 2: perfect agreement → F1 1.
    expect(report.loops[1]).toMatchObject({ loop: "loop_2", f1: 1 })
    expect(report.averageMetrics.triggerF1).toBeCloseTo(0.75, 4)
    expect(report.averageMetrics.tokenUsage).toEqual({ prompt: 150, completion: 75, total: 225 })
  })

  it("propagates the length-mismatch error path per loop", () => {
    expect(() =>
      compareWithBaseline([{ loop: "loop_1", baseline: [s("stop")], candidate: [] }]),
    ).toThrow("Sample count mismatch")
  })
})

describe("suitesToTriggerSamples", () => {
  it("maps two suites' results in sample order", () => {
    const suite = (results: BenchmarkResult[]): BenchmarkSuiteResult => ({
      suiteId: "s",
      results,
      aggregateMetrics: {
        passRate: 1,
        avgQuality: 1,
        avgLatencyMs: 0,
        totalTokens: 0,
        avgAcceptance: 1,
      },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    })
    const baseline = suite([
      result({ validatorFields: { tool_calls: { toolCallsFinishReason: "tool_calls" } } }),
      result({ error: "boom" }),
    ])
    const candidate = suite([result({}), result({})])
    const samples = suitesToTriggerSamples(baseline, candidate)
    expect(samples.baseline[0]).toEqual({ finishReason: "tool_calls", hasResponse: true })
    expect(samples.baseline[1]).toEqual({ hasResponse: false })
    expect(samples.candidate).toHaveLength(2)
  })
})

describe("stableHash (canonical JSON + md5)", () => {
  it("is order-independent for object keys (sort_keys semantics)", () => {
    expect(stableHash({ a: 1, b: { c: 2, d: 3 } })).toBe(stableHash({ b: { d: 3, c: 2 }, a: 1 }))
  })

  it("keeps array order significant", () => {
    expect(stableHash([1, 2, 3])).not.toBe(stableHash([3, 2, 1]))
  })

  it("keeps non-ASCII raw (ensure_ascii=False semantics)", () => {
    expect(canonicalJson({ k: "数据" })).toBe('{"k":"数据"}')
  })
})
