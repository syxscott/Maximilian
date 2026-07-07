/**
 * Property-based tests for TruthAudit invariants.
 *
 * Uses fast-check to generate random inputs and verify that
 * TruthAudit never crashes and that the calibration math holds.
 */

import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { TruthAudit } from "../src/truth-audit.js"

const deltaArb = fc.record({
  costDelta: fc.float({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
  latencyDeltaMs: fc.float({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
  qualityDelta: fc.float({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
  riskDelta: fc.float({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
})

const measurementArb = fc.record({
  proposalId: fc.string({ minLength: 1, maxLength: 20 }),
  proposalAction: fc.constantFrom(
    "birth" as const,
    "promote" as const,
    "demote" as const,
    "retire" as const,
    "merge" as const,
    "split" as const,
  ),
  predicted: deltaArb,
  actual: deltaArb,
  sampleSize: fc.integer({ min: 1, max: 10_000 }),
})

describe("TruthAudit — property-based invariants", () => {
  it("never crashes on arbitrary measurement input", () => {
    fc.assert(
      fc.property(measurementArb, (m) => {
        const ta = new TruthAudit()
        const rec = ta.recordMeasurement(m)
        expect(rec.proposalId).toBe(m.proposalId)
        expect(rec.sampleSize).toBe(m.sampleSize)
      }),
      { numRuns: 100 },
    )
  })

  it("verify() never throws on any proposal id, even with zero measurements", () => {
    fc.assert(
      fc.property(fc.string(), (proposalId) => {
        const ta = new TruthAudit()
        const v = ta.verify(proposalId)
        expect(v).toBeNull()
      }),
      { numRuns: 50 },
    )
  })

  it("predicted and actual deltas round-trip through recordMeasurement unchanged", () => {
    fc.assert(
      fc.property(measurementArb, (m) => {
        const ta = new TruthAudit()
        const rec = ta.recordMeasurement(m)
        expect(rec.proposalAction).toBe(m.proposalAction)
        expect(rec.predicted).toEqual(m.predicted)
        expect(rec.actual).toEqual(m.actual)
      }),
      { numRuns: 100 },
    )
  })

  it("with enough measurements of identical data, verify() is not null", () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 10 }), measurementArb, (n, m) => {
        const ta = new TruthAudit({ config: { minSampleSize: 3 } })
        for (let i = 0; i < n; i++) {
          ta.recordMeasurement(m)
        }
        const v = ta.verify(m.proposalId)
        expect(v).not.toBeNull()
        expect([
          "accurate",
          "over_predicted",
          "under_predicted",
          "calibration_drift",
        ]).toContain(v?.verdict)
      }),
      { numRuns: 30 },
    )
  })
})