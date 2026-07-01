/**
 * Review Agent.
 *
 * Reviews all generated outputs and produces a single review verdict.
 * Output format: { score, issues, suggestions, summary }
 */

import { randomUUID } from "node:crypto";
import { Agent, type AgentContext } from "@max/core";
import type { AgentManifest, Result, Task } from "@max/core";
import type { Provider } from "@max/providers";
import type { ReviewResult } from "@max/core";

const MANIFEST: AgentManifest = {
  role: "review",
  displayName: "Review Agent",
  goal: "Critique generated artifacts and produce a structured review.",
  systemPrompt: `You are the Review Agent in a multi-agent system.

Your job: review all generated artifacts and produce a structured verdict.

Output MUST be a single JSON object (no prose, no markdown fences) with this exact shape:
{
  "score": <integer 0-10>,
  "issues": ["<short string>", ...],
  "suggestions": ["<short actionable string>", ...],
  "summary": "<one paragraph <= 120 words>"
}

Review criteria:
1. Correctness — does the code compile / run?
2. Completeness — does it satisfy the original user request?
3. Consistency — do frontend & backend agree on contracts?
4. Code quality — readability, naming, structure.
5. Security & safety — obvious red flags.

Be honest. A score of 10 is rare.
`,
};

export class ReviewAgent extends Agent {
  override readonly manifest = MANIFEST;

  constructor(provider: Provider) {
    super(provider);
  }

  override async execute(
    task: Task,
    ctx: AgentContext
  ): Promise<Result> {
    const bundle = ctx.priorResults
      .map(
        (r) =>
          `--- ${r.agentRole.toUpperCase()} (resultId=${r.id}) ---\n${r.output}`
      )
      .join("\n\n");

    const messages = this.buildMessages(
      `Original user request: ${ctx.priorResults[0]?.metadata?.userRequest ?? "(unknown)"}\n\nArtifacts to review:\n${bundle}\n\nProduce the JSON review now.`
    );

    const response = await this.provider.chat(messages, {
      temperature: 0.2,
      maxTokens: 1500,
      jsonMode: true,
      model: this.getEffectiveModel(),
    });

    let parsed: Omit<ReviewResult, "id" | "workspaceId" | "planId" | "reviewedAt">;
    try {
      parsed = JSON.parse(response.content);
    } catch {
      // Fallback: extract JSON if model wrapped it.
      const match = response.content.match(/\{[\s\S]*\}/);
      if (!match) {
        throw new Error("Review Agent did not produce valid JSON");
      }
      parsed = JSON.parse(match[0]);
    }

    // Validate shape minimally; clamp values.
    const review: ReviewResult = {
      id: randomUUID(),
      workspaceId: "",
      planId: "",
      score: clampScore(parsed.score),
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.map(String)
        : [],
      summary: String(parsed.summary ?? ""),
      reviewedAt: new Date().toISOString(),
    };

    return {
      id: randomUUID(),
      taskId: task.id,
      agentRole: "review",
      agentId: this.id,
      output: JSON.stringify(review, null, 2),
      metadata: { review },
      createdAt: new Date().toISOString(),
    };
  }
}

function clampScore(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 5;
  return Math.max(0, Math.min(10, Math.round(n)));
}