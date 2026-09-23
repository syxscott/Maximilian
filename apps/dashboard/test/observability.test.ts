// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Model-layer tests for the observability helpers (P3) and the workflow
 * run grouping (P4).
 */
import { describe, it, expect } from "vitest"
import { formatPct, verdictTone, pgrBand, pgrLabel } from "../src/lib/observability"
import { groupWorkflowRuns, type WorkflowRunSummary } from "../src/lib/workflows"

describe("observability helpers", () => {
  it("formatPct renders one decimal percentage", () => {
    expect(formatPct(0.5)).toBe("50.0%")
    expect(formatPct(1.234)).toBe("123.4%")
  })

  it("verdictTone maps truth verdicts to badge variants", () => {
    expect(verdictTone("accurate")).toBe("default")
    expect(verdictTone("insufficient_data")).toBe("outline")
    expect(verdictTone("over_predicted")).toBe("secondary")
    expect(verdictTone("unknown")).toBe("destructive")
  })

  it("pgrBand mirrors the oracle-triad interpretation thresholds", () => {
    expect(pgrBand(undefined)).toBe("none")
    expect(pgrBand(0.9)).toBe("maintain")
    expect(pgrBand(0.5)).toBe("curate")
    expect(pgrBand(0.1)).toBe("bottleneck")
  })

  it("pgrLabel stays null for a missing corpus", () => {
    expect(pgrLabel({ pgr: 0.9, oracleCorpusMissing: true })).toBeNull()
    expect(pgrLabel({ pgr: 0.9 })).toBe("≥70%")
    expect(pgrLabel({ pgr: undefined })).toBeNull()
  })
})

describe("groupWorkflowRuns", () => {
  it("groups journal entries per run with counts and script identity", () => {
    const runs: WorkflowRunSummary[] = groupWorkflowRuns([
      { runId: "wf-a", siteId: "__script_hash__", ok: true, output: "h1", recordedAt: "t1" },
      { runId: "wf-a", siteId: "s1", ok: true, output: 1, recordedAt: "t2" },
      { runId: "wf-a", siteId: "s2", ok: false, output: { error: "x" }, recordedAt: "t3" },
      { runId: "wf-b", siteId: "s1", ok: true, output: 2, recordedAt: "t4" },
    ])
    expect(runs).toHaveLength(2)
    const a = runs.find((r) => r.runId === "wf-a")!
    expect(a.completedSteps).toBe(1)
    expect(a.failedSteps).toBe(1)
    expect(a.scriptHash).toBe("h1")
    expect(runs[0]!.runId).toBe("wf-b") // newest first (t4 > t3)
  })

  it("returns an empty list for an empty journal", () => {
    expect(groupWorkflowRuns([])).toEqual([])
  })
})
