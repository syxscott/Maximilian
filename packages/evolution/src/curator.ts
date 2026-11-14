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
import { entryContent, toMemoryEntry } from "./types.js"
import {
  checkProposalKey,
  isCheckProposalEntry,
  toCheckProposal,
  toCheckProposalEntry,
} from "./taste-to-checks.js"
import type { CheckProposalProof } from "./taste-to-checks.js"

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
   * rest. Pinned entries are *never* archived — immunity beats dedupe.
   * NOTE: when a pinned entry and an unpinned entry share the same
   * normalized key, the pinned one becomes canonical and the unpinned
   * copy IS archived (pinned wins the key; it does not force both copies
   * to coexist). Two pinned duplicates of each other do coexist.
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

  /**
   * Taste-to-checks escalation pass (mcode-stack stacks/ronny
   * taste-to-checks borrowing): same-type lessons that hit >= 2 times
   * (active copies PLUS already-archived copies, so post-consolidation
   * history still counts) escalate to ONE check-proposal entry in
   * `reviewSuggestions`; the redundant active duplicates are archived
   * like a consolidation sweep would. Pinned entries are immune (their
   * active copy is kept and not archived). Dedupe: a proposal for a
   * normalized key is emitted exactly once — later passes (and later
   * buckets holding the same key) see the existing proposal and skip.
   */
  static escalateRecurringLessons(
    mem: AgentMemory,
    opts: { minOccurrences?: number; proof?: Partial<CheckProposalProof> } = {},
  ): { memory: AgentMemory; proposals: MemoryEntry[] } {
    const minOccurrences = opts.minOccurrences ?? 2
    const next: AgentMemory = { ...mem }
    const proposals: MemoryEntry[] = []

    // Proposals already emitted (active or archived) — never duplicated.
    const existingKeys = new Set<string>()
    const scanProposals = (entries: MemoryEntry[] | undefined): void => {
      for (const e of entries ?? []) {
        const key = checkProposalKey(e)
        if (key) existingKeys.add(key)
      }
    }
    scanProposals(next.reviewSuggestions)
    for (const bucketEntries of Object.values(next.archived ?? {})) scanProposals(bucketEntries)

    // Global occurrence count per normalized key across every bucket,
    // INCLUDING archived copies: the consolidation pass may have already
    // collapsed earlier repeats — their archived copies still prove
    // recurrence.
    const counts = new Map<string, number>()
    for (const bucket of CURATOR_BUCKETS) {
      const count = (entries: MemoryEntry[] | undefined): void => {
        for (const e of entries ?? []) {
          if (isCheckProposalEntry(e)) continue
          const key = normalizeContentKey(entryContent(e))
          if (!key) continue
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
      }
      count(next[bucket])
      count(next.archived?.[bucket])
    }

    const qualifyingKeys = new Set(
      [...counts.entries()]
        .filter(([key, n]) => n >= minOccurrences && !existingKeys.has(key))
        .map(([key]) => key),
    )
    if (qualifyingKeys.size === 0) return { memory: mem, proposals }

    // Per bucket: keep the newest active copy of each qualifying key as
    // the rule source; archive the redundant duplicates.
    for (const bucket of CURATOR_BUCKETS) {
      const active = next[bucket]
      const newestForKey = new Map<string, { entry: MemoryEntry; index: number }>()
      for (let i = active.length - 1; i >= 0; i--) {
        const e = active[i]!
        if (isCheckProposalEntry(e)) continue
        const key = normalizeContentKey(entryContent(e))
        if (!qualifyingKeys.has(key)) continue
        if (!newestForKey.has(key)) newestForKey.set(key, { entry: e, index: i })
      }
      if (newestForKey.size === 0) continue

      const staying: MemoryEntry[] = []
      const retiring: MemoryEntry[] = []
      for (let i = 0; i < active.length; i++) {
        const e = active[i]!
        const key = normalizeContentKey(entryContent(e))
        if (qualifyingKeys.has(key) && newestForKey.get(key)?.index !== i && !isPinned(e)) {
          retiring.push(e)
        } else {
          staying.push(e)
        }
      }

      for (const [key, { entry }] of newestForKey) {
        if (existingKeys.has(key)) continue // another bucket escalated it first
        const proposal = toCheckProposal(entryContent(entry), counts.get(key) ?? 0, opts.proof)
        if (!proposal) continue
        proposals.push(toCheckProposalEntry(proposal, key))
        existingKeys.add(key)
      }

      next[bucket] = staying
      if (retiring.length > 0) {
        next.archived = {
          ...(next.archived ?? {}),
          [bucket]: [
            ...(next.archived?.[bucket] ?? []),
            ...retiring.map((e) =>
              toMemoryEntry({
                ...e,
                metadata: { ...(e.metadata ?? {}), archivedAt: new Date().toISOString() },
              }),
            ),
          ],
        }
      }
    }

    if (proposals.length > 0) {
      next.reviewSuggestions = [...next.reviewSuggestions, ...proposals]
      next.totalEntries = next.totalEntries + proposals.length
    }
    return { memory: next, proposals }
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
