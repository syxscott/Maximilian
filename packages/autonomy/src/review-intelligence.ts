/**
 * 5.2 — ReviewIntelligence
 *
 * Wraps the existing Review Agent to produce StructuredReview
 * (strengths / weaknesses / failurePatterns / improvementSuggestions).
 *
 * Two modes:
 *   - "live": call the LLM via a Provider, parse JSON
 *   - "fallback": synthesize from heuristics (used in tests / offline)
 */

import { randomUUID } from "node:crypto";
import type { Provider } from "@max/providers";
import {
  StructuredReviewSchema,
  type StructuredReview,
} from "./types.js";

export interface ReviewInput {
  taskId: string;
  workspaceId: string;
  artifacts: Array<{ role: string; content: string }>;
  userRequest?: string;
}

export interface ReviewIntelligenceOptions {
  /** Optional LLM provider. If absent, the heuristic fallback is used. */
  provider?: Provider;
  /** Force heuristic mode (used in tests). */
  forceHeuristic?: boolean;
}

export class ReviewIntelligence {
  constructor(private options: ReviewIntelligenceOptions = {}) {}

  async review(input: ReviewInput): Promise<StructuredReview> {
    if (this.options.provider && !this.options.forceHeuristic) {
      return this.liveReview(input);
    }
    return this.heuristicReview(input);
  }

  // --------------------------------------------------------------------------
  // Live mode: call LLM with strict JSON prompt
  // --------------------------------------------------------------------------

  private async liveReview(input: ReviewInput): Promise<StructuredReview> {
    const provider = this.options.provider!;
    const system = `You are the ReviewIntelligence. Output ONLY a JSON object with this exact schema:
{
  "score": <0-10 integer>,
  "strengths": ["short string", ...],
  "weaknesses": ["short string", ...],
  "failurePatterns": ["short string", ...],
  "improvementSuggestions": ["short actionable string", ...],
  "summary": "one paragraph <= 120 words"
}
Be honest. Score of 10 is rare.`;

    const user = `Original user request: ${input.userRequest ?? "(unknown)"}

Artifacts to review:
${input.artifacts.map((a) => `--- ${a.role.toUpperCase()} ---\n${a.content}`).join("\n\n")}

Produce the JSON review now.`;

    const response = await provider.chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { temperature: 0.2, maxTokens: 1500, jsonMode: true }
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.content);
    } catch {
      const match = response.content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("ReviewIntelligence: LLM did not produce valid JSON");
      parsed = JSON.parse(match[0]);
    }

    return this.normalize(input, parsed);
  }

  // --------------------------------------------------------------------------
  // Heuristic mode (deterministic, used in tests and offline)
  // --------------------------------------------------------------------------

  private async heuristicReview(input: ReviewInput): Promise<StructuredReview> {
    const allText = input.artifacts.map((a) => a.content).join("\n");
    const lower = allText.toLowerCase();

    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const failurePatterns: string[] = [];
    const improvementSuggestions: string[] = [];

    if (allText.length > 200) strengths.push("non-trivial output produced");
    if (lower.includes("```")) strengths.push("contains code blocks");
    if (lower.includes("function") || lower.includes("def ")) strengths.push("uses functions");

    if (allText.length < 100) {
      weaknesses.push("output too short");
      failurePatterns.push("truncation");
      improvementSuggestions.push("ensure completeness before returning");
    }
    if (!lower.includes("```") && input.artifacts.some((a) => a.role === "frontend" || a.role === "backend")) {
      weaknesses.push("missing code blocks");
      failurePatterns.push("no_code_blocks");
      improvementSuggestions.push("always wrap generated code in fenced blocks");
    }
    if (lower.includes("error") || lower.includes("undefined is not")) {
      failurePatterns.push("runtime_error");
      improvementSuggestions.push("validate inputs and handle edge cases");
    }
    if (lower.includes("todo") && !lower.includes("```")) {
      failurePatterns.push("placeholder_content");
      improvementSuggestions.push("replace TODO markers with real implementation");
    }

    // Deterministic score: start at 7, -2 per weakness, +1 per strength
    let score = 7 + strengths.length - weaknesses.length * 2;
    score = Math.max(0, Math.min(10, Math.round(score)));

    return this.normalize(input, {
      score,
      strengths: dedupe(strengths),
      weaknesses: dedupe(weaknesses),
      failurePatterns: dedupe(failurePatterns),
      improvementSuggestions: dedupe(improvementSuggestions),
      summary: `Heuristic review of ${input.artifacts.length} artifact(s). ${strengths.length} strengths, ${weaknesses.length} weaknesses, ${failurePatterns.length} failure patterns.`,
    });
  }

  // --------------------------------------------------------------------------

  private normalize(input: ReviewInput, parsed: unknown): StructuredReview {
    const obj = (parsed ?? {}) as Record<string, unknown>;
    return StructuredReviewSchema.parse({
      id: randomUUID(),
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      score: clampScore(obj.score),
      strengths: toStringArray(obj.strengths),
      weaknesses: toStringArray(obj.weaknesses),
      failurePatterns: toStringArray(obj.failurePatterns),
      improvementSuggestions: toStringArray(obj.improvementSuggestions),
      summary: String(obj.summary ?? ""),
      reviewedAt: new Date().toISOString(),
    });
  }
}

function clampScore(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 5;
  return Math.max(0, Math.min(10, Math.round(n)));
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter((s) => s.length > 0);
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}
