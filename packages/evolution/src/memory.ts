/**
 * Phase 5 — Agent Memory.
 *
 * Per-role buckets of:
 *   - userFeedback        explicit "I don't like X" notes
 *   - reviewSuggestions   structured advice from the Review Agent
 *   - commonErrors        error strings seen on this role
 *   - goodExamples        snippets of high-scoring outputs
 *
 * Each entry carries a `mime` field so consumers can route by content type
 * (mirrors autogen's `MemoryContent` protocol). For now the most common
 * entries are `text/plain`; structured advice can be stored as
 * `application/json` so a downstream summarizer can parse it without
 * pre-processing.
 *
 * Grows unbounded by default. When any bucket exceeds COMPRESSION_THRESHOLD,
 * the oldest half is folded into a single `text/digest` entry and dropped.
 * An optional LLM summarizer can produce a higher-quality digest; without it
 * we fall back to a deterministic joiner so the engine still functions.
 */

import { createHash } from "node:crypto"
import type { AgentMemory, MemoryEntry, MetricRecord } from "./types.js"
import { emptyMemory, MemoryMime, toMemoryEntry } from "./types.js"
import { containsSecret, scrubSecrets } from "./secret-scrub.js"

export const COMPRESSION_THRESHOLD = 20

export interface MemorySummarizer {
  summarize(bucket: string, items: string[]): Promise<string>
}

/**
 * Frozen memory snapshot (hermes tools/memory_tool.py): MEMORY/USER context
 * enters the system prompt as a snapshot taken once — writes during the
 * session update the store but never the running prompt, so the
 * provider-side prefix cache stays valid for the whole session.
 */
export interface FrozenMemorySnapshot {
  /** Rendered prelude text; empty when memory has no entries yet. */
  prelude: string
  /** sha256 of `prelude` — cache keys / telemetry can key on this. */
  hash: string
  createdAt: string
}

export class AgentMemoryStore {
  /**
   * Freeze the current memory into an immutable prompt snapshot. The
   * snapshot is what callers inject at session start; later `record*`
   * calls do not affect it until the next freeze.
   */
  /**
   * Record one run's outcome against every active bucket's efficacy
   * ledger. `delta = reviewScore − role baseline` (all buckets were part
   * of the frozen prelude for that run, so credit/blame is bucket-level —
   * honest coarse granularity; per-entry attribution would need
   * ablation runs per lesson).
   */
  static applyEfficacy(mem: AgentMemory, delta: number): void {
    const buckets = ["userFeedback", "reviewSuggestions", "commonErrors", "goodExamples"] as const
    const efficacy = (mem.efficacy ??= {})
    for (const bucket of buckets) {
      if ((mem[bucket]?.length ?? 0) === 0) continue
      const cur = efficacy[bucket] ?? { injectedCount: 0, deltaSum: 0 }
      efficacy[bucket] = { injectedCount: cur.injectedCount + 1, deltaSum: cur.deltaSum + delta }
    }
  }

  /**
   * Gating decision per bucket (C2C gate, orchestration-layer translation):
   * mean efficacy > +eps → inject; < −eps → skip; insufficient samples →
   * inject with an uncertainty bias (a lesson with no evidence should not
   * be blocked from getting evidence).
   */
  static gatingDecisions(
    mem: AgentMemory,
    opts: { eps?: number; minSamples?: number } = {},
  ): Array<{ bucket: string; decision: "inject" | "skip"; mean: number; injectedCount: number }> {
    const eps = opts.eps ?? 0.25
    const minSamples = opts.minSamples ?? 3
    const buckets = [
      "userFeedback",
      "reviewSuggestions",
      "commonErrors",
      "goodExamples",
    ] as const
    const out: Array<{ bucket: string; decision: "inject" | "skip"; mean: number; injectedCount: number }> = []
    for (const bucket of buckets) {
      if ((mem[bucket]?.length ?? 0) === 0) continue
      const e = mem.efficacy?.[bucket]
      const mean = e && e.injectedCount > 0 ? e.deltaSum / e.injectedCount : 0
      const skip = e !== undefined && e.injectedCount >= minSamples && mean < -eps
      out.push({ bucket, decision: skip ? "skip" : "inject", mean, injectedCount: e?.injectedCount ?? 0 })
    }
    return out
  }

  static freeze(mem: AgentMemory): FrozenMemorySnapshot {
    const prelude = AgentMemoryStore.toPrelude(mem)
    return {
      prelude,
      hash: createHash("sha256").update(prelude).digest("hex"),
      createdAt: new Date().toISOString(),
    }
  }
  /**
   * Build the "memory prelude" text that gets prepended to a role's system
   * prompt at execution time. `gating` (C2C borrowing): "enforce" skips
   * buckets whose efficacy mean is significantly negative; "shadow" keeps
   * the old behaviour (use {@link gatingDecisions} to log what WOULD be
   * skipped); "off" is the legacy unconditional render.
   */
  static toPrelude(mem: AgentMemory, gating: "off" | "shadow" | "enforce" = "off"): string {
    const skip = new Set(
      gating === "enforce"
        ? AgentMemoryStore.gatingDecisions(mem)
            .filter((d) => d.decision === "skip")
            .map((d) => d.bucket)
        : [],
    )
    const sections: string[] = []
    const joinTail = (entries: MemoryEntry[], n: number) =>
      entries
        .slice(-n)
        .map((e) => e.content)
        .join("\n- ")
    if (mem.userFeedback.length > 0 && !skip.has("userFeedback")) {
      sections.push(`User feedback to honor:\n- ${joinTail(mem.userFeedback, 5)}`)
    }
    if (mem.reviewSuggestions.length > 0 && !skip.has("reviewSuggestions")) {
      sections.push(`Reviewer suggestions:\n- ${joinTail(mem.reviewSuggestions, 5)}`)
    }
    if (mem.commonErrors.length > 0 && !skip.has("commonErrors")) {
      sections.push(`Common errors to avoid:\n- ${joinTail(mem.commonErrors, 5)}`)
    }
    if (mem.goodExamples.length > 0 && !skip.has("goodExamples")) {
      sections.push(`Patterns that worked well:\n- ${joinTail(mem.goodExamples, 3)}`)
    }
    if (sections.length === 0) return ""
    return `\n\n# Lessons learned from past runs (auto-injected)\n${sections.join("\n\n")}\n`
  }

  static recordSuccess(
    mem: AgentMemory,
    record: MetricRecord,
    snippet: string | undefined,
  ): AgentMemory {
    // Scrub any secrets in the snippet before persisting (hermes-evolution
    // SECRET_PATTERNS). A good example that contains an API key would
    // be re-injected into future prompts and leak credentials.
    const safeSnippet = snippet && containsSecret(snippet) ? scrubSecrets(snippet) : snippet
    const next: AgentMemory = {
      ...mem,
      goodExamples: safeSnippet
        ? appendCapped(mem.goodExamples, toMemoryEntry(safeSnippet, MemoryMime.TextPlain), 50)
        : mem.goodExamples,
      totalEntries: mem.totalEntries + 1,
    }
    return next
  }

  static recordFailure(mem: AgentMemory, record: MetricRecord): AgentMemory {
    const errLine = record.error ?? `Score ${record.reviewScore}/10 below threshold`
    const safeErrLine = containsSecret(errLine) ? scrubSecrets(errLine) : errLine
    return {
      ...mem,
      commonErrors: appendCapped(
        mem.commonErrors,
        toMemoryEntry(safeErrLine, MemoryMime.TextPlain),
        50,
      ),
      totalEntries: mem.totalEntries + 1,
    }
  }

  static recordFeedback(mem: AgentMemory, text: string): AgentMemory {
    const trimmed = text.trim()
    if (!trimmed) return mem
    const safeText = containsSecret(trimmed) ? scrubSecrets(trimmed) : trimmed
    return {
      ...mem,
      userFeedback: appendCapped(
        mem.userFeedback,
        toMemoryEntry(safeText, MemoryMime.TextPlain),
        50,
      ),
      totalEntries: mem.totalEntries + 1,
    }
  }

  static recordReviewSuggestions(mem: AgentMemory, suggestions: string[]): AgentMemory {
    if (suggestions.length === 0) return mem
    const joined = suggestions.join(" | ")
    const safeJoined = containsSecret(joined) ? scrubSecrets(joined) : joined
    return {
      ...mem,
      reviewSuggestions: appendCapped(
        mem.reviewSuggestions,
        toMemoryEntry(safeJoined, MemoryMime.TextPlain),
        50,
      ),
      totalEntries: mem.totalEntries + 1,
    }
  }

  /**
   * Append a structured JSON payload to a bucket. Useful for richer
   * reviewer feedback (e.g. `{ issues: [...], score: 7 }`).
   */
  static recordStructured<T extends Record<string, unknown>>(
    mem: AgentMemory,
    bucket: "userFeedback" | "reviewSuggestions" | "commonErrors" | "goodExamples",
    payload: T,
    metadata?: Record<string, unknown>,
  ): AgentMemory {
    return {
      ...mem,
      [bucket]: appendCapped(
        mem[bucket],
        {
          mime: MemoryMime.ApplicationJson,
          content: JSON.stringify(payload),
          metadata,
        },
        50,
      ),
      totalEntries: mem.totalEntries + 1,
    }
  }

  /**
   * Compress any bucket that has grown past the threshold.
   * Returns a new memory object; does not mutate in place.
   */
  static async maybeCompress(
    mem: AgentMemory,
    summarizer?: MemorySummarizer,
  ): Promise<AgentMemory> {
    const buckets: Array<
    keyof Omit<AgentMemory, "totalEntries" | "compressedAt" | "archived" | "efficacy">
  > = [
      "userFeedback",
      "reviewSuggestions",
      "commonErrors",
      "goodExamples",
    ]

    let next: AgentMemory = { ...mem }
    let changed = false
    for (const b of buckets) {
      if (next[b].length <= COMPRESSION_THRESHOLD) continue
      const half = Math.floor(next[b].length / 2)
      const head = next[b].slice(0, half)
      const tail = next[b].slice(half)
      const headStrings = head.map((e) => e.content)
      const digest = summarizer
        ? await summarizer.summarize(b, headStrings)
        : defaultDigest(b, headStrings)
      next = {
        ...next,
        [b]: [{ mime: MemoryMime.TextDigest, content: digest }, ...tail],
      }
      changed = true
    }
    if (changed) {
      next = { ...next, compressedAt: new Date().toISOString() }
    }
    return next
  }
}

function appendCapped(arr: MemoryEntry[], value: MemoryEntry, cap: number): MemoryEntry[] {
  const next = [...arr, value]
  if (next.length > cap) next.splice(0, next.length - cap)
  return next
}

function defaultDigest(bucket: string, items: string[]): string {
  return `[digest of ${items.length} past ${bucket}] ${items.slice(0, 3).join(" / ")}`
}

export function freshMemory(): AgentMemory {
  return emptyMemory()
}
