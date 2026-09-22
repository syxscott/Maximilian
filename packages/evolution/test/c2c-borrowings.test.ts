// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * M2 tests — C2C borrowings: handoff budget (D), lesson efficacy gating
 * (E), and the oracle-triad protocol (E3).
 */
import { describe, it, expect, beforeEach } from "vitest"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"
import { renderHandoffBundle, defaultHandoffBudgetTokens, estimateTokens } from "@max/core"
import { AgentMemoryStore } from "../src/memory.js"
import type { AgentMemory } from "../src/types.js"
import {
  runOracleTriad,
  OracleLessonsMissingError,
  type OracleTriadExecutor,
} from "../src/oracle-triad.js"
import { ProfileStore } from "../src/profile-store.js"
import type { AgentManifest, Task } from "@max/core"

// ── D: handoff budget ────────────────────────────────────────────────────────

describe("renderHandoffBundle", () => {
  it("keeps small bundles intact and self-report-free", () => {
    const r = renderHandoffBundle([{ title: "BACKEND (resultId=a)", body: "const x = 1" }], 4000, {
      role: "review",
    })
    expect(r.text).toContain("const x = 1")
    expect(r.truncatedEntries).toBe(0)
    expect(r.text).not.toContain("showing first")
  })

  it("truncates with a self-report when over budget (swarms borrowing)", () => {
    const big = "x".repeat(20_000)
    const r = renderHandoffBundle(
      [
        { title: "BIG", body: big },
        { title: "NEVER-REACHED", body: "tail" },
      ],
      1000, // 4000 chars
      { role: "review" },
    )
    expect(r.text.length).toBeLessThan(4500)
    expect(r.text).toContain("showing first")
    expect(r.text).toContain("of 20000 chars")
    expect(r.text).not.toContain("NEVER-REACHED")
    expect(r.truncatedEntries).toBeGreaterThan(0)
    expect(r.estimatedTokens).toBeLessThanOrEqual(1100)
  })

  it("reports an exact taxonomy when the tail is fully dropped (no false 'partial')", () => {
    const r = renderHandoffBundle(
      [
        { title: "A", body: "x".repeat(500) },
        { title: "B", body: "y".repeat(5000) },
      ],
      150, // 600 chars — A fits whole, B never shown at all
      { role: "review" },
    )
    // Regression: the old summary said "showing partial of 2" although B
    // was dropped WITHOUT any partial entry being present.
    expect(r.text).toContain("showing 1 full of 2 artifacts")
    expect(r.text).toContain("1 dropped")
    expect(r.text).not.toContain("1 partial")
    expect(r.truncatedEntries).toBe(1)
  })

  it("reports a lone partial entry as partial, never as 'showing 0'", () => {
    const big = "x".repeat(20_000)
    const r = renderHandoffBundle([{ title: "ONLY", body: big }], 1000, { role: "review" })
    expect(r.text).toContain("showing first")
    // Regression: the old summary printed "showing 0 of 1 artifacts" for a
    // single entry that WAS partially shown.
    expect(r.text).toContain("0 full + 1 partial of 1 artifacts")
    expect(r.truncatedEntries).toBe(1)
  })

  it("estimateTokens and default budget sanity", () => {
    expect(estimateTokens(400)).toBe(100)
    delete process.env.HANDOFF_BUDGET_TOKENS
    expect(defaultHandoffBudgetTokens()).toBe(4000)
    process.env.HANDOFF_BUDGET_TOKENS = "800"
    expect(defaultHandoffBudgetTokens()).toBe(800)
    delete process.env.HANDOFF_BUDGET_TOKENS
  })
})

// ── E: lesson efficacy + gating ──────────────────────────────────────────────

function memWithBuckets(): AgentMemory {
  const mem: AgentMemory = {
    userFeedback: [{ content: "prefer pnpm", mime: "text/plain" }],
    reviewSuggestions: [{ content: "add tests", mime: "text/plain" }],
    commonErrors: [{ content: "avoid any", mime: "text/plain" }],
    goodExamples: [{ content: "nice error handling", mime: "text/plain" }],
    totalEntries: 4,
  }
  return mem
}

describe("AgentMemoryStore efficacy gating", () => {
  it("applyEfficacy accumulates per active bucket only", () => {
    const mem = memWithBuckets()
    AgentMemoryStore.applyEfficacy(mem, -1)
    AgentMemoryStore.applyEfficacy(mem, -1)
    AgentMemoryStore.applyEfficacy(mem, -1)
    expect(mem.efficacy?.userFeedback).toEqual({ injectedCount: 3, deltaSum: -3 })
    expect(mem.efficacy?.goodExamples).toEqual({ injectedCount: 3, deltaSum: -3 })
    expect(mem.efficacy?.archived).toBeUndefined()
  })

  it("toPrelude enforce skips significantly-negative buckets", () => {
    const mem = memWithBuckets()
    AgentMemoryStore.applyEfficacy(mem, -1)
    AgentMemoryStore.applyEfficacy(mem, -1)
    AgentMemoryStore.applyEfficacy(mem, -1) // mean −1 for all buckets

    const off = AgentMemoryStore.toPrelude(mem, "off")
    const shadow = AgentMemoryStore.toPrelude(mem, "shadow")
    const enforce = AgentMemoryStore.toPrelude(mem, "enforce")
    expect(off).toContain("prefer pnpm")
    expect(shadow).toContain("prefer pnpm") // shadow = legacy render
    expect(enforce).not.toContain("prefer pnpm")
    expect(enforce).toBe("")
  })

  it("insufficient samples are NOT skipped (uncertainty injects)", () => {
    const mem = memWithBuckets()
    AgentMemoryStore.applyEfficacy(mem, -1) // 1 sample, mean −1
    expect(AgentMemoryStore.toPrelude(mem, "enforce")).toContain("prefer pnpm")
  })

  it("positively-effective buckets stay injected", () => {
    const mem = memWithBuckets()
    AgentMemoryStore.applyEfficacy(mem, 1)
    AgentMemoryStore.applyEfficacy(mem, 2)
    AgentMemoryStore.applyEfficacy(mem, 1.5)
    expect(AgentMemoryStore.toPrelude(mem, "enforce")).toContain("prefer pnpm")
  })
})

// ── E3: oracle triad ─────────────────────────────────────────────────────────

const BASE_MANIFEST: AgentManifest = {
  role: "backend",
  displayName: "Backend",
  goal: "g",
  systemPrompt: "You are backend.",
}

function makeTask(id: string): Task {
  return {
    id,
    agentRole: "backend",
    description: "write the thing",
    status: "pending",
    dependsOn: [],
  }
}

/** Executor whose quality follows the injected system prompt: oracle > few-shot > direct. */
function makeLearningExecutor(scores: { direct: number; fewShot: number; oracle: number }) {
  const seen: string[] = []
  const executor: OracleTriadExecutor = {
    async executeWithManifest(task, manifest) {
      seen.push(manifest.systemPrompt)
      const quality = manifest.systemPrompt.includes("Oracle lessons")
        ? scores.oracle
        : manifest.systemPrompt.includes("Lessons learned")
          ? scores.fewShot
          : scores.direct
      return { output: `out:${quality}`, durationMs: 10 }
    },
  }
  return { executor, seen }
}

describe("runOracleTriad", () => {
  let tmpDir: string
  let profiles: ProfileStore

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-"))
    profiles = new ProfileStore(tmpDir)
  })

  it("computes PGR from the three arms", async () => {
    await fs.mkdir(path.join(tmpDir, "oracle-lessons"), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, "oracle-lessons", "backend.md"),
      "Always write tests first.",
      "utf8",
    )
    // Seed the profile's memory so the few-shot arm actually carries the
    // auto-collected prelude (a fresh profile renders an empty one).
    const profile = await profiles.getOrCreate("backend", BASE_MANIFEST)
    await profiles.save({
      ...profile,
      memory: {
        ...profile.memory,
        commonErrors: [{ content: "always write tests first", mime: "text/plain" }],
        totalEntries: 1,
      },
    })
    const { executor } = makeLearningExecutor({ direct: 4, fewShot: 6, oracle: 8 })
    const report = await runOracleTriad(
      {
        profiles,
        executor,
        oracleLessonsDir: path.join(tmpDir, "oracle-lessons"),
        judge: (o) => Number(o.split(":")[1]),
      },
      makeTask("t-1"),
      { role: "backend", baseManifest: BASE_MANIFEST },
    )
    expect(report.direct.quality).toBe(4)
    expect(report.fewShot.quality).toBe(6)
    expect(report.oracle.quality).toBe(8)
    expect(report.pgr).toBeCloseTo(0.5, 5) // (6−4)/(8−4)
    expect(report.interpretation).toContain("curate more")
  })

  it("pgr is undefined when the oracle has no headroom", async () => {
    await fs.mkdir(path.join(tmpDir, "oracle-lessons"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, "oracle-lessons", "backend.md"), "nothing", "utf8")
    const { executor } = makeLearningExecutor({ direct: 6, fewShot: 6, oracle: 6 })
    const report = await runOracleTriad(
      {
        profiles,
        executor,
        oracleLessonsDir: path.join(tmpDir, "oracle-lessons"),
        judge: (o) => Number(o.split(":")[1]),
      },
      makeTask("t-2"),
      { role: "backend", baseManifest: BASE_MANIFEST },
    )
    expect(report.pgr).toBeUndefined()
    expect(report.interpretation).toContain("no recoverable headroom")
  })

  it("requireOracle surfaces a missing curated corpus", async () => {
    const { executor } = makeLearningExecutor({ direct: 4, fewShot: 4, oracle: 8 })
    await expect(
      runOracleTriad(
        {
          profiles,
          executor,
          oracleLessonsDir: path.join(tmpDir, "oracle-lessons"),
          judge: () => 5,
        },
        makeTask("t-3"),
        { role: "frontend", baseManifest: BASE_MANIFEST, requireOracle: true },
      ),
    ).rejects.toBeInstanceOf(OracleLessonsMissingError)
  })
})

// ── flip matrix (C2C Fig 7 borrowing) ────────────────────────────────────────

describe("computeFlipMatrix", () => {
  it("reports flips in both directions and the transfer rate", async () => {
    const { computeFlipMatrix, summarizeFlipMatrix } = await import("../src/flip-matrix.js")
    const m = computeFlipMatrix(
      ["t1", "t2", "t3", "t4"], // baseline correct
      ["t1", "t2", "t5", "t6"], // enriched correct
    )
    expect(m.newlyCorrect.sort()).toEqual(["t5", "t6"])
    expect(m.newlyWrong).toEqual(["t3", "t4"])
    expect(m.bothCorrect.sort()).toEqual(["t1", "t2"])
    expect(m.net).toBe(0)
    expect(m.transferRate).toBeCloseTo(0.5, 5) // 2 of 4 enriched-correct were already correct
    expect(summarizeFlipMatrix(m)).toContain("net +0")
  })

  it("identifies genuine transfer when enriched wins new tasks", async () => {
    const { computeFlipMatrix } = await import("../src/flip-matrix.js")
    const m = computeFlipMatrix(["t1"], ["t1", "t2", "t3"])
    expect(m.net).toBe(2)
    expect(m.transferRate).toBeCloseTo(1 / 3, 5)
  })
})

// ── oracle-triad regressions (missing corpus + gating parity) ───────────────

describe("runOracleTriad regressions", () => {
  let tmpDir: string
  let profiles: ProfileStore

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-regress-"))
    profiles = new ProfileStore(tmpDir)
  })

  it("a missing corpus suppresses PGR even when judge noise fakes a gap", async () => {
    // No lessons file exists at all. The oracle arm then degenerates into a
    // repeat of direct; a judge returning a noisy "gap" must NOT produce a
    // stop-investing PGR verdict (regression: it previously did).
    const { executor } = makeLearningExecutor({ direct: 0, fewShot: 0, oracle: 0 })
    let n = 0
    const report = await runOracleTriad(
      {
        profiles,
        executor,
        oracleLessonsDir: path.join(tmpDir, "absent"),
        judge: () => [4, 4.2, 7.9][n++]!,
      },
      makeTask("t-noise"),
      { role: "backend", baseManifest: BASE_MANIFEST },
    )
    expect(report.oracleCorpusMissing).toBe(true)
    expect(report.pgr).toBeUndefined()
    expect(report.interpretation).toContain("curate lessons first")
  })

  it("the few-shot arm honors the gating option (parity with production)", async () => {
    await fs.mkdir(path.join(tmpDir, "oracle-lessons"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, "oracle-lessons", "backend.md"), "lesson", "utf8")
    const profile = await profiles.getOrCreate("backend", BASE_MANIFEST)
    await profiles.save({
      ...profile,
      memory: {
        ...profile.memory,
        commonErrors: [{ content: "poisoned-bucket-content", mime: "text/plain" }],
        totalEntries: 1,
        efficacy: { commonErrors: { injectedCount: 5, deltaSum: -5 } }, // mean −1 ≪ −eps
      } as never,
    })
    const { executor, seen } = makeLearningExecutor({ direct: 4, fewShot: 6, oracle: 8 })

    await runOracleTriad(
      {
        profiles,
        executor,
        oracleLessonsDir: path.join(tmpDir, "oracle-lessons"),
        judge: (o) => Number(o.split(":")[1]),
      },
      makeTask("t-gate"),
      { role: "backend", baseManifest: BASE_MANIFEST, gating: "enforce" },
    )
    const fewShotEnforce = seen.find((s) => s.includes("Lessons learned")) ?? ""
    expect(fewShotEnforce).not.toContain("poisoned-bucket-content")

    seen.length = 0
    await runOracleTriad(
      {
        profiles,
        executor,
        oracleLessonsDir: path.join(tmpDir, "oracle-lessons"),
        judge: (o) => Number(o.split(":")[1]),
      },
      makeTask("t-nogate"),
      { role: "backend", baseManifest: BASE_MANIFEST, gating: "off" },
    )
    const fewShotOff = seen.find((s) => s.includes("Lessons learned")) ?? ""
    expect(fewShotOff).toContain("poisoned-bucket-content")
  })
})
