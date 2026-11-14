// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Evidence-mandate tests (borrowing MiniMax minimax_search
 * minimax_search_browse.py:199,218): the rubric prompt carries the
 * evidence-forcing clause, and an evidence-free verdict degrades.
 */

import { describe, it, expect } from "vitest"
import {
  buildRubricPrompt,
  enforceEvidenceGate,
  EVIDENCE_MANDATE,
  RUBRIC_ANCHORS,
  type JudgeOutput,
} from "../src/llm-judge.js"

function judgeOutput(composite: number, extra: Partial<JudgeOutput> = {}): JudgeOutput {
  return {
    composite,
    correctness: composite,
    procedure: composite,
    conciseness: 1,
    lengthPenalty: 0,
    feedback: "test judge",
    ...extra,
  }
}

describe("evidence mandate", () => {
  it("the rubric prompt contains the evidence-forcing clause", () => {
    const prompt = buildRubricPrompt({
      charter: "You are the backend agent.",
      rubricContext: { positives: ["schema change"], negatives: ["casual chat"] },
    })
    expect(prompt).toContain(EVIDENCE_MANDATE)
    expect(prompt).toContain("explicitly refuse to answer")
    expect(prompt).toContain("original text as evidence")
  })

  it("renders the anchored rubric dimensions", () => {
    const prompt = buildRubricPrompt({
      rubricContext: { positives: ["schema change"], negatives: ["casual chat"] },
    })
    for (const dimension of Object.keys(RUBRIC_ANCHORS)) {
      expect(prompt).toContain(dimension)
    }
    expect(prompt).toContain("Must trigger on: schema change")
    expect(prompt).toContain("Must NOT trigger on: casual chat")
  })

  it("degrades a verdict without evidence (no quote → composite halved)", () => {
    const gated = enforceEvidenceGate(judgeOutput(0.8))
    expect(gated.composite).toBeCloseTo(0.4, 6)
    expect(gated.feedback).toContain("evidence mandate violated")
  })

  it("treats a whitespace-only quote as missing evidence", () => {
    const gated = enforceEvidenceGate(judgeOutput(0.8, { evidenceQuote: "   " }))
    expect(gated.composite).toBeCloseTo(0.4, 6)
  })

  it("a verdict grounded in a quoted excerpt passes unchanged", () => {
    const grounded = judgeOutput(0.8, { evidenceQuote: "the component must be self-contained" })
    const gated = enforceEvidenceGate(grounded)
    expect(gated).toBe(grounded) // identity — no degradation applied
    expect(gated.composite).toBe(0.8)
  })
})
