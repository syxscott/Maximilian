/**
 * LLM-as-judge pluggable fitness scorer (borrowed from
 * NousResearch/hermes-agent-self-evolution/evolution/core/fitness.py:34-104).
 *
 * Hermes' LLMJudge scores a candidate on three dimensions:
 *   - correctness  (weight 0.5)
 *   - procedure    (weight 0.3)
 *   - conciseness  (weight 0.2)
 * …plus a textual `feedback` string that GEPA can consume reflectively.
 *
 * Maximilian's adaptation: a pluggable `Judge` interface (a function) that
 * the caller passes to `evolve()`. The default implementation is a
 * deterministic marker-based heuristic (matching the previous offline
 * behaviour); callers with a real LLM can pass their own Judge to get
 * LLM-driven scoring without forking the engine.
 *
 * The composite score is:
 *   composite = 0.5*correctness + 0.3*procedure + 0.2*conciseness - lengthPenalty
 *
 * `lengthPenalty` is borrowed from hermes' `fitness.py:91-96`:
 * ramps 0 → 0.3 as artifact size approaches the limit. This is the
 * anti-bloat operator that gives `PROMOTE_MARGIN` real teeth.
 */

import { PROMPT_GROWTH_MAX, PROMPT_MAX_LEN } from "./constraint-gates.js";

export interface JudgeInput {
  candidate: string;
  baseline: string;
  /** Failure-mode strings from recent metrics. */
  failures: string[];
  /** User feedback notes. */
  feedback: string[];
  /** Score threshold below which a candidate is failing. */
  scoreThreshold: number;
}

export interface JudgeOutput {
  /** 0..1, weighted composite. */
  composite: number;
  /** Sub-scores, all 0..1. */
  correctness: number;
  procedure: number;
  conciseness: number;
  /** Subtract 0..0.3 for overlong prompts. */
  lengthPenalty: number;
  /** Free-form feedback the engine can record on the decision. */
  feedback: string;
}

export type Judge = (input: JudgeInput) => Promise<JudgeOutput> | JudgeOutput;

/** Default offline heuristic judge. Fast, deterministic, no LLM required. */
export const defaultJudge: Judge = (input) => {
  const cand = input.candidate;
  const base = input.baseline;
  const candLower = cand.toLowerCase();
  const baseLower = base.toLowerCase();

  // Correctness: does the candidate mention any of the failure modes?
  let correctness = 0;
  if (input.failures.length === 0) {
    correctness = 0.5;
  } else {
    let hits = 0;
    for (const f of input.failures) {
      if (candLower.includes(f.toLowerCase().slice(0, 40))) hits += 1;
    }
    correctness = Math.min(1, hits / Math.max(1, input.failures.length));
  }

  // Procedure: does the candidate add explicit structure ("# section", "1.")?
  const procedureMarkers = [
    /#\s+\w+/, // markdown heading
    /^\d+\.\s/m, // numbered list
    /-\s+\w+/m, // bullet list
  ];
  const procedureHits = procedureMarkers.filter((re) => re.test(cand)).length;
  const procedure = Math.min(1, procedureHits / 2);

  // Conciseness: penalty for being much longer than baseline. 0..1.
  const ratio = cand.length / Math.max(1, base.length);
  const conciseness = ratio <= 1.05 ? 1 : Math.max(0, 1 - (ratio - 1.05) * 2);

  // Length penalty (hermes' anti-bloat operator). Ramps 0 → 0.3 as the
  // candidate approaches PROMPT_MAX_LEN; also penalises overgrowth vs base.
  const growthRatio = cand.length / Math.max(1, base.length);
  const overgrowthPenalty = growthRatio > PROMPT_GROWTH_MAX
    ? Math.min(0.3, (growthRatio - PROMPT_GROWTH_MAX) * 0.5)
    : 0;
  const sizeRatio = cand.length / PROMPT_MAX_LEN;
  const sizePenalty = sizeRatio > 0.9
    ? Math.min(0.3, (sizeRatio - 0.9) * 3)
    : 0;
  const lengthPenalty = Math.max(overgrowthPenalty, sizePenalty);

  const composite =
    0.5 * correctness + 0.3 * procedure + 0.2 * conciseness - lengthPenalty;
  const bounded = Math.max(0, Math.min(1, composite));

  // Free-form feedback for the decision reason.
  const reasonParts: string[] = [];
  if (correctness < 0.5) reasonParts.push("low failure-mode coverage");
  if (procedure < 0.5) reasonParts.push("weak structure");
  if (conciseness < 0.5) reasonParts.push(`bloated (${(ratio * 100).toFixed(0)}% of base)`);
  if (lengthPenalty > 0) reasonParts.push(`length penalty ${lengthPenalty.toFixed(2)}`);

  return {
    composite: bounded,
    correctness,
    procedure,
    conciseness,
    lengthPenalty,
    feedback: reasonParts.length > 0 ? reasonParts.join("; ") : "looks balanced",
  };
};

/** Scale a 0..1 composite to 0..10 (matches the existing `reviewScore` scale). */
export function toReviewScore(j: JudgeOutput): number {
  return Math.round(j.composite * 10 * 100) / 100;
}
