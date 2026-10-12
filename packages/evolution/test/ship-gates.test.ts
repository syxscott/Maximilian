// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Ship-gate tests for the capability-family registry (codebase-memory-mcp
 * 7209ae12/78eace4f borrowing): the single registry generates both the
 * family names and their gates; every SHIPPED family must have a passing
 * held-out audit in the committed ledger — re-opening a held family turns
 * this test red; held families degrade produced rows instead of disabling
 * them.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readFileSync, promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  CAPABILITY_FAMILIES,
  FAMILY_SHIP_GATES,
  BELOW_BAR_TIER_REASON,
  MIN_HELDOUT_SAMPLE,
  POINT_ESTIMATE_MIN,
  WILSON_LOWER_BOUND_MIN,
  isCapabilityFamily,
  resolveFamilyRow,
  shipGateViolations,
  wilsonLowerBound,
  MetricsStore,
  ProfileStore,
  EvolutionEngine,
  type CapabilityFamily,
  type ShipGateViolation,
} from "../src/index.js"

const LEDGER_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "ship-gate-audit-ledger.json",
)

function loadLedger(): {
  protocol: string
  audits: Array<{
    family: string
    verdict: "passed" | "failed"
    judged: number
    correct: number
    auditedAt: string
  }>
} {
  return JSON.parse(readFileSync(LEDGER_PATH, "utf-8"))
}

/** Registry ships-map as the gate check sees it: family → ships. */
function shipsMap(): Record<string, boolean> {
  return Object.fromEntries(CAPABILITY_FAMILIES.map(([id, , ships]) => [id, ships]))
}

describe("capability-family registry — one row is name AND gate", () => {
  it("derives a gate for every family and nothing else", () => {
    expect(Object.keys(FAMILY_SHIP_GATES)).toHaveLength(CAPABILITY_FAMILIES.length)
    for (const [id, displayName, ships] of CAPABILITY_FAMILIES) {
      const gate = FAMILY_SHIP_GATES[id]
      expect(gate).toBeDefined()
      expect(gate.displayName).toBe(displayName)
      expect(gate.ships).toBe(ships)
    }
  })
  it("types and predicates agree", () => {
    for (const [id] of CAPABILITY_FAMILIES) {
      expect(isCapabilityFamily(id)).toBe(true)
    }
    expect(isCapabilityFamily("no_such_family")).toBe(false)
    // The derived union must stay in sync with the registry rows.
    const sample: CapabilityFamily = "prompt_rewrite"
    expect(FAMILY_SHIP_GATES[sample].family).toBe("prompt_rewrite")
  })
})

describe("wilsonLowerBound — the audit bar's math", () => {
  // Reference values from the codebase-memory-mcp held-out audit tables
  // (78eace4f commit body): scored held-out audits with published bounds.
  it("matches the published reference bounds", () => {
    expect(wilsonLowerBound(150, 150)).toBeCloseTo(0.975, 3)
    expect(wilsonLowerBound(149, 150)).toBeCloseTo(0.963, 3)
    expect(wilsonLowerBound(145, 150)).toBeCloseTo(0.924, 3)
    expect(wilsonLowerBound(79, 79)).toBeCloseTo(0.954, 3)
  })
  it("a 93/100 audit is below the bar (point < 0.95)", () => {
    expect(wilsonLowerBound(93, 100)).toBeLessThan(WILSON_LOWER_BOUND_MIN)
    expect(93 / 100).toBeLessThan(POINT_ESTIMATE_MIN)
  })
  it("degenerates safely", () => {
    expect(wilsonLowerBound(0, 0)).toBe(0)
    expect(wilsonLowerBound(0, 10)).toBe(0)
  })
})

describe("the ship gate", () => {
  it("the committed registry and ledger are consistent — green today", () => {
    expect(shipGateViolations(shipsMap(), loadLedger())).toEqual([])
  })

  it("re-opening a held family without a passing audit turns the gate red", () => {
    // This is the test that fires when a family is re-opened in the
    // registry without its held-out audit passing: forge exactly that
    // change and assert the violation.
    const reopened: Record<string, boolean> = { ...shipsMap(), oracle_triad: true }
    const violations: ShipGateViolation[] = shipGateViolations(reopened, loadLedger())
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ kind: "audit_below_bar", family: "oracle_triad" })

    const neverAudited: Record<string, boolean> = { ...shipsMap(), team_rebalance: true }
    const withoutAudit: ShipGateViolation[] = shipGateViolations(neverAudited, loadLedger())
    expect(withoutAudit).toHaveLength(1)
    expect(withoutAudit[0]).toMatchObject({
      kind: "family_reopened_without_audit",
      family: "team_rebalance",
    })
  })

  it("a ledger row naming an unknown family is a violation (registry/ledger drift)", () => {
    const ledger = {
      ...loadLedger(),
      audits: [
        ...loadLedger().audits,
        {
          family: "ghost_family",
          verdict: "passed" as const,
          judged: 150,
          correct: 150,
          auditedAt: "2026-10-12",
        },
      ],
    }
    const violations = shipGateViolations(shipsMap(), ledger)
    expect(violations).toContainEqual(
      expect.objectContaining({ kind: "ledger_family_unknown", family: "ghost_family" }),
    )
  })

  it("every shipped family in the registry has a passing audit at or above the minimum sample", () => {
    const ledger = loadLedger()
    for (const [id, , ships] of CAPABILITY_FAMILIES) {
      if (!ships) continue
      const record = ledger.audits.find((a) => a.family === id)
      expect(record, `family ${id} ships but has no ledger audit`).toBeDefined()
      expect(record!.verdict).toBe("passed")
      expect(record!.judged).toBeGreaterThanOrEqual(MIN_HELDOUT_SAMPLE)
      expect(record!.correct / record!.judged).toBeGreaterThanOrEqual(POINT_ESTIMATE_MIN)
      expect(wilsonLowerBound(record!.correct, record!.judged)).toBeGreaterThanOrEqual(
        WILSON_LOWER_BOUND_MIN,
      )
    }
  })
})

describe("degradation semantics — produced, not promoted", () => {
  it("a shipped family passes its artifact through clean", () => {
    const row = resolveFamilyRow("prompt_rewrite", { decision: "promoted" })
    expect(row.shipped).toBe(true)
    expect(row.degradation).toBeUndefined()
    expect(row.output).toEqual({ decision: "promoted" })
  })
  it("a held family still produces its output, degraded with below_bar_tier", () => {
    const row = resolveFamilyRow("oracle_triad", { recommendation: "rebalance" })
    expect(row.shipped).toBe(false)
    expect(row.output).toEqual({ recommendation: "rebalance" })
    expect(row.degradation).toBeDefined()
    expect(row.degradation!.code).toBe(BELOW_BAR_TIER_REASON)
    expect(row.degradation!.reason).toContain("oracle_triad")
  })
  it("a never-audited family degrades the same way", () => {
    const row = resolveFamilyRow("team_rebalance", ["suggestion"])
    expect(row.shipped).toBe(false)
    expect(row.degradation!.code).toBe("below_bar_tier")
    expect(row.output).toEqual(["suggestion"])
  })
})

describe("ship gate wired into the evolution engine", () => {
  let tmp: string
  let metrics: MetricsStore
  let profiles: ProfileStore
  let engine: EvolutionEngine

  beforeEach(async () => {
    tmp = await fs.mkdtemp(join(tmpdir(), "max-evo-shipgate-"))
    metrics = new MetricsStore(tmp)
    profiles = new ProfileStore(tmp)
    engine = new EvolutionEngine(tmp, metrics, profiles)
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  async function runEvolve(): Promise<import("../src/index.js").EvolutionDecision> {
    const manifest = {
      role: "frontend" as const,
      displayName: "Frontend",
      goal: "build",
      systemPrompt: "You are the frontend agent.",
    }
    const profile = await profiles.getOrCreate("frontend", manifest)
    for (let i = 0; i < 12; i++) {
      await metrics.record({
        taskId: `t${i}`,
        agentId: "a1",
        agentRole: "frontend",
        provider: "openai",
        model: "gpt-4o",
        executionTime: 1000,
        tokenInput: 100,
        tokenOutput: 100,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        retryCount: 0,
        reviewScore: 3,
        timestamp: new Date().toISOString(),
      })
    }
    return engine.evolve("frontend", profile.manifest!)
  }

  it("every evolution decision row carries its prompt_rewrite gate stamp", async () => {
    const decision = await runEvolve()
    // The prompt_rewrite family passed its held-out audit, so the produced
    // row is not degraded.
    expect(decision.shipGate).toMatchObject({ family: "prompt_rewrite", shipped: true })
    expect(decision.shipGate!.degradation).toBeUndefined()
  })
})
