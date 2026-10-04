// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the goal-judge (hermes goal_judge borrowing): the four-verdict
 * closed set, injected-judge validation + failover, the deterministic
 * keyword fallback, and the TruthMeasurement / goal-state mappings.
 */
import { describe, expect, it } from "vitest"
import { TruthAudit } from "../src/truth-audit.js"
import {
  GOAL_VERDICTS,
  GOAL_VERDICT_QUALITY_DELTA,
  goalJudgementToTruthMeasurement,
  judgeGoal,
  keywordGoalJudge,
  recordGoalJudgement,
  verdictIsTerminal,
  type GoalJudgeFn,
} from "../src/goal-judge.js"

const goalInput = (evidence: {
  records?: string[]
  artifacts?: string[]
  blockedReason?: string
}) => ({ goal: "ship the export feature", evidence })

describe("verdict set", () => {
  it("is the closed four-verdict set", () => {
    expect(GOAL_VERDICTS).toEqual(["achieved", "partially_achieved", "failed", "blocked"])
  })

  it("treats only partially_achieved as non-terminal", () => {
    expect(verdictIsTerminal("achieved")).toBe(true)
    expect(verdictIsTerminal("failed")).toBe(true)
    expect(verdictIsTerminal("blocked")).toBe(true)
    expect(verdictIsTerminal("partially_achieved")).toBe(false)
  })

  it("maps verdicts onto the quality axis monotonically", () => {
    expect(GOAL_VERDICT_QUALITY_DELTA.achieved).toBe(1)
    expect(GOAL_VERDICT_QUALITY_DELTA.partially_achieved).toBe(0.5)
    expect(GOAL_VERDICT_QUALITY_DELTA.failed).toBe(0)
    expect(GOAL_VERDICT_QUALITY_DELTA.blocked).toBe(0)
  })
})

describe("keywordGoalJudge (deterministic fallback)", () => {
  it("achieved: unambiguous achievement markers", () => {
    const j = keywordGoalJudge(
      goalInput({ records: ["all acceptance criteria are met", "test suite passed"] }),
    )
    expect(j.verdict).toBe("achieved")
    expect(j.source).toBe("fallback")
    expect(j.confidence).toBeGreaterThan(0.5)
  })

  it("partially_achieved: achievement claimed with remaining work", () => {
    const j = keywordGoalJudge(
      goalInput({ records: ["export completed", "remaining: csv quoting edge cases"] }),
    )
    expect(j.verdict).toBe("partially_achieved")
  })

  it("partially_achieved: progress markers without completion", () => {
    const j = keywordGoalJudge(goalInput({ records: ["implementation in progress"] }))
    expect(j.verdict).toBe("partially_achieved")
  })

  it("failed: failure markers only", () => {
    const j = keywordGoalJudge(goalInput({ records: ["build failed", "tests could not run"] }))
    expect(j.verdict).toBe("failed")
    expect(j.confidence).toBeGreaterThan(0.5)
  })

  it("failed: evidence present but says nothing recognizable", () => {
    const j = keywordGoalJudge(goalInput({ records: ["the weather was nice"] }))
    expect(j.verdict).toBe("failed")
    expect(j.confidence).toBeLessThan(0.5)
  })

  it("blocked: explicit blockedReason wins over completion claims", () => {
    const j = keywordGoalJudge(
      goalInput({
        records: ["everything completed"],
        blockedReason: "missing approval from the security team",
      }),
    )
    expect(j.verdict).toBe("blocked")
    expect(j.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("blocked: block markers in evidence outrank achievement markers", () => {
    const j = keywordGoalJudge(
      goalInput({ records: ["work completed but blocked on missing credential for the vault"] }),
    )
    expect(j.verdict).toBe("blocked")
  })

  it("blocked: empty evidence is unevaluatable, confidence 0", () => {
    const j = keywordGoalJudge(goalInput({}))
    expect(j.verdict).toBe("blocked")
    expect(j.confidence).toBe(0)
  })

  it("is deterministic: same input, same judgement", () => {
    const input = goalInput({ records: ["passed"], artifacts: ["diff summary"] })
    expect(keywordGoalJudge(input)).toEqual(keywordGoalJudge(input))
  })
})

describe("judgeGoal with an injected judge", () => {
  it("trusts a valid injected verdict (sync and async)", async () => {
    const sync: GoalJudgeFn = () => ({
      verdict: "achieved",
      reason: "diff implements the spec",
      confidence: 0.95,
    })
    expect(await judgeGoal(goalInput({ records: ["ok"] }), sync)).toEqual({
      verdict: "achieved",
      reason: "diff implements the spec",
      confidence: 0.95,
      source: "judge",
      evaluated: true,
    })

    const async: GoalJudgeFn = async () => ({
      verdict: "failed",
      reason: "deliverable does not compile",
      confidence: 0.8,
    })
    const r = await judgeGoal(goalInput({ records: ["ok"] }), async)
    expect(r.verdict).toBe("failed")
    expect(r.source).toBe("judge")
  })

  it("falls back on an invalid verdict string (closed set enforced)", async () => {
    const liar: GoalJudgeFn = () => ({
      verdict: "close_enough" as never,
      reason: "seems fine",
      confidence: 0.99,
    })
    const r = await judgeGoal(goalInput({ records: ["passed"] }), liar)
    expect(r.verdict).toBe("achieved") // keyword fallback on the same evidence
    expect(r.source).toBe("fallback")
    expect(r.reason).toContain("invalid judge reply")
  })

  it("falls back on out-of-range confidence", async () => {
    const overconfident: GoalJudgeFn = () => ({
      verdict: "achieved",
      reason: "trust me",
      confidence: 1.5,
    })
    const r = await judgeGoal(goalInput({ records: ["build failed"] }), overconfident)
    expect(r.verdict).toBe("failed")
    expect(r.source).toBe("fallback")
  })

  it("falls back on a missing reason (judgements must be auditable)", async () => {
    const terse: GoalJudgeFn = () => ({ verdict: "achieved", reason: "", confidence: 0.5 })
    const r = await judgeGoal(goalInput({ records: ["passed"] }), terse)
    expect(r.source).toBe("fallback")
    expect(r.reason).toContain("invalid judge reply")
  })

  it("falls back when the injected judge throws", async () => {
    const broken: GoalJudgeFn = () => {
      throw new Error("auxiliary client unavailable")
    }
    const r = await judgeGoal(goalInput({ records: ["passed"] }), broken)
    expect(r.verdict).toBe("achieved")
    expect(r.source).toBe("fallback")
    expect(r.reason).toContain("auxiliary client unavailable")
  })

  it("empty goal is unevaluable even with a judge (fail-closed, never achieved)", async () => {
    const generous: GoalJudgeFn = () => ({
      verdict: "achieved",
      reason: "sure",
      confidence: 1,
    })
    const r = await judgeGoal({ goal: "   ", evidence: {} }, generous)
    expect(r.verdict).toBe("blocked")
    expect(r.evaluated).toBe(false)
    expect(r.confidence).toBe(0)
    expect(r.source).toBe("fallback")
  })

  it("without a judge, the keyword fallback answers", async () => {
    const r = await judgeGoal(goalInput({ records: ["migration completed successfully"] }))
    expect(r.verdict).toBe("achieved")
    expect(r.source).toBe("fallback")
    expect(r.evaluated).toBe(true)
  })
})

describe("TruthMeasurement mapping", () => {
  const opts = { proposalId: "p-1", proposalAction: "promote" } as const

  it("achieved → predicted 1, actual 1, sampleSize 1", () => {
    const m = goalJudgementToTruthMeasurement(
      { verdict: "achieved", reason: "done", confidence: 0.9, source: "judge" },
      opts,
    )
    expect(m).not.toBeNull()
    expect(m?.predicted.qualityDelta).toBe(1)
    expect(m?.actual.qualityDelta).toBe(1)
    expect(m?.proposalId).toBe("p-1")
    expect(m?.proposalAction).toBe("promote")
  })

  it("partially_achieved → actual 0.5; failed → actual 0", () => {
    const partial = goalJudgementToTruthMeasurement(
      { verdict: "partially_achieved", reason: "half", confidence: 0.6, source: "judge" },
      opts,
    )
    expect(partial?.actual.qualityDelta).toBe(0.5)
    const failed = goalJudgementToTruthMeasurement(
      { verdict: "failed", reason: "nope", confidence: 0.7, source: "judge" },
      opts,
    )
    expect(failed?.actual.qualityDelta).toBe(0)
  })

  it("blocked is NOT measurable (null) — a block carries no quality claim", () => {
    const m = goalJudgementToTruthMeasurement(
      { verdict: "blocked", reason: "needs human input", confidence: 0.9, source: "judge" },
      opts,
    )
    expect(m).toBeNull()
  })

  it("custom predictedQualityDelta feeds the calibration comparison", () => {
    const m = goalJudgementToTruthMeasurement(
      { verdict: "achieved", reason: "done", confidence: 0.9, source: "judge" },
      { ...opts, predictedQualityDelta: 0.8 },
    )
    expect(m?.predicted.qualityDelta).toBe(0.8)
    expect(m?.actual.qualityDelta).toBe(1)
  })

  it("recordGoalJudgement feeds TruthAudit; blocked verdicts are skipped", async () => {
    // minSampleSize defaults to 3 — lower it to 1 so one measurement is
    // enough to see the calibration verdict.
    const audit = await TruthAudit.create({ config: { minSampleSize: 1 } })
    const recorded = recordGoalJudgement(
      audit,
      { verdict: "achieved", reason: "criteria met", confidence: 0.9, source: "judge" },
      opts,
    )
    expect(recorded).not.toBeNull()
    expect(audit.size()).toBe(1)

    const skipped = recordGoalJudgement(
      audit,
      { verdict: "blocked", reason: "waiting on human approval", confidence: 0.9, source: "judge" },
      opts,
    )
    expect(skipped).toBeNull()
    expect(audit.size()).toBe(1)

    // The verdict is visible in the audit's drift verdict for the proposal:
    // predicted 1 vs actual 1 → accurate, no recalibration needed.
    const verification = audit.verify("p-1")
    expect(verification?.verdict).toBe("accurate")
  })
})
