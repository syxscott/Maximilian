/**
 * ConvergenceEnsemble — multi-run semantic matching (借鉴 Kosmos workflow/ensemble.py).
 *
 * Kosmos's ConvergenceEnsemble runs the same research workflow N times with
 * different seeds/temperatures and aggregates findings by semantic similarity.
 * It reports replication rate, statistical consistency (effect-size CV,
 * significance agreement), and a convergence verdict per finding cluster.
 *
 * Maximilian adapts this as a pure-function aggregator:
 *   - aggregateFindings(runs, options) groups findings across runs by similarity
 *   - Computes per-cluster: replication count, replication rate, similarity mean
 *   - Computes overall convergence metrics
 *   - Returns a ConvergenceReport with matched findings + summary
 *
 * The actual multi-run execution stays in the caller; this module only
 * clusters and reports.
 */

export interface RunFinding {
  summary: string
  /** Optional numeric effect size (for CV calculation). */
  effectSize?: number
  /** Optional p-value (for significance agreement). */
  pValue?: number
  /** Optional ScholarEval score (for quality variance). */
  scholarScore?: number
  /** Free-form metadata (run id, tags, etc.). */
  metadata?: Record<string, unknown>
}

export interface ConvergenceOptions {
  /** Token-overlap threshold for matching findings across runs (default: 0.6). */
  matchThreshold?: number
  /** Replication rate >= this = strong convergence (default: 0.6 = 3 of 5 runs). */
  replicationThreshold?: number
}

export interface FindingCluster {
  matchId: string
  canonicalSummary: string
  matchedSummaries: string[]
  /** Indices into the runs array that contained this finding. */
  runIndices: number[]
  replicationCount: number
  replicationRate: number
  averageSimilarity: number
  /** "strong" if replicationRate >= replicationThreshold * 1.5; "moderate" if >= threshold; else "weak"/"none". */
  convergenceStrength: "strong" | "moderate" | "weak" | "none"
}

export interface ConvergenceReport {
  totalRuns: number
  totalFindings: number
  uniqueFindings: number
  clusters: FindingCluster[]
  overallReplicationRate: number
  strongConvergenceCount: number
  moderateConvergenceCount: number
  weakConvergenceCount: number
}

/**
 * Cluster findings across multiple runs by semantic similarity (Jaccard on
 * tokens). Returns a ConvergenceReport with per-cluster and aggregate stats.
 */
export function aggregateFindings(
  runs: ReadonlyArray<ReadonlyArray<RunFinding>>,
  options?: ConvergenceOptions,
): ConvergenceReport {
  const matchThreshold = options?.matchThreshold ?? 0.6
  const replicationThreshold = options?.replicationThreshold ?? 0.6
  const totalRuns = runs.length

  const allFindings: Array<{ runIdx: number; finding: RunFinding }> = []
  for (let i = 0; i < runs.length; i++) {
    for (const f of runs[i]) allFindings.push({ runIdx: i, finding: f })
  }
  const totalFindings = allFindings.length

  // Greedy clustering: each finding joins the first cluster whose canonical
  // summary has similarity >= matchThreshold; otherwise starts a new cluster.
  const clusters: Array<{
    canonical: string
    summaries: string[]
    runs: Set<number>
    similarities: number[]
  }> = []

  for (const { runIdx, finding } of allFindings) {
    let matched = -1
    for (let i = 0; i < clusters.length; i++) {
      const sim = jaccard(clusters[i].canonical, finding.summary)
      if (sim >= matchThreshold) {
        matched = i
        break
      }
    }
    if (matched === -1) {
      clusters.push({
        canonical: finding.summary,
        summaries: [finding.summary],
        runs: new Set([runIdx]),
        similarities: [],
      })
    } else {
      clusters[matched].summaries.push(finding.summary)
      clusters[matched].runs.add(runIdx)
      const sim = jaccard(clusters[matched].canonical, finding.summary)
      clusters[matched].similarities.push(sim)
    }
  }

  // Per-cluster stats.
  const reportClusters: FindingCluster[] = clusters.map((c, idx) => {
    const replicationCount = c.runs.size
    const replicationRate = totalRuns > 0 ? replicationCount / totalRuns : 0
    const averageSimilarity = c.similarities.length > 0
      ? c.similarities.reduce((a, b) => a + b, 0) / c.similarities.length
      : 1
    let strength: FindingCluster["convergenceStrength"] = "none"
    // Round to 4 decimals to avoid floating-point mismatch (0.4 * 1.5 = 0.6000000000000001).
    const strongThreshold = Math.round(replicationThreshold * 1.5 * 10000) / 10000
    const weakThreshold = Math.round(replicationThreshold * 0.5 * 10000) / 10000
    if (replicationRate >= strongThreshold) strength = "strong"
    else if (replicationRate >= replicationThreshold) strength = "moderate"
    else if (replicationRate >= weakThreshold) strength = "weak"
    return {
      matchId: `match-${idx}`,
      canonicalSummary: c.canonical,
      matchedSummaries: c.summaries,
      runIndices: Array.from(c.runs).sort((a, b) => a - b),
      replicationCount,
      replicationRate,
      averageSimilarity,
      convergenceStrength: strength,
    }
  })

  // Aggregate stats.
  const overallReplicationRate = reportClusters.length > 0
    ? reportClusters.reduce((acc, c) => acc + c.replicationRate, 0) / reportClusters.length
    : 0
  const strongCount = reportClusters.filter((c) => c.convergenceStrength === "strong").length
  const moderateCount = reportClusters.filter((c) => c.convergenceStrength === "moderate").length
  const weakCount = reportClusters.filter((c) => c.convergenceStrength === "weak").length

  return {
    totalRuns,
    totalFindings,
    uniqueFindings: reportClusters.length,
    clusters: reportClusters,
    overallReplicationRate,
    strongConvergenceCount: strongCount,
    moderateConvergenceCount: moderateCount,
    weakConvergenceCount: weakCount,
  }
}

/** Jaccard similarity between two strings on word tokens. */
function jaccard(a: string, b: string): number {
  const sa = new Set(a.toLowerCase().split(/\W+/).filter((t) => t.length > 1))
  const sb = new Set(b.toLowerCase().split(/\W+/).filter((t) => t.length > 1))
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  const union = sa.size + sb.size - inter
  return union === 0 ? 0 : inter / union
}