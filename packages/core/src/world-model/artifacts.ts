/**
 * ArtifactStateManager — JSON-backed finding/hypothesis persistence (借鉴 Kosmos world_model/artifacts.py).
 *
 * Kosmos's ArtifactStateManager persists findings and hypotheses to disk as
 * JSON artifacts in cycle-keyed directories, with optional indexing to a
 * knowledge graph and vector store. The 4-layer architecture (JSON, graph,
 * vectors, citations) provides human-readable state, traceability, and
 * fast retrieval.
 *
 * Maximilian adapts this as a file-backed persistence layer for findings
 * and hypotheses. Optional indexes (graph + vector store) can be plugged
 * in via the `KnowledgeGraph` and a pluggable `vectorIndex` interface.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"

export interface Finding {
  findingId: string
  cycle: number
  taskId: string
  summary: string
  /** Free-form statistics / metadata. */
  statistics?: Record<string, unknown>
  /** Evidence references (paths, ids). */
  evidence?: string[]
  /** Confidence score 0-1. */
  confidence?: number
  createdAt: string
}

export interface Hypothesis {
  hypothesisId: string
  statement: string
  rationale?: string
  testable?: boolean
  noveltyScore?: number
  relatedFindings?: string[]
  createdAt: string
}

/** Optional index for findings — implemented by callers. */
export interface FindingIndex {
  index(finding: Finding): void | Promise<void>
}

/** Optional vector index — pluggable. */
export interface VectorIndex {
  upsert(id: string, text: string, metadata?: Record<string, unknown>): void | Promise<void>
}

export interface ArtifactStateManagerOptions {
  artifactsDir?: string
  graph?: FindingIndex
  vectorStore?: VectorIndex
}

export class ArtifactStateManager {
  private readonly artifactsDir: string
  private readonly graph?: FindingIndex
  private readonly vectorStore?: VectorIndex
  private readonly findings = new Map<string, Finding>()
  private readonly hypotheses = new Map<string, Hypothesis>()

  constructor(options?: ArtifactStateManagerOptions) {
    this.artifactsDir = resolve(options?.artifactsDir ?? "./artifacts")
    this.graph = options?.graph
    this.vectorStore = options?.vectorStore
    mkdirSync(this.artifactsDir, { recursive: true })
  }

  /** Persist a finding to disk + memory + optional indexes. */
  async saveFinding(input: Omit<Finding, "createdAt" | "findingId"> & { findingId?: string }): Promise<Finding> {
    const finding: Finding = {
      findingId: input.findingId ?? `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      cycle: input.cycle,
      taskId: input.taskId,
      summary: input.summary,
      statistics: input.statistics,
      evidence: input.evidence,
      confidence: input.confidence,
      createdAt: new Date().toISOString(),
    }
    const cycleDir = join(this.artifactsDir, `cycle_${finding.cycle}`)
    mkdirSync(cycleDir, { recursive: true })
    const path = join(cycleDir, `task_${finding.taskId}_finding.json`)
    writeFileSync(path, JSON.stringify(finding, null, 2), "utf8")
    this.findings.set(finding.findingId, finding)
    if (this.graph) await this.graph.index(finding)
    if (this.vectorStore) {
      await this.vectorStore.upsert(finding.findingId, finding.summary, {
        cycle: finding.cycle,
        taskId: finding.taskId,
      })
    }
    return finding
  }

  /** Persist a hypothesis. */
  async saveHypothesis(input: Omit<Hypothesis, "createdAt" | "hypothesisId"> & { hypothesisId?: string }): Promise<Hypothesis> {
    const hyp: Hypothesis = {
      hypothesisId: input.hypothesisId ?? `h-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      statement: input.statement,
      rationale: input.rationale,
      testable: input.testable,
      noveltyScore: input.noveltyScore,
      relatedFindings: input.relatedFindings,
      createdAt: new Date().toISOString(),
    }
    const path = join(this.artifactsDir, "hypotheses.jsonl")
    const line = JSON.stringify(hyp) + "\n"
    writeFileSync(path, line, { flag: "a", encoding: "utf8" })
    this.hypotheses.set(hyp.hypothesisId, hyp)
    return hyp
  }

  /** Load a finding by id from in-memory cache or disk. */
  loadFinding(findingId: string): Finding | null {
    const cached = this.findings.get(findingId)
    if (cached) return cached
    return this.scanFindingsOnDisk().get(findingId) ?? null
  }

  /** Load a hypothesis by id from in-memory cache. */
  loadHypothesis(hypothesisId: string): Hypothesis | null {
    return this.hypotheses.get(hypothesisId) ?? null
  }

  /** List all findings in a cycle (from disk). */
  listCycleFindings(cycle: number): Finding[] {
    const cycleDir = join(this.artifactsDir, `cycle_${cycle}`)
    if (!existsSync(cycleDir)) return []
    const out: Finding[] = []
    for (const entry of readdirSync(cycleDir)) {
      if (!entry.endsWith(".json")) continue
      const content = readFileSync(join(cycleDir, entry), "utf8")
      try {
        out.push(JSON.parse(content) as Finding)
      } catch {
        // Skip malformed file.
      }
    }
    return out
  }

  /** List all hypothesis ids known in memory. */
  listHypothesisIds(): string[] {
    return Array.from(this.hypotheses.keys())
  }

  /** Number of findings in memory. */
  findingCount(): number {
    return this.findings.size
  }

  /** Number of hypotheses in memory. */
  hypothesisCount(): number {
    return this.hypotheses.size
  }

  private scanFindingsOnDisk(): Map<string, Finding> {
    const out = new Map<string, Finding>()
    if (!existsSync(this.artifactsDir)) return out
    for (const cycleEntry of readdirSync(this.artifactsDir)) {
      if (!cycleEntry.startsWith("cycle_")) continue
      const cycleDir = join(this.artifactsDir, cycleEntry)
      for (const file of readdirSync(cycleDir)) {
        if (!file.endsWith(".json")) continue
        try {
          const f = JSON.parse(readFileSync(join(cycleDir, file), "utf8")) as Finding
          out.set(f.findingId, f)
        } catch {
          // Skip.
        }
      }
    }
    return out
  }
}