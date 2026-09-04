// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Memory Curator — lifecycle maintenance for the memory corpus.
 *
 * Borrowed from NousResearch/hermes-agent `agent/curator.py`: an
 * under-maintained memory bucket degrades into noise (duplicated lessons,
 * stale fragments) that is faithfully re-injected into every prompt. The
 * curator runs as an idle-time maintenance pass with three hard rules:
 *
 *   1. **Archive, never delete.** Retired entries move to
 *      `memory.archived[bucket]` for audit; nothing is silently destroyed.
 *   2. **Pinned entries are immune.** `metadata.pinned = true` survives
 *      archive and consolidation sweeps.
 *   3. **Duplicates collapse to the newest** active copy (or the pinned
 *      copy when one exists); the losers are archived, not dropped.
 */

import type { AgentMemory, AgentProfile, CuratorState, MemoryEntry } from "./types.js"
import { toMemoryEntry } from "./types.js"

export type CuratorBucket = "userFeedback" | "reviewSuggestions" | "commonErrors" | "goodExamples"

export const CURATOR_BUCKETS: CuratorBucket[] = [
  "userFeedback",
  "reviewSuggestions",
  "commonErrors",
  "goodExamples",
]

export interface ConsolidationResult {
  memory: AgentMemory
  /** Number of duplicate entries archived. */
  consolidated: number
}

export interface CurateReport {
  memory: AgentMemory
  curatorState: CuratorState
  consolidated: number
}

export class MemoryCurator {
  /** Mark matching entries `metadata.pinned = true`. Pinned entries are exempt from archive/consolidation. */
  static pin(mem: AgentMemory, bucket: CuratorBucket, match: EntryMatch): AgentMemory {
    return mapBucket(mem, bucket, (e) => (matches(e, match) ? withMeta(e, { pinned: true }) : e))
  }

  static unpin(mem: AgentMemory, bucket: CuratorBucket, match: EntryMatch): AgentMemory {
    return mapBucket(mem, bucket, (e) => (matches(e, match) ? withMeta(e, { pinned: false }) : e))
  }

  /**
   * Retire matching entries from the active bucket into `mem.archived`.
   * Pinned entries are skipped. Returns the same memory object shape with
   * the archived copies preserved (archive-not-delete).
   */
  static archive(mem: AgentMemory, bucket: CuratorBucket, match: EntryMatch): AgentMemory {
    const active = mem[bucket]
    const staying: MemoryEntry[] = []
    const retired: MemoryEntry[] = []
    for (const e of active) {
      if (!isPinned(e) && matches(e, match)) {
        retired.push(withMeta(e, { archivedAt: new Date().toISOString() }))
      } else {
        staying.push(e)
      }
    }
    if (retired.length === 0) return mem
    return {
      ...mem,
      [bucket]: staying,
      archived: {
        ...(mem.archived ?? {}),
        [bucket]: [...(mem.archived?.[bucket] ?? []), ...retired],
      },
    }
  }

  /**
   * Collapse near-duplicate entries within one bucket: keep the newest
   * active copy (or the pinned copy, which wins over recency), archive the
   * rest. Pinned entries are *never* archived — immunity beats dedupe, so
   * a pinned duplicate of a newer unpinned entry keeps both copies.
   * Comparison is normalization-based (case, whitespace and punctuation
   * insensitive) so "avoid X." and "Avoid  X" collapse.
   */
  static consolidate(mem: AgentMemory, bucket: CuratorBucket): ConsolidationResult {
    const active = mem[bucket]

    // Decide the canonical winner per normalized key, newest-first. A
    // pinned entry always displaces an unpinned winner for its key.
    const winnerForKey = new Map<string, MemoryEntry>()
    for (let i = active.length - 1; i >= 0; i--) {
      const e = active[i]
      const key = normalize(e.content)
      const winner = winnerForKey.get(key)
      if (!winner || (isPinned(e) && !isPinned(winner))) {
        winnerForKey.set(key, e)
      }
    }

    const staying: MemoryEntry[] = []
    const retired: MemoryEntry[] = []
    for (const e of active) {
      const isCanonical = winnerForKey.get(normalize(e.content)) === e
      if (isCanonical || isPinned(e)) {
        staying.push(e)
      } else {
        retired.push(e)
      }
    }

    if (retired.length === 0) return { memory: mem, consolidated: 0 }

    const stamped = retired.map((e) =>
      withMeta(e, {
        archivedAt: new Date().toISOString(),
        consolidated: true,
      }),
    )

    return {
      memory: {
        ...mem,
        [bucket]: staying,
        archived: {
          ...(mem.archived ?? {}),
          [bucket]: [...(mem.archived?.[bucket] ?? []), ...stamped],
        },
      },
      consolidated: retired.length,
    }
  }

  /**
   * Full maintenance pass: consolidate every bucket. Returns the updated
   * memory plus the curator bookkeeping for the profile.
   */
  static curateAll(mem: AgentMemory, priorState?: CuratorState): CurateReport {
    let next = mem
    let consolidated = 0
    for (const bucket of CURATOR_BUCKETS) {
      const res = MemoryCurator.consolidate(next, bucket)
      next = res.memory
      consolidated += res.consolidated
    }
    const curatorState: CuratorState = {
      lastRunAt: new Date().toISOString(),
      totalPinned: priorState?.totalPinned ?? 0,
      totalArchived: (priorState?.totalArchived ?? 0) + consolidated,
      totalConsolidated: (priorState?.totalConsolidated ?? 0) + consolidated,
    }
    return { memory: next, curatorState, consolidated }
  }

  /** Convenience: curate a full profile (memory + curator bookkeeping). */
  static curateProfile(profile: AgentProfile): AgentProfile {
    const report = MemoryCurator.curateAll(profile.memory, profile.curatorState)
    return { ...profile, memory: report.memory, curatorState: report.curatorState }
  }
}

export type EntryMatch = string | ((e: MemoryEntry) => boolean)

function matches(e: MemoryEntry, match: EntryMatch): boolean {
  if (typeof match === "string") {
    return e.content.toLowerCase().includes(match.toLowerCase())
  }
  return match(e)
}

function isPinned(e: MemoryEntry): boolean {
  return e.metadata?.pinned === true
}

function withMeta(e: MemoryEntry, patch: Record<string, unknown>): MemoryEntry {
  return toMemoryEntry({ ...e, metadata: { ...(e.metadata ?? {}), ...patch } })
}

/** Case/whitespace/punctuation-insensitive content key for dedupe. */
export function normalizeContentKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function normalize(text: string): string {
  return normalizeContentKey(text)
}

function mapBucket(
  mem: AgentMemory,
  bucket: CuratorBucket,
  fn: (e: MemoryEntry) => MemoryEntry,
): AgentMemory {
  return { ...mem, [bucket]: mem[bucket].map(fn) }
}
