/**
 * Backend Agent.
 *
 * Generates server-side code (Node.js / Express / REST API).
 */

import { randomUUID } from "node:crypto";
import { Agent, type AgentContext } from "@max/core";
import type { AgentManifest, Result, Task } from "@max/core";
import type { Provider } from "@max/providers";

const MANIFEST: AgentManifest = {
  role: "backend",
  displayName: "Backend Agent",
  goal: "Generate clean, working server-side code (Node.js / Express / REST API).",
  systemPrompt: `You are the Backend Agent in a multi-agent system.

Your job: generate the server-side portion of the requested software.

Rules:
1. Output ONLY code, no prose before or after.
2. Prefer single-file deliverables (e.g. one server.js file).
3. Wrap code in a single fenced code block with the language tag, e.g. \`\`\`javascript.
4. Use Node.js + Express by default. Persist data in-memory unless asked otherwise.
5. Expose REST endpoints with clear JSON contracts.
6. Include a brief "API Contract" comment block listing endpoints.
`,
};

export class BackendAgent extends Agent {
  override readonly manifest = MANIFEST;

  constructor(provider: Provider) {
    super(provider);
  }

  override async execute(
    task: Task,
    _ctx: AgentContext
  ): Promise<Result> {
    const messages = this.buildMessages(`Task: ${task.description}`);
    const response = await this.provider.chat(messages, {
      temperature: 0.3,
      maxTokens: 4096,
      model: this.getEffectiveModel(),
    });

    return {
      id: randomUUID(),
      taskId: task.id,
      agentRole: "backend",
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