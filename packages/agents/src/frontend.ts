/**
 * Frontend Agent.
 *
 * Generates client-side code (HTML / CSS / JS) based on the task description
 * and any prior results (e.g. backend API contracts).
 */

import { randomUUID } from "node:crypto";
import { Agent, type AgentContext } from "@max/core";
import type { AgentManifest, Result, Task } from "@max/core";
import type { Provider } from "@max/providers";

const MANIFEST: AgentManifest = {
  role: "frontend",
  displayName: "Frontend Agent",
  goal: "Generate clean, working client-side code (HTML / CSS / JavaScript).",
  systemPrompt: `You are the Frontend Agent in a multi-agent system.

Your job: generate the user-facing portion of the requested software.

Rules:
1. Output ONLY code, no prose before or after.
2. Prefer single-file deliverables (HTML with inline CSS/JS) unless the task says otherwise.
3. Wrap code in a single fenced code block with the language tag, e.g. \`\`\`html.
4. Include brief inline comments where helpful.
5. If a backend result already exists in context, consume its API contract.
6. Keep code minimal but functional. No external CDNs unless asked.
`,
};

export class FrontendAgent extends Agent {
  override readonly manifest = MANIFEST;

  constructor(provider: Provider) {
    super(provider);
  }

  override async execute(
    task: Task,
    ctx: AgentContext
  ): Promise<Result> {
    const backendSummary = ctx.priorResults
      .filter((r) => r.agentRole === "backend")
      .map((r) => `Backend result (id=${r.id}):\n${r.output}`)
      .join("\n\n");

    const userMessage = backendSummary
      ? `Task: ${task.description}\n\nAvailable backend output:\n${backendSummary}`
      : `Task: ${task.description}`;

    const messages = this.buildMessages(userMessage);
    const response = await this.provider.chat(messages, {
      temperature: 0.4,
      maxTokens: 4096,
      model: this.getEffectiveModel(),
    });

    return {
      id: randomUUID(),
      taskId: task.id,
      agentRole: "frontend",
      agentId: this.id,
      output: response.content,
      metadata: {
        model: response.model,
        usage: response.usage,
      },
      createdAt: new Date().toISOString(),
      durationMs: undefined,
    };
  }
}