// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Self-critique observation (借鉴 AutoGPT self-critique).
 * @see https://github.com/Significant-Gravitas/AutoGPT/blob/master/autogpt/prompts/prompt.py
 *
 * After each tool-end event, the runtime calls `SelfCritique.observe()` to
 * evaluate whether the last action/output was useful. When the score is
 * consistently low, `shouldReplan()` signals that the planner should
 * generate a replacement plan.
 */

import type { Provider } from "@max/providers";
import type { ChatMessage } from "@max/providers";
import type { SelfCritiqueResult } from "./runtime.js";
import { detectFailures } from "./validation/failure-detector.js";

/**
 * Options for constructing a SelfCritique evaluator.
 */
export interface SelfCritiqueOptions {
  /** LLM provider to use for critique. */
  llm: Provider;
  /** Model to use (default: provider default). */
  model?: string;
  /**
   * Minimum score (0-10) below which a replan is triggered.
   * Default: 3.
   */
  threshold?: number;
}

/**
 * Prompt template for the self-critique LLM call.
 * Evaluates whether the last agent action was useful and provides
 * actionable improvement suggestions.
 */
const CRITIQUE_PROMPT = `You are a self-critique agent observing an agent's recent action and output.

Evaluate whether the action was useful given the overall goal. Score on a 0-10 scale:
- 0-2: harmful or completely wrong — action made things worse
- 3-4: unhelpful — action didn't contribute to the goal
- 5-6: partially useful — action had some value but missed the mark
- 7-8: useful — action contributed meaningfully to the goal
- 9-10: highly effective — action was optimal

Recent action: {lastAction}
Agent output: {lastOutput}

Respond with a JSON object:
{{
  "useful": boolean,       // true if score >= 5
  "score": number,         // 0-10 integer
  "reason": string,        // 1-2 sentence explanation
  "suggestions": string[]  // up to 3 concrete improvement suggestions
}}`;

/**
 * Self-critique module.
 * Observes agent actions and produces quality assessments that can
 * trigger re-planning when the agent is stuck in low-quality loops.
 */
export class SelfCritique {
  private threshold: number;

  constructor(private opts: SelfCritiqueOptions) {
    this.threshold = opts.threshold ?? 3;
  }

  /**
   * Evaluate the quality of the last action/output.
   *
   * @param lastAction - description of the tool/action that was just executed
   * @param lastOutput - the raw output returned by the tool or agent
   * @param historyTail - recent chat history for context (system/assistant/user messages)
   */
  async observe(
    lastAction: string,
    lastOutput: string,
    historyTail: ChatMessage[],
  ): Promise<SelfCritiqueResult> {
    const prompt = CRITIQUE_PROMPT.replace("{lastAction}", lastAction).replace(
      "{lastOutput}",
      lastOutput.slice(0, 1000), // truncate to avoid token blow-up
    );

    const messages: ChatMessage[] = [
      ...historyTail,
      { role: "user", content: prompt },
    ];

    const response = await this.opts.llm.chat(messages, {
      model: this.opts.model,
      temperature: 0,
    });

    let parsed: SelfCritiqueResult | null;
    try {
      // Try to parse as JSON from the response content
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0]! : response.content);
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed.score !== "number") {
      // Fallback: if we can't parse or score is missing, return a neutral result
      parsed = {
        useful: true,
        score: 5,
        reason: `Could not parse critique response: ${response.content.slice(0, 100)}`,
        suggestions: [],
      };
    }

    return { ...parsed, outputText: lastOutput };
  }

  /**
   * Determine whether the agent should replan based on recent critique results.
   *
   * @param results - recent SelfCritiqueResult entries (ordered oldest → newest)
   * @param consecutiveThreshold - number of consecutive low scores to trigger replan (default: 2)
   */
  shouldReplan(
    results: SelfCritiqueResult[],
    consecutiveThreshold = 2,
  ): boolean {
    if (results.length < consecutiveThreshold) return false;

    // Look at the most recent `consecutiveThreshold` results
    const recent = results.slice(-consecutiveThreshold);
    const scoreDriven = recent.every((r) => !r.useful && r.score < this.threshold);

    // Also check for structural failures via FailureDetector (Kosmos pattern).
    // This catches over-interpretation, invented metrics, and rabbit-hole drift
    // even when the LLM critique score is ambiguous.
    const lastResult = recent[recent.length - 1]!;
    const failureDriven = lastResult.outputText
      ? detectFailures(lastResult.outputText).failed
      : false;

    return scoreDriven || failureDriven;
  }
}
