// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Taste-to-checks funnel tests (borrowing mcode-stack stacks/ronny
 * taste-to-checks SKILL.md): the second occurrence of a same-type lesson
 * escalates to a check-proposal; one-off quirks stay out; proposals
 * dedupe.
 */

import { describe, it, expect } from "vitest"
import { MemoryCurator, normalizeContentKey } from "../src/curator.js"
import {
  CHECK_PROPOSAL_KIND,
  checkProposalKey,
  classifyEnforceSlot,
  isCheckProposalEntry,
  renderCheckProposal,
  toCheckProposal,
} from "../src/taste-to-checks.js"
import { emptyMemory, toMemoryEntry } from "../src/types.js"

const LESSON = "Avoid repeating this failure pattern: connection refused to <host>"

function memWithRepeatedLesson(): ReturnType<typeof emptyMemory> {
  const m = emptyMemory()
  m.commonErrors.push(toMemoryEntry(LESSON))
  m.commonErrors.push(toMemoryEntry(LESSON.toLowerCase()))
  return m
}

describe("toCheckProposal", () => {
  it("escapes a one-off quirk (single occurrence stays a lesson)", () => {
    expect(toCheckProposal(LESSON, 1)).toBeNull()
    expect(toCheckProposal("", 5)).toBeNull()
  })

  it("escalates at the second same-type occurrence with a proof record", () => {
    const proposal = toCheckProposal(LESSON, 2)
    expect(proposal).not.toBeNull()
    expect(proposal!.kind).toBe(CHECK_PROPOSAL_KIND)
    expect(proposal!.rule).toBe(LESSON)
    // Proof defaults to unverified — the funnel never fabricates evidence.
    expect(proposal!.proof).toEqual({
      oldMistakeFails: "unverified",
      cleanMainPasses: "unverified",
    })
  })

  it("carries supplied replay proof (old mistake fails, clean main passes)", () => {
    const proposal = toCheckProposal(LESSON, 3, {
      oldMistakeFails: "yes",
      cleanMainPasses: "yes",
    })
    expect(proposal!.proof.oldMistakeFails).toBe("yes")
    expect(proposal!.proof.cleanMainPasses).toBe("yes")
    expect(renderCheckProposal(proposal!)).toContain("replaying the old mistake fails the check")
    expect(renderCheckProposal(proposal!)).toContain("passes on clean main")
  })
})

describe("classifyEnforceSlot (SKILL.md §3: strongest slot wins)", () => {
  it("forbidden code patterns go to lint", () => {
    expect(classifyEnforceSlot("no new any in packages/core")).toBe("lint")
    expect(classifyEnforceSlot("forbidden API never used")).toBe("lint")
  })

  it("behaviour that must hold goes to test", () => {
    expect(classifyEnforceSlot("bug fix behaviour must hold with a regression test")).toBe("test")
  })

  it("must-happen-on-every-commit rules go to hook", () => {
    expect(classifyEnforceSlot("run formatter on every commit")).toBe("hook")
  })

  it("anything non-mechanical falls back to doc", () => {
    expect(classifyEnforceSlot("prefer discussing trade-offs with the reviewer")).toBe("doc")
  })
})

describe("MemoryCurator.escalateRecurringLessons", () => {
  it("the second same-type incident produces ONE check-proposal", () => {
    const { memory, proposals } = MemoryCurator.escalateRecurringLessons(memWithRepeatedLesson())
    expect(proposals).toHaveLength(1)
    const entry = proposals[0]!
    expect(isCheckProposalEntry(entry)).toBe(true)
    expect(entry.metadata?.["enforceAt"]).toBe("test") // "avoid repeating X" → behaviour → test
    expect(entry.metadata?.["proposalKey"]).toBe(normalizeContentKey(LESSON))
    // The proposal lands in reviewSuggestions like any other lesson (the
    // verified consumer chain: recordCompletion → onLessons → profile).
    const active = memory.reviewSuggestions.filter(isCheckProposalEntry)
    expect(active).toHaveLength(1)
    // Redundant duplicates archived, one original copy kept.
    expect(memory.commonErrors).toHaveLength(1)
    expect(memory.archived?.commonErrors).toHaveLength(1)
  })

  it("a one-off incident does not escalate", () => {
    const m = emptyMemory()
    m.commonErrors.push(toMemoryEntry(LESSON))
    const { memory, proposals } = MemoryCurator.escalateRecurringLessons(m)
    expect(proposals).toHaveLength(0)
    expect(memory.commonErrors).toHaveLength(1)
    expect(memory.archived).toBeUndefined()
  })

  it("dedupes: a re-run (or third incident) does not produce a second proposal", () => {
    const first = MemoryCurator.escalateRecurringLessons(memWithRepeatedLesson())
    expect(first.proposals).toHaveLength(1)

    // Re-run over the escalated memory (a third same-type incident lands).
    const m2 = first.memory
    m2.commonErrors.push(toMemoryEntry(LESSON))
    const second = MemoryCurator.escalateRecurringLessons(m2)
    expect(second.proposals).toHaveLength(0)
    const totalProposals = second.memory.reviewSuggestions.filter(isCheckProposalEntry)
    expect(totalProposals).toHaveLength(1)
  })

  it("counts archived history: consolidation then escalation still recurs", () => {
    const m = emptyMemory()
    m.commonErrors.push(toMemoryEntry(LESSON))
    m.commonErrors.push(toMemoryEntry(LESSON))
    // The regular consolidation sweep collapses the duplicates (1 active,
    // 1 archived) — the recurrence is still provable afterwards.
    const curated = MemoryCurator.consolidate(m, "commonErrors")
    expect(curated.memory.commonErrors).toHaveLength(1)
    const { proposals } = MemoryCurator.escalateRecurringLessons(curated.memory)
    expect(proposals).toHaveLength(1)
  })

  it("respects the minOccurrences option", () => {
    const { proposals } = MemoryCurator.escalateRecurringLessons(memWithRepeatedLesson(), {
      minOccurrences: 3,
    })
    expect(proposals).toHaveLength(0)
  })

  it("an existing proposal key survives escalation (cross-bucket dedupe)", () => {
    const { memory } = MemoryCurator.escalateRecurringLessons(memWithRepeatedLesson())
    // The same-type lesson ALSO recurs in userFeedback.
    memory.userFeedback.push(toMemoryEntry(LESSON))
    memory.userFeedback.push(toMemoryEntry(LESSON))
    const { proposals } = MemoryCurator.escalateRecurringLessons(memory)
    expect(proposals).toHaveLength(0)
  })
})
