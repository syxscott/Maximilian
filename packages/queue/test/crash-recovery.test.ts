// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the crash-recovery batch reset (swarms borrowing): closed
 * category adapter, per-category port dispatch, reset budget, unknown
 * counting, and sweep continuation on port failures.
 */
import { describe, expect, it } from "vitest"
import {
  CRASH_CATEGORIES,
  crashCategoryOfClassification,
  recoverStalledJobs,
  type CrashCategory,
  type StalledJobPort,
  type StalledJobRecord,
} from "../src/crash-recovery.js"

/** In-memory port recording every verb call. */
function memoryPort(
  jobs: StalledJobRecord[],
  opts: { failResetFor?: Set<string>; failHoldFor?: Set<string> } = {},
): StalledJobPort & {
  resets: Array<{ id: string; category: CrashCategory }>
  holds: Array<{ id: string; category: CrashCategory }>
} {
  return {
    resets: [],
    holds: [],
    listStalledRunning: () => jobs,
    resetToRetryable(id, category) {
      if (opts.failResetFor?.has(id)) throw new Error(`reset refused for ${id}`)
      this.resets.push({ id, category })
    },
    holdWithReason(id, category) {
      if (opts.failHoldFor?.has(id)) throw new Error(`hold refused for ${id}`)
      this.holds.push({ id, category })
    },
  }
}

const classifyFromMessage = (err: unknown): CrashCategory | null => {
  const message = err instanceof Error ? err.message : String(err ?? "")
  const table: Array<[RegExp, CrashCategory]> = [
    [/ETIMEDOUT|ECONNRESET/, "transient"],
    [/429|rate limit/i, "rate_limit"],
    [/maximum context length/i, "context_limit"],
    [/permission denied/i, "permanent"],
    [/cancelled/i, "cancelled"],
  ]
  for (const [re, category] of table) {
    if (re.test(message)) return category
  }
  return null
}

describe("crashCategoryOfClassification", () => {
  it("accepts every member of the closed set from a { category } shape", () => {
    for (const category of CRASH_CATEGORIES) {
      expect(crashCategoryOfClassification({ category })).toBe(category)
    }
  })

  it("rejects non-members and malformed shapes (drift degrades, not crashes)", () => {
    expect(crashCategoryOfClassification({ category: "mysterious" })).toBeNull()
    expect(crashCategoryOfClassification({ category: 42 })).toBeNull()
    expect(crashCategoryOfClassification({})).toBeNull()
    expect(crashCategoryOfClassification(null)).toBeNull()
    expect(crashCategoryOfClassification("transient")).toBeNull()
  })
})

describe("recoverStalledJobs", () => {
  it("resets transient and rate_limit tasks back into the retry pool", async () => {
    const port = memoryPort([
      { id: "j1", attempts: 1, lastError: new Error("ETIMEDOUT mid-run") },
      { id: "j2", attempts: 2, lastError: "429 rate limit exceeded" },
    ])
    const report = await recoverStalledJobs(port, classifyFromMessage)

    expect(report.scanned).toBe(2)
    expect(report.reset).toBe(2)
    expect(report.held).toBe(0)
    expect(report.unknownLeft).toBe(0)
    expect(port.resets.map((r) => r.id)).toEqual(["j1", "j2"])
    expect(port.resets[0]?.category).toBe("transient")
    expect(port.resets[1]?.category).toBe("rate_limit")
    expect(port.holds).toEqual([])
    expect(report.byCategory.transient).toBe(1)
    expect(report.byCategory.rate_limit).toBe(1)
  })

  it("holds permanent, context_limit and cancelled tasks without resetting", async () => {
    const port = memoryPort([
      { id: "jp", attempts: 1, lastError: new Error("Permission denied: bash -> /etc") },
      { id: "jc", attempts: 1, lastError: new Error("maximum context length exceeded") },
      { id: "jx", attempts: 1, lastError: new Error("task cancelled by user") },
    ])
    const report = await recoverStalledJobs(port, classifyFromMessage)

    expect(report.reset).toBe(0)
    expect(report.held).toBe(3)
    expect(port.resets).toEqual([])
    expect(port.holds.map((h) => h.id)).toEqual(["jp", "jc", "jx"])
  })

  it("counts unknown tasks without touching them (conservative residue)", async () => {
    const port = memoryPort([
      { id: "ju", attempts: 1, lastError: new Error("something indescribable") },
      { id: "jn", attempts: 1 }, // no failure artifact at all
    ])
    const report = await recoverStalledJobs(port, classifyFromMessage)

    expect(report.unknownLeft).toBe(2)
    expect(report.byCategory.unknown).toBe(2)
    expect(report.reset).toBe(0)
    expect(report.held).toBe(0)
    expect(port.resets).toEqual([])
    expect(port.holds).toEqual([])
  })

  it("a classifier returning null degrades to unknown (counted, untouched)", async () => {
    const port = memoryPort([{ id: "j1", attempts: 1, lastError: new Error("??") }])
    const report = await recoverStalledJobs(port, () => null)
    expect(report.unknownLeft).toBe(1)
    expect(port.resets).toEqual([])
  })

  it("enforces the per-sweep reset budget; over-budget transient tasks are held", async () => {
    const port = memoryPort([
      { id: "a", attempts: 1, lastError: new Error("ECONNRESET") },
      { id: "b", attempts: 1, lastError: new Error("ETIMEDOUT") },
      { id: "c", attempts: 1, lastError: new Error("ETIMEDOUT again") },
    ])
    const report = await recoverStalledJobs(port, classifyFromMessage, { maxResets: 2 })

    expect(report.reset).toBe(2)
    expect(port.resets.map((r) => r.id)).toEqual(["a", "b"])
    // Over-budget: parked with a reason, NOT silently dropped or requeued.
    expect(report.held).toBe(1)
    expect(port.holds.map((h) => h.id)).toEqual(["c"])
  })

  it("continues the sweep when a port verb throws, reporting per-task errors", async () => {
    const port = memoryPort(
      [
        { id: "bad", attempts: 1, lastError: new Error("ECONNRESET") },
        { id: "good", attempts: 1, lastError: new Error("ETIMEDOUT") },
        { id: "held", attempts: 1, lastError: new Error("permission denied for resource") },
      ],
      { failResetFor: new Set(["bad"]) },
    )
    const report = await recoverStalledJobs(port, classifyFromMessage)

    expect(report.scanned).toBe(3)
    expect(report.reset).toBe(1)
    expect(report.held).toBe(1)
    expect(report.errors).toHaveLength(1)
    expect(report.errors[0]).toContain("bad")
  })

  it("an empty stalled list produces a zeroed report", async () => {
    const port = memoryPort([])
    const report = await recoverStalledJobs(port, classifyFromMessage)
    expect(report).toEqual({
      scanned: 0,
      reset: 0,
      held: 0,
      unknownLeft: 0,
      byCategory: {
        transient: 0,
        permanent: 0,
        context_limit: 0,
        rate_limit: 0,
        cancelled: 0,
        unknown: 0,
      },
      errors: [],
    })
  })
})
