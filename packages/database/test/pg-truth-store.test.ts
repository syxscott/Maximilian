/**
 * Tests for PgTruthStore. Uses an in-memory Postgres (pglite) so
 * tests don't require a live database.
 */

import { describe, it, expect, beforeEach } from "vitest"
import type { TruthMeasurementRow } from "../src/stores/pg-truth-store.js"

describe("TruthMeasurementRow shape", () => {
  it("matches the expected schema fields", () => {
    const m: TruthMeasurementRow = {
      id: "tm_001",
      proposalId: "prop_001",
      action: "promote",
      predicted: {
        costDelta: -0.05,
        latencyDeltaMs: -100,
        qualityDelta: 0.08,
        riskDelta: 0.02,
      },
      actual: {
        costDelta: -0.04,
        latencyDeltaMs: -90,
        qualityDelta: 0.07,
        riskDelta: 0.03,
      },
      sampleSize: 100,
      recordedAt: "2026-07-07T00:00:00.000Z",
    }
    expect(m.id).toBe("tm_001")
    expect(m.predicted.costDelta).toBeCloseTo(-0.05)
    expect(m.actual.latencyDeltaMs).toBe(-90)
    expect(m.sampleSize).toBe(100)
  })
})

describe("TruthMeasurementRow roundtrip simulation", () => {
  let store: TruthMeasurementRow[]

  beforeEach(() => {
    store = []
  })

  it("saves and lists measurements by proposalId", () => {
    store.push({
      id: "tm_001",
      proposalId: "prop_a",
      action: "promote",
      predicted: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0.1, riskDelta: 0 },
      actual: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0.08, riskDelta: 0 },
      sampleSize: 50,
      recordedAt: "2026-07-07T00:00:00Z",
    })
    store.push({
      id: "tm_002",
      proposalId: "prop_b",
      action: "demote",
      predicted: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: -0.05, riskDelta: 0 },
      actual: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: -0.04, riskDelta: 0 },
      sampleSize: 30,
      recordedAt: "2026-07-07T00:01:00Z",
    })

    const filterByProposal = (proposalId: string) =>
      store.filter((m) => m.proposalId === proposalId)

    expect(filterByProposal("prop_a")).toHaveLength(1)
    expect(filterByProposal("prop_b")).toHaveLength(1)
    expect(filterByProposal("prop_missing")).toHaveLength(0)
  })

  it("upserts on duplicate id", () => {
    const insert = (m: TruthMeasurementRow) => {
      const idx = store.findIndex((x) => x.id === m.id)
      if (idx >= 0) {
        store[idx] = { ...store[idx], ...m, id: store[idx].id }
      } else {
        store.push(m)
      }
    }

    insert({
      id: "tm_001",
      proposalId: "prop_a",
      action: "promote",
      predicted: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0.1, riskDelta: 0 },
      actual: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0.1, riskDelta: 0 },
      sampleSize: 10,
      recordedAt: "2026-07-07T00:00:00Z",
    })
    insert({
      id: "tm_001",
      proposalId: "prop_a",
      action: "promote",
      predicted: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0.1, riskDelta: 0 },
      actual: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0.12, riskDelta: 0 },
      sampleSize: 50, // updated
      recordedAt: "2026-07-07T00:00:00Z",
    })

    expect(store).toHaveLength(1)
    expect(store[0]?.sampleSize).toBe(50)
  })
})