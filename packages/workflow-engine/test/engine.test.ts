// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the journal-based workflow engine (ZCode dynamic-workflow
 * minimal port): journal short-circuit on resume, script-hash refusal,
 * phase progress.
 */
import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import {
  WorkflowEngine,
  WorkflowScriptChangedError,
  type WorkflowDefinition,
  type WorkflowJournalPort,
  type WorkflowStep,
} from "../src/index.js"

function makeJournal() {
  const entries: Array<{ runId: string; entry: import("../src/index.js").JournalEntry }> = []
  return {
    entries,
    async append(runId: string, entry: import("../src/index.js").JournalEntry) {
      entries.push({ runId, entry })
    },
    async readAll(runId: string) {
      return entries.filter((e) => e.runId === runId).map((e) => e.entry)
    },
  }
}

function hash(source: string): string {
  return createHash("sha256").update(source).digest("hex")
}

function makeExecutor() {
  let executed = 0
  return {
    executed,
    async executeStep(step: WorkflowStep) {
      executed += 1
      return `out-of-${step.siteId}#${executed}`
    },
  }
}

function def(source: string, steps: Array<[string, string?]>): WorkflowDefinition {
  return {
    scriptHash: hash(source),
    steps: steps.map(([siteId, phase]) => ({ siteId, phase })),
  }
}

describe("WorkflowEngine", () => {
  it("runs all steps in order, chaining outputs", async () => {
    const journal = makeJournal()
    const engine = new WorkflowEngine(journal, {
      async executeStep(step, input) {
        return `${step.siteId}<-${String(input)}`
      },
    })
    const definition = def("src-a", [
      ["s1", "research"],
      ["s2", "build"],
    ])
    const report = await engine.run("run-1", definition, "seed", { chain: true })
    expect(report.completed.map((c) => c.siteId)).toEqual(["s1", "s2"])
    expect(report.skippedFromJournal).toBe(0)
    expect(report.phaseProgress).toEqual([
      { phase: "research", completedSteps: 1 },
      { phase: "build", completedSteps: 1 },
    ])
  })

  it("resume short-circuits journaled steps", async () => {
    const journal = makeJournal()
    const engine = new WorkflowEngine(journal, {
      async executeStep(step) {
        return `out-of-${step.siteId}`
      },
    })
    const definition = def("src-b", [["s1"], ["s2"], ["s3"]])
    await engine.run("run-2", definition, null)

    // Resume with a fresh engine (simulating process restart): s1 is
    // journaled so it short-circuits; only s2/s3 execute.
    const executor = makeExecutor()
    const resumed = new WorkflowEngine(journal, executor)
    const report = await resumed.run("run-2", definition, null)
    expect(report.skippedFromJournal).toBe(3)
    expect(executor.executed).toBe(0)
    expect(report.completed.map((c) => c.siteId)).toEqual(["s1", "s2", "s3"])
  })

  it("refuses resume when the script hash changed", async () => {
    const journal = makeJournal()
    const engine = new WorkflowEngine(journal, {
      async executeStep(step) {
        return step.siteId
      },
    })
    await engine.run("run-3", def("source-v1", [["a"], ["b"]]), null)

    const changedDef = def("source-v2", [["a"], ["b"]])
    // run() is async — the changed-script refusal surfaces as a rejection.
    await expect(engine.run("run-3", changedDef, null)).rejects.toThrow(WorkflowScriptChangedError)
  })

  it("failed steps are journaled with ok:false and throw", async () => {
    const journal = makeJournal()
    const engine = new WorkflowEngine(journal, {
      async executeStep(step) {
        if (step.siteId === "boom") throw new Error("kaput")
        return "ok"
      },
    })
    await expect(engine.run("run-4", def("src-c", [["boom"]]), null)).rejects.toThrow(/kaput/)
    const all = journal.entries.filter((e) => e.runId === "run-4")
    expect(all.some((e) => e.entry.ok === false)).toBe(true)
  })

  it("a failed step re-executes on resume with its attempt ordinal incremented", async () => {
    const journal = makeJournal()
    let failFirst = true
    const engine = new WorkflowEngine(journal, {
      async executeStep(step) {
        if (step.siteId === "flaky" && failFirst) throw new Error("transient")
        return `done-${step.siteId}`
      },
    })
    const definition = def("src-d", [["flaky"], ["after"]])
    await expect(engine.run("run-5", definition, null)).rejects.toThrow(/transient/)

    failFirst = false
    const report = await engine.run("run-5", definition, null)
    expect(report.completed.map((c) => c.siteId)).toEqual(["flaky", "after"])
    // The retried step's second journal entry carries attempt=1.
    const flaky = journal.entries
      .filter((e) => e.runId === "run-5" && e.entry.siteId === "flaky")
      .map((e) => e.entry)
    expect(flaky).toHaveLength(2)
    expect(flaky.map((e) => e.ok)).toEqual([false, true])
    expect(flaky.map((e) => e.attempt)).toEqual([0, 1])
  })
})
