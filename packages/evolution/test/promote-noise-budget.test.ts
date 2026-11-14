// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Promote-noise calibration + judge budget gate tests (borrowing
 * mcode-stack stacks/jiachen pr-review-tuning references/backtest.md:18-55):
 * a judge that declares itself non-deterministic must be beaten by more
 * than its own flip noise, and an exhausted budget stops new cases before
 * any judge call.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"

import type { AgentManifest, AgentRole } from "@max/core"
import { MetricsStore, ProfileStore } from "../src/index.js"
import { EvolutionEngine } from "../src/evolution.js"
import type { JudgeOutput } from "../src/llm-judge.js"
import type { MetricRecord } from "../src/types.js"

function makeManifest(role: AgentRole, prompt = "You are the agent."): AgentManifest {
  // Long base prompt so the composed candidate stays within the
  // constraint-gate growth cap (overgrowth rejects > 120% growth; the
  // composed candidate appends ~300 chars of discipline sections).
  const para =
    "Handle frontend tasks end to end. Validate every input before use. " +
    "State each assumption explicitly. Keep the output contract with other " +
    "agents exact. Prefer working code over clever code. Report failures " +
    "with the failing step and the reason. Re-read the acceptance criteria " +
    "before submitting. Keep latency low by avoiding redundant reads. "
  const base = `${prompt}\n${para.repeat(6)}`
  return { role, displayName: role, goal: role, systemPrompt: base }
}

function makeRecord(overrides: Partial<MetricRecord> & { taskId: string }): MetricRecord {
  return {
    agentId: "agent-test",
    agentRole: "frontend",
    provider: "openai",
    model: "gpt-4o",
    executionTime: 1000,
    tokenInput: 100,
    tokenOutput: 200,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    retryCount: 0,
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

function judgeOutput(composite: number, extra: Partial<JudgeOutput> = {}): JudgeOutput {
  return {
    composite,
    correctness: composite,
    procedure: composite,
    conciseness: 1,
    lengthPenalty: 0,
    feedback: "test judge",
    ...extra,
  }
}

describe("promote noise calibration (backtest.md:54)", () => {
  let tmp: string
  let metrics: MetricsStore
  let profiles: ProfileStore

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-evo-noise-"))
    metrics = new MetricsStore(tmp)
    profiles = new ProfileStore(tmp)
    // Healthy-scored history: no failure modes are composed into the
    // candidate, so the growth gate never fires and the tests exercise
    // the noise/budget logic specifically.
    for (let i = 0; i < 12; i++) {
      await metrics.record(makeRecord({ taskId: `t${i}`, reviewScore: 8 }))
    }
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it("a random (non-deterministic) judge is not promoted when the gain is within its flip noise", async () => {
    // Invocation order: baseline (0.5), noise repeat (0.7), candidate (0.6).
    // oldScore 5.0, repeat 7.0 → flip noise 2.0; candidate 6.0 beats the
    // 0.5 margin but NOT the noise → discarded.
    const calls: string[] = []
    const judge = (input: { candidate: string }): JudgeOutput => {
      calls.push(input.candidate)
      if (calls.length === 1) return judgeOutput(0.5, { nonDeterministic: true })
      if (calls.length === 2) return judgeOutput(0.7, { nonDeterministic: true })
      return judgeOutput(0.6, { nonDeterministic: true })
    }
    const engine = new EvolutionEngine(tmp, metrics, profiles, undefined, { judge })
    const profile = await profiles.getOrCreate("frontend", makeManifest("frontend"))

    const decision = await engine.evolve("frontend", profile.manifest!)
    expect(calls).toHaveLength(3) // baseline + noise repeat + candidate
    expect(decision.outcome).toBe("discarded")
    expect(decision.reason).toContain("baseline flip noise 2.00")
    expect(decision.reason).toContain("margin 2.00")
  })

  it("a deterministic judge keeps the plain 0.5 margin (behaviour unchanged)", async () => {
    // Same score pattern minus the nonDeterministic declaration: the same
    // +0.5-gain candidate now promotes — no repeat call, no noise margin.
    const calls: string[] = []
    const judge = (input: { candidate: string }): JudgeOutput => {
      calls.push(input.candidate)
      return judgeOutput(calls.length === 1 ? 0.5 : 0.6)
    }
    const engine = new EvolutionEngine(tmp, metrics, profiles, undefined, { judge })
    const profile = await profiles.getOrCreate("frontend", makeManifest("frontend"))

    const decision = await engine.evolve("frontend", profile.manifest!)
    expect(calls).toHaveLength(2) // baseline + candidate only
    expect(decision.outcome).toBe("promoted")
    expect(decision.reason).not.toContain("flip noise")
  })

  it("a candidate beating the observed noise still promotes", async () => {
    const calls: string[] = []
    const judge = (input: { candidate: string }): JudgeOutput => {
      calls.push(input.candidate)
      if (calls.length === 1) return judgeOutput(0.5, { nonDeterministic: true })
      if (calls.length === 2) return judgeOutput(0.6, { nonDeterministic: true })
      return judgeOutput(0.9, { nonDeterministic: true }) // +4.0 >> noise 1.0
    }
    const engine = new EvolutionEngine(tmp, metrics, profiles, undefined, { judge })
    const profile = await profiles.getOrCreate("frontend", makeManifest("frontend"))
    const decision = await engine.evolve("frontend", profile.manifest!)
    expect(decision.outcome).toBe("promoted")
    expect(decision.reason).toContain("baseline flip noise 1.00")
  })
})

describe("judge budget gate (backtest.md budget section)", () => {
  let root: string

  /**
   * Each budget cycle runs in a FRESH engine directory (a rejected
   * candidate becomes the next cycle's base in the same directory, which
   * would trip the duplicate-section gate) but all cycles SHARE the
   * budget state file — that shared accumulation is what's under test.
   */
  async function makeEngine(
    judge: (input: { candidate: string }) => JudgeOutput,
    limit: number,
    statePath: string,
  ): Promise<EvolutionEngine> {
    const dir = await fs.mkdtemp(path.join(root, "cycle-"))
    const metrics = new MetricsStore(dir)
    const profiles = new ProfileStore(dir)
    // Healthy scores → no failure modes appended → growth gate stays clear.
    for (let i = 0; i < 12; i++) {
      await metrics.record(makeRecord({ taskId: `t${i}`, reviewScore: 8 }))
    }
    const engine = new EvolutionEngine(dir, metrics, profiles, undefined, {
      judge,
      budget: { limit, statePath },
    })
    await profiles.getOrCreate("frontend", makeManifest("frontend"))
    return engine
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "max-evo-budget-"))
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it("over budget: no judge call is made and the refusal is logged", async () => {
    let judgeCalls = 0
    const judge = (): JudgeOutput => {
      judgeCalls += 1
      return judgeOutput(0.9)
    }
    // Default estimate is 1000/call × 3 (old + new + noise headroom) = 3000.
    const engine = await makeEngine(judge, 1000, path.join(root, "state.json"))
    const decision = await engine.evolve("frontend", makeManifest("frontend"))
    expect(judgeCalls).toBe(0) // stopped BEFORE starting a new case
    expect(decision.outcome).toBe("discarded")
    expect(decision.reason).toContain("Budget exhausted")
    expect(decision.reason).toContain("3000")
  })

  it("under budget: the run charges actual calls into the durable state", async () => {
    // Flat judge: nothing promotes; each deterministic cycle makes 2 calls.
    const judge = (): JudgeOutput => judgeOutput(0.5)
    const statePath = path.join(root, "evolution-state.json")

    const engine1 = await makeEngine(judge, 10000, statePath)
    await engine1.evolve("frontend", makeManifest("frontend"))
    const state = JSON.parse(await fs.readFile(statePath, "utf-8")) as { spent: number }
    // Deterministic judge: 2 actual calls × 1000 = 2000 charged.
    expect(state.spent).toBe(2000)

    // A second cycle still fits (2000 + 3000 ≤ 10000) and charges again.
    const engine2 = await makeEngine(judge, 10000, statePath)
    await engine2.evolve("frontend", makeManifest("frontend"))
    const state2 = JSON.parse(await fs.readFile(statePath, "utf-8")) as { spent: number }
    expect(state2.spent).toBe(4000)
  })

  it("an exhausted accumulated budget stops the next cycle", async () => {
    const judge = (): JudgeOutput => judgeOutput(0.5)
    const statePath = path.join(root, "evolution-state.json")

    const engine1 = await makeEngine(judge, 3500, statePath)
    await engine1.evolve("frontend", makeManifest("frontend")) // charges 2000

    const engine2 = await makeEngine(judge, 3500, statePath)
    const decision = await engine2.evolve("frontend", makeManifest("frontend"))
    expect(decision.reason).toContain("Budget exhausted")
    const state = JSON.parse(await fs.readFile(statePath, "utf-8")) as { spent: number }
    expect(state.spent).toBe(2000) // no further charges after refusal
  })
})
