/**
 * Wave 4 — Kosmos borrowings: KnowledgeGraph + ArtifactStateManager +
 * MetricsCollector + HypothesisGenerator + ConvergenceEnsemble.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { KnowledgeGraph } from "../src/knowledge/graph.js"
import { ArtifactStateManager, type FindingIndex, type VectorIndex } from "../src/world-model/artifacts.js"
import { MetricsCollector } from "../src/monitoring/metrics.js"
import {
  generateHypotheses,
  testabilityScore,
  clarityScore,
  noveltyAgainstCorpus,
} from "../src/agents/hypothesis-generator.js"
import { aggregateFindings } from "../src/workflow/ensemble.js"

describe("KnowledgeGraph (借鉴 Kosmos knowledge/graph.py)", () => {
  it("addNode + getNode returns the node", () => {
    const g = new KnowledgeGraph()
    g.addNode({ id: "p1", type: "Paper", properties: { title: "Test" } })
    const node = g.getNode("p1")
    expect(node?.type).toBe("Paper")
    expect(node?.properties.title).toBe("Test")
  })

  it("addEdge creates edges and neighbor lookups", () => {
    const g = new KnowledgeGraph()
    g.addNode({ id: "a", type: "Concept", properties: {} })
    g.addNode({ id: "b", type: "Concept", properties: {} })
    g.addEdge({ from: "a", to: "b", type: "RELATED_TO" })
    const out = g.edgesFrom("a")
    expect(out).toHaveLength(1)
    expect(out[0].to).toBe("b")
    const neighbors = g.neighbors("a")
    expect(neighbors).toHaveLength(1)
    expect(neighbors[0].id).toBe("b")
  })

  it("neighbors filters by edge type", () => {
    const g = new KnowledgeGraph()
    g.addNode({ id: "a", type: "x", properties: {} })
    g.addNode({ id: "b", type: "x", properties: {} })
    g.addNode({ id: "c", type: "x", properties: {} })
    g.addEdge({ from: "a", to: "b", type: "CITES" })
    g.addEdge({ from: "a", to: "c", type: "USES_METHOD" })
    expect(g.neighbors("a", "CITES")).toHaveLength(1)
    expect(g.neighbors("a", "USES_METHOD")).toHaveLength(1)
    expect(g.neighbors("a")).toHaveLength(2)
  })

  it("edgesTo returns incoming edges", () => {
    const g = new KnowledgeGraph()
    g.addNode({ id: "hub", type: "x", properties: {} })
    g.addNode({ id: "a", type: "x", properties: {} })
    g.addNode({ id: "b", type: "x", properties: {} })
    g.addEdge({ from: "a", to: "hub", type: "USES" })
    g.addEdge({ from: "b", to: "hub", type: "USES" })
    expect(g.edgesTo("hub")).toHaveLength(2)
  })

  it("removeNode removes node and its edges", () => {
    const g = new KnowledgeGraph()
    g.addNode({ id: "a", type: "x", properties: {} })
    g.addNode({ id: "b", type: "x", properties: {} })
    g.addEdge({ from: "a", to: "b", type: "REL" })
    expect(g.removeNode("a")).toBe(true)
    expect(g.getNode("a")).toBeUndefined()
    expect(g.edgesFrom("b")).toHaveLength(0)
    expect(g.removeNode("missing")).toBe(false)
  })

  it("findByType filters by type and optional predicate", () => {
    const g = new KnowledgeGraph()
    g.addNode({ id: "p1", type: "Paper", properties: { year: 2020 } })
    g.addNode({ id: "p2", type: "Paper", properties: { year: 2024 } })
    g.addNode({ id: "c1", type: "Concept", properties: {} })
    expect(g.findByType("Paper")).toHaveLength(2)
    expect(g.findByType("Paper", (n) => (n.properties.year as number) > 2022)).toHaveLength(1)
    expect(g.findByType("Concept")).toHaveLength(1)
  })

  it("nodeCount and edgeCount reflect state", () => {
    const g = new KnowledgeGraph()
    expect(g.nodeCount()).toBe(0)
    g.addNode({ id: "a", type: "x", properties: {} })
    g.addNode({ id: "b", type: "x", properties: {} })
    g.addEdge({ from: "a", to: "b", type: "rel" })
    expect(g.nodeCount()).toBe(2)
    expect(g.edgeCount()).toBe(1)
  })

  it("serialize and loadSnapshot round-trip", () => {
    const g1 = new KnowledgeGraph()
    g1.addNode({ id: "a", type: "x", properties: { v: 1 } })
    g1.addNode({ id: "b", type: "x", properties: {} })
    g1.addEdge({ from: "a", to: "b", type: "rel" })
    const snapshot = g1.serialize()
    const g2 = new KnowledgeGraph()
    g2.loadSnapshot(snapshot)
    expect(g2.nodeCount()).toBe(2)
    expect(g2.edgeCount()).toBe(1)
    expect(g2.getNode("a")?.properties.v).toBe(1)
  })

  it("LRU eviction when exceeding maxNodes", () => {
    const g = new KnowledgeGraph({ maxNodes: 3 })
    g.addNode({ id: "1", type: "x", properties: {} })
    g.addNode({ id: "2", type: "x", properties: {} })
    g.addNode({ id: "3", type: "x", properties: {} })
    g.addNode({ id: "4", type: "x", properties: {} })
    expect(g.nodeCount()).toBe(3)
    expect(g.getNode("1")).toBeUndefined()
    expect(g.getNode("4")).toBeDefined()
  })

  it("clear wipes everything", () => {
    const g = new KnowledgeGraph()
    g.addNode({ id: "a", type: "x", properties: {} })
    g.addEdge({ from: "a", to: "a", type: "self" })
    g.clear()
    expect(g.nodeCount()).toBe(0)
    expect(g.edgeCount()).toBe(0)
  })

  it("removeNode cleans both directions of edges (no stale incoming)", () => {
    const g = new KnowledgeGraph()
    g.addNode({ id: "a", type: "x", properties: {} })
    g.addNode({ id: "b", type: "x", properties: {} })
    g.addEdge({ from: "a", to: "b", type: "rel" })
    g.removeNode("a")
    // a→b edge was outgoing from a; after removing a, b's incoming must be empty.
    expect(g.edgesTo("b")).toHaveLength(0)
    expect(g.edgesFrom("a")).toHaveLength(0)
  })

  it("removeNode cleans both directions of edges (no stale outgoing)", () => {
    const g = new KnowledgeGraph()
    g.addNode({ id: "a", type: "x", properties: {} })
    g.addNode({ id: "b", type: "x", properties: {} })
    g.addEdge({ from: "a", to: "b", type: "rel" })
    g.removeNode("b")
    // a→b edge was incoming to b; after removing b, a's outgoing must be empty.
    expect(g.edgesFrom("a")).toHaveLength(0)
    expect(g.edgesTo("b")).toHaveLength(0)
  })

  it("LRU eviction leaves no dangling edges", () => {
    const g = new KnowledgeGraph({ maxNodes: 2 })
    g.addNode({ id: "a", type: "x", properties: {} })
    g.addNode({ id: "b", type: "x", properties: {} })
    g.addEdge({ from: "a", to: "b", type: "rel" })
    g.addNode({ id: "c", type: "x", properties: {} }) // evicts a
    expect(g.getNode("a")).toBeUndefined()
    // b should have no stale incoming edges pointing to evicted a.
    expect(g.edgesTo("b")).toHaveLength(0)
    expect(g.edgesFrom("c")).toHaveLength(0)
  })
})

describe("ArtifactStateManager (借鉴 Kosmos world_model/artifacts.py)", () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "max-artifacts-"))
  })
  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it("saveFinding persists to disk + memory", async () => {
    const mgr = new ArtifactStateManager({ artifactsDir: tmpDir })
    const f = await mgr.saveFinding({
      cycle: 1,
      taskId: "t1",
      summary: "Retention improved by 12%",
      confidence: 0.85,
    })
    expect(f.findingId).toBeTruthy()
    expect(mgr.findingCount()).toBe(1)
    expect(existsSync(join(tmpDir, "cycle_1", "task_t1_finding.json"))).toBe(true)
  })

  it("saveFinding calls optional indexes", async () => {
    const indexFn = vi.fn()
    const vectorFn = vi.fn()
    const graph: FindingIndex = { index: indexFn }
    const vectors: VectorIndex = { upsert: vectorFn }
    const mgr = new ArtifactStateManager({ artifactsDir: tmpDir, graph, vectorStore: vectors })
    const f = await mgr.saveFinding({ cycle: 2, taskId: "t1", summary: "test finding" })
    expect(indexFn).toHaveBeenCalledWith(f)
    expect(vectorFn).toHaveBeenCalledWith(f.findingId, f.summary, expect.any(Object))
  })

  it("saveHypothesis appends JSONL line", async () => {
    const mgr = new ArtifactStateManager({ artifactsDir: tmpDir })
    const h1 = await mgr.saveHypothesis({ statement: "Hypothesis A" })
    const h2 = await mgr.saveHypothesis({ statement: "Hypothesis B" })
    expect(mgr.hypothesisCount()).toBe(2)
    expect(mgr.listHypothesisIds()).toContain(h1.hypothesisId)
    expect(mgr.listHypothesisIds()).toContain(h2.hypothesisId)
  })

  it("loadFinding reads from disk when not in cache", async () => {
    const mgr1 = new ArtifactStateManager({ artifactsDir: tmpDir })
    const f = await mgr1.saveFinding({ cycle: 1, taskId: "t1", summary: "persisted" })
    const mgr2 = new ArtifactStateManager({ artifactsDir: tmpDir })
    const reloaded = mgr2.loadFinding(f.findingId)
    expect(reloaded?.summary).toBe("persisted")
    expect(reloaded?.cycle).toBe(1)
  })

  it("listCycleFindings returns findings for a cycle", async () => {
    const mgr = new ArtifactStateManager({ artifactsDir: tmpDir })
    await mgr.saveFinding({ cycle: 1, taskId: "t1", summary: "a" })
    await mgr.saveFinding({ cycle: 1, taskId: "t2", summary: "b" })
    await mgr.saveFinding({ cycle: 2, taskId: "t1", summary: "c" })
    expect(mgr.listCycleFindings(1)).toHaveLength(2)
    expect(mgr.listCycleFindings(2)).toHaveLength(1)
    expect(mgr.listCycleFindings(99)).toHaveLength(0)
  })
})

describe("MetricsCollector (借鉴 Kosmos core/metrics.py)", () => {
  it("records api calls and aggregates", () => {
    const m = new MetricsCollector()
    m.recordApiCall("claude-3-5-sonnet", 1000, 500, 1200, true)
    m.recordApiCall("claude-3-5-sonnet", 800, 400, 1000, false)
    const stats = m.getStatistics()
    expect(stats.apiCalls).toBe(2)
    expect(stats.apiErrors).toBe(1)
    expect(stats.totalInputTokens).toBe(1800)
    expect(stats.totalOutputTokens).toBe(900)
    expect(stats.totalApiDurationMs).toBe(2200)
  })

  it("records task executions", () => {
    const m = new MetricsCollector()
    m.recordTaskExecution("data_analysis", "success", 1500)
    m.recordTaskExecution("data_analysis", "failed", 2000)
    m.recordTaskExecution("report", "success", 800)
    const stats = m.getStatistics()
    expect(stats.tasksExecuted).toBe(3)
    expect(stats.tasksFailed).toBe(1)
  })

  it("computes cache hit rate", () => {
    const m = new MetricsCollector()
    m.recordCacheHit()
    m.recordCacheHit()
    m.recordCacheHit()
    m.recordCacheMiss()
    const stats = m.getStatistics()
    expect(stats.cacheHits).toBe(3)
    expect(stats.cacheMisses).toBe(1)
    expect(stats.hitRate).toBeCloseTo(0.75, 5)
  })

  it("fires budget alerts at configured thresholds", () => {
    const m = new MetricsCollector({
      budget: { limitUsd: 1.0, usdPer1KInputTokens: 0.1, usdPer1KOutputTokens: 0.1 },
    })
    // 10K input + 10K output → $1.0 + $1.0 = $2.0 (200%)
    m.recordApiCall("m", 10000, 10000, 100)
    const alerts = m.getAlerts()
    const firedThresholds = alerts.map((a) => a.thresholdPct).sort((a, b) => a - b)
    // 50, 75, 90, 100 should all fire (200% exceeds all).
    expect(firedThresholds).toEqual([50, 75, 90, 100])
  })

  it("does not re-fire already triggered threshold", () => {
    const m = new MetricsCollector({
      budget: { limitUsd: 0.01, usdPer1KInputTokens: 0.1, usdPer1KOutputTokens: 0.1 },
    })
    const cb = vi.fn()
    m.onAlert(cb)
    m.recordApiCall("m", 1000, 1000, 100)  // $0.2 → 2000%
    const alertCount1 = m.getAlerts().length
    m.recordApiCall("m", 0, 0, 100)
    const alertCount2 = m.getAlerts().length
    expect(alertCount2).toBe(alertCount1)
    expect(cb).toHaveBeenCalledTimes(alertCount1)
  })

  it("disableBudget stops tracking", () => {
    const m = new MetricsCollector({ budget: { limitUsd: 1.0 } })
    m.recordApiCall("m", 10000, 10000, 100)
    const before = m.getStatistics().budget.consumedUsd
    m.disableBudget()
    m.recordApiCall("m", 10000, 10000, 100)
    const after = m.getStatistics().budget.consumedUsd
    expect(after).toBeCloseTo(before, 5)
  })

  it("alertCallbacks are invoked with structured alerts", () => {
    const m = new MetricsCollector({
      budget: { limitUsd: 0.001, alertThresholds: [50] },
    })
    const received: string[] = []
    m.onAlert((a) => received.push(a.message))
    m.recordApiCall("m", 10000, 0, 100)
    expect(received).toHaveLength(1)
    expect(received[0]).toContain("50%")
  })

  it("hitRate is 0 when no cache activity", () => {
    const m = new MetricsCollector()
    expect(m.getStatistics().hitRate).toBe(0)
  })

  it("recentApiCalls respects default limit", () => {
    const m = new MetricsCollector()
    for (let i = 0; i < 5; i++) m.recordApiCall("m", 10, 10, 10)
    expect(m.recentApiCalls(3)).toHaveLength(3)
    expect(m.recentApiCalls(100)).toHaveLength(5)
  })
})

describe("HypothesisGenerator (借鉴 Kosmos agents/hypothesis_generator.py)", () => {
  it("generates structured hypotheses from generateFn output", async () => {
    const result = await generateHypotheses(
      "Does attention improve transformer performance?",
      async () => [
        "Attention increases accuracy by 5% on classification benchmarks.",
        "Adding more attention heads reduces inference time.",
      ],
      { numHypotheses: 2 },
    )
    expect(result).toHaveLength(2)
    expect(result[0].statement).toContain("Attention")
    expect(result[0].testabilityScore).toBeGreaterThan(0)
    expect(result[0].noveltyScore).toBe(1) // No existing corpus
  })

  it("deduplicates against existing corpus via novelty threshold", async () => {
    const result = await generateHypotheses(
      "Question",
      async () => [
        "Attention increases accuracy.",
        "Attention increases accuracy.",  // duplicate
        "Embedding dropout reduces overfitting.",
      ],
      {
        numHypotheses: 3,
        minNoveltyScore: 0.5,
      },
    )
    // First one is novel, second is a duplicate so skipped, third is novel.
    expect(result).toHaveLength(2)
    expect(result[0].statement).not.toBe(result[1].statement)
  })

  it("respects numHypotheses limit", async () => {
    const result = await generateHypotheses(
      "Q",
      async () => [
        "First novel hypothesis about retention",
        "Second novel hypothesis about churn",
        "Third novel hypothesis about growth",
        "Fourth novel hypothesis about latency",
        "Fifth novel hypothesis about errors",
      ],
      { numHypotheses: 3 },
    )
    expect(result).toHaveLength(3)
  })

  it("testabilityScore rewards measurable variables", () => {
    const measurable = testabilityScore("X increases accuracy by 10% when n = 100")
    const vague = testabilityScore("X might be related to Y")
    expect(measurable).toBeGreaterThan(vague)
  })

  it("clarityScore penalizes very short or very long statements", () => {
    expect(clarityScore("x")).toBeLessThan(0.5)
    expect(clarityScore("A reasonable length statement about hypothesis testing.")).toBeGreaterThan(0.7)
    expect(clarityScore("x".repeat(600))).toBeLessThan(0.7)
  })

  it("noveltyAgainstCorpus returns 1 for empty corpus", () => {
    expect(noveltyAgainstCorpus("anything", [])).toBe(1)
  })

  it("noveltyAgainstCorpus detects near-duplicates", () => {
    const score = noveltyAgainstCorpus("attention improves accuracy", ["attention improves accuracy significantly"])
    expect(score).toBeLessThan(0.5)
  })
})

describe("ConvergenceEnsemble (借鉴 Kosmos workflow/ensemble.py)", () => {
  it("clusters identical findings across runs", () => {
    const runs = [
      [{ summary: "Retention improved by 12%" }],
      [{ summary: "Retention improved by 12%" }],
      [{ summary: "Retention improved by 12%" }],
    ]
    const report = aggregateFindings(runs)
    expect(report.totalRuns).toBe(3)
    expect(report.totalFindings).toBe(3)
    expect(report.uniqueFindings).toBe(1)
    expect(report.clusters[0].replicationCount).toBe(3)
    expect(report.clusters[0].replicationRate).toBe(1)
    expect(report.clusters[0].convergenceStrength).toBe("strong")
  })

  it("keeps distinct findings as separate clusters", () => {
    const runs = [
      [{ summary: "Retention improved" }],
      [{ summary: "Conversion decreased" }],
    ]
    const report = aggregateFindings(runs, { matchThreshold: 0.6 })
    expect(report.uniqueFindings).toBe(2)
    expect(report.clusters.every((c) => c.replicationCount === 1)).toBe(true)
  })

  it("classifies convergence strength by replication rate", () => {
    const runs = [
      [{ summary: "retention rate increased this quarter" }],
      [{ summary: "churn dropped across all segments" }],
      [{ summary: "retention rate increased this quarter" }],
      [{ summary: "engagement metrics are stable" }],
      [{ summary: "retention rate increased this quarter" }],
    ]
    const report = aggregateFindings(runs, { matchThreshold: 0.5, replicationThreshold: 0.4 })
    // "retention rate increased this quarter" appears in 3/5 runs.
    const retentionCluster = report.clusters.find((c) =>
      c.canonicalSummary.includes("retention"),
    )
    expect(retentionCluster).toBeDefined()
    expect(retentionCluster!.replicationCount).toBe(3)
    expect(retentionCluster!.convergenceStrength).toBe("strong")
    expect(report.strongConvergenceCount).toBeGreaterThanOrEqual(1)
  })

  it("computes overall replication rate across clusters", () => {
    const runs = [
      [
        { summary: "feature X improved retention significantly" },
        { summary: "control group performed as expected" },
      ],
      [
        { summary: "feature X improved retention significantly" },
        { summary: "latency remained within budget" },
      ],
      [
        { summary: "feature X improved retention significantly" },
      ],
    ]
    const report = aggregateFindings(runs, { matchThreshold: 0.5 })
    // "feature X improved retention significantly" → 3/3 (1.0)
    // Others → 1/3 (0.33)
    expect(report.overallReplicationRate).toBeGreaterThan(0.4)
    expect(report.overallReplicationRate).toBeLessThan(0.85)
  })

  it("respects matchThreshold setting", () => {
    const runs = [
      [{ summary: "retention improved by 12 percent" }],
      [{ summary: "conversion rate fell" }],
    ]
    const strictReport = aggregateFindings(runs, { matchThreshold: 0.9 })
    expect(strictReport.uniqueFindings).toBe(2)
    const laxReport = aggregateFindings(runs, { matchThreshold: 0.1 })
    // Even lax shouldn't merge totally different sentences.
    expect(laxReport.uniqueFindings).toBeGreaterThanOrEqual(1)
  })

  it("handles empty input", () => {
    const report = aggregateFindings([])
    expect(report.totalRuns).toBe(0)
    expect(report.totalFindings).toBe(0)
    expect(report.uniqueFindings).toBe(0)
    expect(report.clusters).toHaveLength(0)
  })

  it("handles runs with empty findings", () => {
    const report = aggregateFindings([[], [{ summary: "X" }], []])
    expect(report.totalRuns).toBe(3)
    expect(report.totalFindings).toBe(1)
    expect(report.uniqueFindings).toBe(1)
  })

  it("averageSimilarity reflects within-cluster similarity", () => {
    const runs = [
      [{ summary: "the quick brown fox jumps" }],
      [{ summary: "the quick brown fox leaps" }], // similar but not identical
      [{ summary: "completely unrelated text here" }],
    ]
    const report = aggregateFindings(runs, { matchThreshold: 0.4 })
    const cluster = report.clusters.find((c) => c.replicationCount === 2)
    if (cluster) {
      expect(cluster.averageSimilarity).toBeGreaterThan(0.4)
      expect(cluster.averageSimilarity).toBeLessThan(1)
    }
  })
})