/**
 * Unit tests for the Memory panel's pure model layer (memory-model.ts). All
 * inputs are passthrough JSON — the tests pin the defensive behavior for
 * garbage, the bucket normalization (legacy string[] vs MemoryEntry[]) and
 * the gating inference semantics (which must match packages/evolution
 * `AgentMemoryStore.gatingDecisions`: skip iff samples ≥ 3 AND mean < −0.25,
 * strictly).
 */

import { describe, it, expect, vi } from "vitest"

vi.mock("ink", () => ({
  Box: () => null,
  Text: () => null,
  useInput: () => undefined,
  useStdout: () => ({ write: () => {} }),
}))

import {
  MEMORY_BUCKETS,
  MEMORY_GATING_EPS,
  MEMORY_GATING_MIN_SAMPLES,
  MEMORY_PREVIEW_LENGTH,
  buildMemoryExport,
  cycleEfficacyFilter,
  efficacyLedger,
  EFFICACY_FILTERS,
  filterBuckets,
  formatSigned,
  inferGating,
  memoryBuckets,
  memoryExportJson,
  memoryPanelView,
  normalizeMemoryEntry,
  sortEfficacy,
  truncateEntryPreview,
  type EfficacyRowView,
  type MemoryBucketKey,
} from "../src/components/memory-model"

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { mime: "text/plain", content: "keep summaries short", ...overrides }
}

describe("thresholds are exported and match the engine", () => {
  it("pins eps and minSamples to the evolution gatingDecisions defaults", () => {
    expect(MEMORY_GATING_EPS).toBe(0.25)
    expect(MEMORY_GATING_MIN_SAMPLES).toBe(3)
    expect(MEMORY_BUCKETS).toEqual([
      "userFeedback",
      "reviewSuggestions",
      "commonErrors",
      "goodExamples",
    ])
  })
})

describe("bucket normalization (legacy string[] and MemoryEntry[])", () => {
  it("keeps declared mimes and defaults missing ones to text/plain", () => {
    expect(normalizeMemoryEntry(entry({ mime: "application/json" }))).toEqual({
      mime: "application/json",
      content: "keep summaries short",
    })
    expect(normalizeMemoryEntry(entry({ mime: undefined }))).toEqual({
      mime: "text/plain",
      content: "keep summaries short",
    })
  })

  it("coerces legacy strings and primitive entries; drops outright garbage", () => {
    expect(normalizeMemoryEntry("forgot lockfile")).toEqual({
      mime: "text/plain",
      content: "forgot lockfile",
    })
    expect(normalizeMemoryEntry(42)).toEqual({ mime: "text/plain", content: "42" })
    expect(normalizeMemoryEntry(null)).toBeNull()
    expect(normalizeMemoryEntry(undefined)).toBeNull()
    expect(normalizeMemoryEntry(["array", "entry"])).toBeNull()
  })

  it("stringifies non-string object content and falls back for missing content", () => {
    expect(normalizeMemoryEntry({ content: { issues: ["x"] } })).toEqual({
      mime: "text/plain",
      content: '{"issues":["x"]}',
    })
    const fallback = normalizeMemoryEntry({ mime: "text/digest" })
    expect(fallback?.mime).toBe("text/digest")
    expect(JSON.parse(fallback!.content)).toEqual({ mime: "text/digest" })
  })

  it("normalizes all four buckets with keys, counts and mimes", () => {
    const buckets = memoryBuckets({
      userFeedback: ["a", { mime: "text/plain", content: "b" }],
      reviewSuggestions: "not-an-array",
      commonErrors: [{ mime: "text/digest", content: "[digest]" }],
      goodExamples: [null, 7],
    })
    expect(buckets.map((b) => [b.key, b.count])).toEqual([
      ["userFeedback", 2],
      ["reviewSuggestions", 0],
      ["commonErrors", 1],
      ["goodExamples", 1],
    ])
    expect(buckets[0]!.labelKey).toBe("tui.memory.bucket.userFeedback")
    expect(buckets[2]!.entries[0]!.mime).toBe("text/digest")
    expect(buckets[3]!.entries[0]!.content).toBe("7") // null dropped, 7 coerced
  })

  it("survives garbage memory shapes entirely", () => {
    for (const memory of [undefined, null, "junk", 42, [], { noBuckets: true }]) {
      const buckets = memoryBuckets(memory)
      expect(buckets).toHaveLength(4)
      expect(buckets.every((b) => b.count === 0)).toBe(true)
    }
  })
})

describe("entry preview truncation", () => {
  it("keeps short single-line content intact", () => {
    const { preview, isTruncated } = truncateEntryPreview("short note")
    expect(preview).toBe("short note")
    expect(isTruncated).toBe(false)
  })

  it("collapses whitespace and cuts at the limit with an ellipsis", () => {
    const long = `a
    b\t${"c".repeat(200)}`
    const { preview, isTruncated } = truncateEntryPreview(long)
    expect(isTruncated).toBe(true)
    expect(preview.length).toBe(MEMORY_PREVIEW_LENGTH + 1) // 80 chars + "…"
    expect(preview.endsWith("…")).toBe(true)
    expect(preview.startsWith("a b ccc")).toBe(true)
    // Exactly-at-limit content is NOT truncated.
    const exact = "x".repeat(MEMORY_PREVIEW_LENGTH)
    expect(truncateEntryPreview(exact)).toEqual({ preview: exact, isTruncated: false })
  })
})

describe("gating inference (mirrors evolution gatingDecisions)", () => {
  it("skips only with enough samples and mean strictly below −eps", () => {
    // 3 samples, mean −0.30 → skip.
    expect(inferGating({ injectedCount: 3, deltaSum: -0.9 })).toMatchObject({
      decision: "skip",
      evidence: "sufficient",
      mean: -0.3,
    })
    // Positive history injects.
    expect(inferGating({ injectedCount: 5, deltaSum: 2.5 }).decision).toBe("inject")
  })

  it("treats mean exactly −0.25 as inject (the engine's strict `<`)", () => {
    const exact = inferGating({ injectedCount: 4, deltaSum: -1 })
    expect(exact.mean).toBe(-MEMORY_GATING_EPS)
    expect(exact.decision).toBe("inject")
    expect(exact.evidence).toBe("sufficient")
    // One epsilon lower flips to skip.
    expect(inferGating({ injectedCount: 4, deltaSum: -1.01 }).decision).toBe("skip")
    // The same boundary at exactly minSamples.
    const atMin = inferGating({ injectedCount: MEMORY_GATING_MIN_SAMPLES, deltaSum: -0.75 })
    expect(atMin.decision).toBe("inject")
    expect(inferGating({ injectedCount: 3, deltaSum: -0.76 }).decision).toBe("skip")
  })

  it("never skips with fewer than 3 samples — 2 vs 3 is the evidence line", () => {
    const two = inferGating({ injectedCount: 2, deltaSum: -4 })
    expect(two.mean).toBe(-2) // strongly negative...
    expect(two.decision).toBe("inject") // ...but not enough evidence to gate
    expect(two.evidence).toBe("insufficient")
    const three = inferGating({ injectedCount: 3, deltaSum: -6 })
    expect(three.decision).toBe("skip")
    expect(three.evidence).toBe("sufficient")
  })

  it("handles missing, empty and zero records as unobserved injects", () => {
    expect(inferGating(undefined)).toEqual({
      injectedCount: 0,
      deltaSum: 0,
      mean: 0,
      decision: "inject",
      evidence: "insufficient",
      observed: false,
    })
    expect(inferGating({ injectedCount: 0, deltaSum: 0 })).toMatchObject({
      decision: "inject",
      evidence: "insufficient",
      observed: true,
    })
  })

  it("degrades defensive garbage per-field instead of throwing", () => {
    for (const record of ["junk", 42, [], true, { injectedCount: "3", deltaSum: null }]) {
      expect(inferGating(record)).toMatchObject({
        injectedCount: 0,
        deltaSum: 0,
        mean: 0,
        decision: "inject",
        evidence: "insufficient",
      })
    }
    // Negative and non-finite counts clamp to 0; NaN delta degrades to 0.
    expect(inferGating({ injectedCount: -5, deltaSum: 10 }).injectedCount).toBe(0)
    expect(inferGating({ injectedCount: Number.NaN, deltaSum: 1 }).injectedCount).toBe(0)
    const nanSum = inferGating({ injectedCount: 2, deltaSum: Number.NaN })
    expect(nanSum.deltaSum).toBe(0)
    expect(nanSum.mean).toBe(0)
  })
})

describe("efficacy ledger (per-bucket rows with gating badges)", () => {
  it("lists buckets with entries or evidence, in MEMORY_BUCKETS order", () => {
    const ledger = efficacyLedger({
      userFeedback: ["keep it short"],
      reviewSuggestions: [], // no entries, no record → omitted
      commonErrors: ["err"],
      goodExamples: ["example"],
      efficacy: {
        commonErrors: { injectedCount: 3, deltaSum: -0.9 },
        goodExamples: { injectedCount: 2, deltaSum: 1 },
        userFeedback: { injectedCount: 4, deltaSum: -1 }, // exactly −0.25 → inject
      },
    })
    expect(ledger.map((r) => r.bucket)).toEqual(["userFeedback", "commonErrors", "goodExamples"])
    expect(ledger[0]).toMatchObject({ decision: "inject", mean: -0.25 })
    expect(ledger[1]).toMatchObject({ decision: "skip", mean: -0.3 })
    expect(ledger[2]).toMatchObject({ decision: "inject", evidence: "insufficient" })
  })

  it("shows entries-without-efficacy rows and survives garbage memory", () => {
    const ledger = efficacyLedger({ commonErrors: ["err"] })
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({
      bucket: "commonErrors",
      injectedCount: 0,
      decision: "inject",
      observed: false,
    })
    expect(efficacyLedger(undefined)).toEqual([])
    expect(efficacyLedger({ userFeedback: [], efficacy: { nope: {} } })).toEqual([])
  })
})

describe("panel view (flat entries + totals)", () => {
  it("flattens entries across buckets in bucket order and prefers declared totals", () => {
    const view = memoryPanelView({
      role: "backend",
      memory: {
        userFeedback: ["a"],
        commonErrors: ["b", "c"],
        totalEntries: 99,
      },
    })
    expect(view.role).toBe("backend")
    expect(view.totalEntries).toBe(99)
    expect(view.flatEntries.map((e) => e.key)).toEqual([
      "userFeedback:0",
      "commonErrors:0",
      "commonErrors:1",
    ])
    expect(view.flatEntries.every((e) => e.preview.length > 0)).toBe(true)
  })

  it("falls back to the counted total and survives garbage profiles", () => {
    const view = memoryPanelView({ role: "review", memory: { goodExamples: ["g"] } })
    expect(view.totalEntries).toBe(1)
    const empty = memoryPanelView(null)
    expect(empty).toMatchObject({ role: "", totalEntries: 0, flatEntries: [], efficacy: [] })
    expect(empty.buckets).toHaveLength(4)
  })
})

describe("export (e key → clipboard JSON)", () => {
  it("builds a full doc with buckets, ledger decisions and the injected clock", () => {
    const now = new Date("2026-09-25T00:00:00.000Z")
    const doc = buildMemoryExport(
      "backend",
      {
        role: "backend",
        memory: {
          userFeedback: [{ mime: "text/plain", content: "short" }],
          commonErrors: ["err"],
          efficacy: { commonErrors: { injectedCount: 3, deltaSum: -0.9 } },
        },
      },
      now,
    )
    expect(doc.role).toBe("backend")
    expect(doc.exportedAt).toBe("2026-09-25T00:00:00.000Z")
    expect(doc.totalEntries).toBe(2)
    expect(doc.buckets[0]).toEqual({
      key: "userFeedback",
      count: 1,
      entries: [{ mime: "text/plain", content: "short" }],
    })
    // userFeedback also gets a ledger row (entries, no evidence yet); the
    // commonErrors row is the gated one.
    expect(doc.efficacy).toEqual([
      {
        bucket: "userFeedback",
        injectedCount: 0,
        deltaSum: 0,
        mean: 0,
        decision: "inject",
      },
      {
        bucket: "commonErrors",
        injectedCount: 3,
        deltaSum: -0.9,
        mean: -0.3,
        decision: "skip",
      },
    ])
    const parsed = JSON.parse(memoryExportJson(doc)) as typeof doc
    expect(parsed).toEqual(doc)
  })

  it("exports an empty-but-valid doc for garbage profiles and bad dates", () => {
    const doc = buildMemoryExport("", null, new Date(Number.NaN))
    expect(doc.role).toBe("")
    expect(doc.totalEntries).toBe(0)
    expect(doc.buckets.every((b) => b.count === 0)).toBe(true)
    expect(doc.efficacy).toEqual([])
    expect(() => memoryExportJson(doc)).not.toThrow()
    expect(new Date(doc.exportedAt).getTime()).not.toBeNaN()
  })
})

describe("formatSigned (ledger cell formatting)", () => {
  it("formats finite numbers with an explicit sign and degrades garbage to +0.00", () => {
    expect(formatSigned(0.42)).toBe("+0.42")
    expect(formatSigned(-1.25)).toBe("-1.25")
    expect(formatSigned(0)).toBe("+0.00")
    expect(formatSigned(undefined)).toBe("+0.00")
    expect(formatSigned(Number.NaN)).toBe("+0.00")
    expect(formatSigned("junk")).toBe("+0.00")
  })
})

// ── Deepened panel: worst-first ledger sort + f-key bucket filter ──────────

function ledgerRow(
  bucket: MemoryBucketKey,
  overrides: Partial<EfficacyRowView> = {},
): EfficacyRowView {
  return {
    bucket,
    labelKey: `tui.memory.bucket.${bucket}`,
    injectedCount: 0,
    deltaSum: 0,
    mean: 0,
    decision: "inject",
    evidence: "insufficient",
    observed: false,
    ...overrides,
  }
}

describe("sortEfficacy (worst-first ledger ordering)", () => {
  it("sorts by mean ascending — the worst (most negative) bucket heads the list", () => {
    const sorted = sortEfficacy([
      ledgerRow("goodExamples", { mean: 0.4, decision: "inject" }),
      ledgerRow("commonErrors", { mean: -0.9, decision: "skip" }),
      ledgerRow("userFeedback", { mean: -0.1, decision: "inject" }),
    ])
    expect(sorted.map((r) => r.bucket)).toEqual(["commonErrors", "userFeedback", "goodExamples"])
  })

  it("breaks mean ties by evidence (more samples first), then MEMORY_BUCKETS order", () => {
    const sorted = sortEfficacy([
      ledgerRow("goodExamples", { mean: 0, injectedCount: 1 }),
      ledgerRow("reviewSuggestions", { mean: 0, injectedCount: 5 }),
      ledgerRow("userFeedback", { mean: 0, injectedCount: 5 }),
    ])
    // userFeedback and reviewSuggestions tie at mean 0 / 5 samples → the
    // earlier MEMORY_BUCKETS slot wins; goodExamples has less evidence.
    expect(sorted.map((r) => r.bucket)).toEqual([
      "userFeedback",
      "reviewSuggestions",
      "goodExamples",
    ])
  })

  it("degrades garbage rows per-field and drops rows without a valid bucket", () => {
    const sorted = sortEfficacy([
      null,
      "junk",
      42,
      [],
      { bucket: "nope", mean: -5 }, // unknown bucket → unlabeled → dropped
      { bucket: "commonErrors", mean: "x", injectedCount: "3", observed: "yes" },
      { bucket: "userFeedback", mean: Number.NaN, decision: "skip" },
    ])
    expect(sorted).toEqual([
      {
        bucket: "userFeedback",
        labelKey: "tui.memory.bucket.userFeedback",
        injectedCount: 0,
        deltaSum: 0,
        mean: 0,
        // decision "skip" is kept (it is a real enum value), the rest degraded.
        decision: "skip",
        evidence: "insufficient",
        observed: false,
      },
      {
        bucket: "commonErrors",
        labelKey: "tui.memory.bucket.commonErrors",
        injectedCount: 0,
        deltaSum: 0,
        mean: 0,
        decision: "inject",
        evidence: "insufficient",
        observed: false,
      },
    ])
    // Mean tie at 0 with equal counts → bucket order broke the tie.
    expect(sorted.map((r) => r.bucket)).toEqual(["userFeedback", "commonErrors"])
    expect(sortEfficacy(undefined)).toEqual([])
    expect(sortEfficacy({ 0: ledgerRow("commonErrors") })).toEqual([])
  })

  it("never mutates the input array (pure sort)", () => {
    const input = [ledgerRow("commonErrors", { mean: -1 }), ledgerRow("userFeedback", { mean: 1 })]
    const snapshot = input.map((r) => ({ ...r }))
    const sorted = sortEfficacy(input)
    expect(input).toEqual(snapshot)
    expect(sorted).not.toBe(input)
  })
})

describe("filterBuckets + cycleEfficacyFilter (the f-key bucket filter)", () => {
  const rows: EfficacyRowView[] = [
    ledgerRow("commonErrors", { mean: -0.9, decision: "skip", evidence: "sufficient" }),
    ledgerRow("userFeedback", { mean: -0.1 }),
    ledgerRow("goodExamples", { mean: 0.4 }),
  ]

  it("keeps everything on all, only gated rows on skip-only, only injecting on inject-only", () => {
    expect(filterBuckets(rows, "all").map((r) => r.bucket)).toEqual([
      "commonErrors",
      "userFeedback",
      "goodExamples",
    ])
    expect(filterBuckets(rows, "skip-only").map((r) => r.bucket)).toEqual(["commonErrors"])
    expect(filterBuckets(rows, "inject-only").map((r) => r.bucket)).toEqual([
      "userFeedback",
      "goodExamples",
    ])
  })

  it("reads a garbage mode as all, drops non-object rows, survives non-array input", () => {
    expect(filterBuckets(rows, "junk")).toHaveLength(3)
    expect(filterBuckets(rows, undefined)).toHaveLength(3)
    expect(filterBuckets([rows[0], null, 42, "junk"], "skip-only")).toEqual([rows[0]])
    expect(filterBuckets(undefined, "skip-only")).toEqual([])
    expect(filterBuckets({ 0: rows[0] }, "all")).toEqual([])
  })

  it("cycles all → skip-only → inject-only → all; unknown modes start at all", () => {
    expect(EFFICACY_FILTERS).toEqual(["all", "skip-only", "inject-only"])
    expect(cycleEfficacyFilter("all")).toBe("skip-only")
    expect(cycleEfficacyFilter("skip-only")).toBe("inject-only")
    expect(cycleEfficacyFilter("inject-only")).toBe("all")
    for (const garbage of [undefined, null, "junk", 42]) {
      expect(cycleEfficacyFilter(garbage)).toBe("all")
    }
  })

  it("composes with the ledger and sortEfficacy exactly like the panel uses it", () => {
    const ledger = efficacyLedger({
      commonErrors: ["err"],
      goodExamples: ["example"],
      efficacy: {
        commonErrors: { injectedCount: 3, deltaSum: -0.9 }, // mean −0.3 → skip
        goodExamples: { injectedCount: 4, deltaSum: 1.2 }, // mean +0.3 → inject
      },
    })
    // Worst-first: the gated commonErrors row comes before goodExamples.
    expect(sortEfficacy(ledger).map((r) => r.bucket)).toEqual(["commonErrors", "goodExamples"])
    // skip-only keeps only the gated bucket, still in sorted position.
    expect(filterBuckets(sortEfficacy(ledger), "skip-only").map((r) => r.bucket)).toEqual([
      "commonErrors",
    ])
    // inject-only drops it.
    expect(filterBuckets(sortEfficacy(ledger), "inject-only").map((r) => r.bucket)).toEqual([
      "goodExamples",
    ])
  })
})
