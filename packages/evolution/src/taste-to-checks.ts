// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Taste-to-checks lesson funnel (borrowing mcode-stack
 * stacks/ronny/skills/taste-to-checks/SKILL.md:13-48).
 *
 * "If we tell an agent the same thing twice, the second time is our
 * fault." Reflection lessons that keep recurring are not memory — they
 * are taste that should run by itself. The funnel distinguishes:
 *
 *   - one-off quirks      → stay as lessons (memory), never promoted
 *   - same-type repeats   → escalate to a check-proposal lesson:
 *                           { kind: "check-proposal", rule, enforceAt,
 *                           proof } — the rule written as ONE testable
 *                           sentence, placed at the STRONGEST execution
 *                           slot it fits (lint/ci > test > hook > doc,
 *                           SKILL.md §3 table), carrying the replay
 *                           proof fields (SKILL.md §4: it must fail on
 *                           the old mistake and pass on clean main).
 *
 * Downstream, the proposal is a normal memory entry: the verified
 * consumer chain (worker recordCompletion → facade reflector.schedule →
 * onLessons → profile memory) injects it like any other lesson. Subject
 * to the existing cleanliness constraints: incident text is generalized
 * upstream by the reflector and rendered content passes scrubSecrets.
 */

import type { MemoryEntry } from "./types.js"
import { containsSecret, scrubSecrets } from "./secret-scrub.js"

export const CHECK_PROPOSAL_KIND = "check-proposal"

/** Execution slots, strongest first (SKILL.md §3: prefer the top). */
export type EnforceAt = "lint" | "ci" | "test" | "hook" | "doc"

export const ENFORCE_AT_PRIORITY: readonly EnforceAt[] = ["lint", "ci", "test", "hook", "doc"]

/**
 * Replay proof (SKILL.md §4): "Run it against the past mistake … and
 * confirm it passes on current main. A check that never failed has not
 * been shown to work." `unverified` is the honest default — the funnel
 * never fabricates evidence.
 */
export interface CheckProposalProof {
  /** Replaying the old mistake: does the check fail on it? */
  oldMistakeFails: "yes" | "no" | "unverified"
  /** Does the check pass on a clean main? */
  cleanMainPasses: "yes" | "no" | "unverified"
  detail?: string
}

export interface CheckProposalLesson {
  kind: typeof CHECK_PROPOSAL_KIND
  /** The rule as ONE testable sentence (SKILL.md §2). */
  rule: string
  /** Strongest execution slot the rule fits. */
  enforceAt: EnforceAt
  proof: CheckProposalProof
}

/**
 * Classify a rule into its strongest execution slot (SKILL.md §3 table,
 * priority lint/ci > test > hook > doc):
 *   - code pattern to forbid            → lint (or ci when repo-wide)
 *   - behaviour that must hold          → test
 *   - must happen on every edit/commit  → hook
 *   - needs context, not mechanical     → doc (last resort)
 */
export function classifyEnforceSlot(rule: string): EnforceAt {
  const r = rule.toLowerCase()
  // lint/ci — forbid patterns, style, naming, imports, forbidden APIs.
  if (
    /\b(no|forbid|forbidden|never)\b/.test(r) ||
    /\bany\b/.test(r) ||
    /\b(import order|naming|style|lint|grep|format)\b/.test(r)
  ) {
    return "lint"
  }
  // test — behaviour that must hold, regressions, acceptance ("avoid
  // repeating X" is a behaviour rule: it must hold on every future run).
  if (
    /\b(behaviour|behavior|must hold|regression|acceptance|test|coverage|fails on|avoid)\b/.test(r)
  ) {
    return "test"
  }
  // hook — must happen on every edit / commit / save.
  if (/\b(every (edit|commit|save|push)|pre-?commit|hook)\b/.test(r)) {
    return "hook"
  }
  return "doc"
}

/**
 * Build the check-proposal for a recurring lesson. `occurrences` counts
 * same-type hits (normalized key): below 2 → null (a one-off quirk stays
 * out — SKILL.md §1: "Only encode what has happened more than once").
 */
export function toCheckProposal(
  lesson: string,
  occurrences: number,
  proof: Partial<CheckProposalProof> = {},
): CheckProposalLesson | null {
  const rule = lesson.trim()
  if (!rule) return null
  if (occurrences < 2) return null
  return {
    kind: CHECK_PROPOSAL_KIND,
    rule,
    enforceAt: classifyEnforceSlot(rule),
    proof: {
      oldMistakeFails: proof.oldMistakeFails ?? "unverified",
      cleanMainPasses: proof.cleanMainPasses ?? "unverified",
      ...(proof.detail ? { detail: proof.detail } : {}),
    },
  }
}

/** Human-readable sentence the profile memory injects (prelude-friendly). */
export function renderCheckProposal(p: CheckProposalLesson): string {
  const proofParts: string[] = []
  proofParts.push(
    p.proof.oldMistakeFails === "yes"
      ? "replaying the old mistake fails the check"
      : p.proof.oldMistakeFails === "no"
        ? "replaying the old mistake does NOT fail the check (needs work)"
        : "replay proof pending (run it on the old mistake)",
  )
  proofParts.push(
    p.proof.cleanMainPasses === "yes"
      ? "passes on clean main"
      : p.proof.cleanMainPasses === "no"
        ? "does NOT pass on clean main (needs work)"
        : "clean-main proof pending",
  )
  return `check-proposal (enforce at: ${p.enforceAt}): ${p.rule} — proof: ${proofParts.join(", ")}`
}

/** Is this memory entry an escalated check proposal? */
export function isCheckProposalEntry(entry: MemoryEntry | undefined): boolean {
  return entry?.metadata?.["kind"] === CHECK_PROPOSAL_KIND
}

/** The dedupe key of a proposal (the normalized rule it escalates). */
export function checkProposalKey(entry: MemoryEntry): string | undefined {
  if (!isCheckProposalEntry(entry)) return undefined
  const key = entry.metadata?.["proposalKey"]
  return typeof key === "string" ? key : undefined
}

/**
 * Build the memory entry for a proposal: structured metadata for
 * consumers, a rendered sentence as content so the prompt prelude stays
 * readable. Rendered text passes scrubSecrets (the existing cleaning
 * constraint); incident details are expected to already be generalized
 * upstream by the reflector.
 */
export function toCheckProposalEntry(
  proposal: CheckProposalLesson,
  proposalKey: string,
): MemoryEntry {
  const rendered = renderCheckProposal(proposal)
  return {
    mime: "text/plain",
    content: containsSecret(rendered) ? scrubSecrets(rendered) : rendered,
    metadata: {
      kind: CHECK_PROPOSAL_KIND,
      proposalKey,
      rule: proposal.rule,
      enforceAt: proposal.enforceAt,
      proof: proposal.proof,
      escalatedAt: new Date().toISOString(),
    },
  }
}
