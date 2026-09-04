// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Anchored rubric judge (wshobson borrowing) + variant-runner patience
 * early-stop.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"

import type { AgentRole, ExecuteResult, Result, Task } from "@max/core"
import { defaultJudge, RUBRIC_ANCHORS } from "../src/llm-judge.js"
import { VariantRunner } from "../src/variant-runner.js"
import { ProfileStore } from "../src/profile-store.js"

describe("anchored rubric judge", () => {
  const baseInput = {
    candidate: "You are the backend agent. Validate inputs. Verify results.",
    baseline: "You are the backend agent.",
    failures: [],
    feedback: [],
    scoreThreshold: 6,
  }

  it("exposes anchored rubric definitions", () => {
    expect(RUBRIC_ANCHORS.orchestrationFitness.zero).toContain("orchestrate")
    expect(RUBRIC_ANCHORS.triggerF1.one).toContain("never on a negative")
  })

  it("scores a worker that reaches into orchestration as unfit", async () => {
    const inRole = await defaultJudge({
      ...baseInput,
      rubricContext: { roleExpectation: "worker" },
    })
    expect(inRole.rubric).toBeDefined()
    expect(inRole.rubric!.orchestrationFitness).toBeGreaterThan(0.5)

    const overreaching = await defaultJudge({
      ...baseInput,
      candidate:
        "You are the backend agent. Delegate to other agents and dispatch tasks across the team. Verify results.",
      rubricContext: { roleExpectation: "worker" },
    })
    expect(overreaching.rubric!.orchestrationFitness).toBeLessThanOrEqual(0.5)
    expect(overreaching.feedback).toContain("outside its role")
  })

  it("computes trigger F1 against positive and negative cases", async () => {
    const positives = ["migrate the database schema", "fix the flaky migration"]
    const negatives = ["write a haiku about databases"]
    const good = await defaultJudge({
      ...baseInput,
      candidate:
        "You are the migration agent. Handle: migrate the database schema; fix the flaky migration. Must verify with tests.",
      rubricContext: { positives, negatives, roleExpectation: "worker" },
    })
    const bad = await defaultJudge({
      ...baseInput,
      candidate: "You are the migration agent. Handle: write a haiku about databases. Must verify.",
      rubricContext: { positives, negatives, roleExpectation: "worker" },
    })
    expect(good.rubric!.triggerF1).toBeGreaterThan(bad.rubric!.triggerF1)
  })

  it("no rubricContext → no rubric in output (backward compatible)", async () => {
    const out = await defaultJudge(baseInput)
    expect(out.rubric).toBeUndefined()
  })
})

describe("VariantRunner patience early-stop", () => {
  let tmp: string
  let profiles: ProfileStore

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-evo-patience-"))
    profiles = new ProfileStore(tmp)
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  function makeTask(): Task {
    return {
      id: "t1",
      agentRole: "backend" as AgentRole,
      description: "do the thing",
      status: "pending",
      dependsOn: [],
      createdAt: new Date().toISOString(),
    } as unknown as Task
  }

  /** Executor whose outputs have the given lengths (drives heuristic quality). */
  function executorWithScores(outputLengths: number[]) {
    let i = 0
    return {
      async executeTask(_task: Task, _workspaceId: string): Promise<ExecuteResult> {
        const len = outputLengths[Math.min(i, outputLengths.length - 1)]
        i += 1
        const result: Result = {
          id: `r${i}`,
          taskId: "t1",
          agentRole: "backend" as AgentRole,
          agentId: "x",
          output: len > 0 ? "x".repeat(len) : "",
          metadata: {},
          createdAt: new Date().toISOString(),
          durationMs: 0,
        }
        return { result, sessionId: `s${i}`, durationMs: 0 } as ExecuteResult
      },
    }
  }

  it("stops spawning variants after N non-improving runs", async () => {
    // 200-char output → quality 7; every later variant is identical →
    // no improvement → patience fires.
    const executor = executorWithScores([200, 200, 200, 200])
    const runner = new VariantRunner({ profiles, executor })
    const report = await runner.runWith(executor, makeTask(), {
      workspaceId: "w1",
      variantCount: 4,
      patience: 1,
    })
    expect(report.runs.length).toBeLessThan(4)
    expect(report.stoppedEarly).toBe(true)
  })

  it("runs all variants when improvements keep coming", async () => {
    const executor = executorWithScores([100, 200, 1200, 2000])
    const runner = new VariantRunner({ profiles, executor })
    const report = await runner.runWith(executor, makeTask(), {
      workspaceId: "w1",
      variantCount: 4,
      patience: 1,
    })
    expect(report.runs).toHaveLength(4)
    expect(report.stoppedEarly).toBeUndefined()
  })
})
