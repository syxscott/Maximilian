/**
 * Commander.
 *
 * Responsibilities:
 *   1. Receive a user request.
 *   2. Call a planner LLM to decompose the request into a Plan of Tasks.
 *   3. Always append a final Review task to gate output quality.
 *   4. Return a Plan object (the Runtime will execute it).
 *
 * MVP behavior:
 *   - Single LLM call for planning.
 *   - Default flow: backend → frontend → review.
 *   - Falls back to a hard-coded plan if the LLM JSON is malformed.
 */

import { randomUUID } from "node:crypto";
import type { Provider, ChatMessage } from "@max/providers";
import type {
  AgentRole,
  Plan,
  Task,
  Workspace,
} from "@max/core";
import { getLogger } from "@max/telemetry";

const log = getLogger("commander");

/**
 * Port for model selection. Mirrors ModelSelector from @max/evolution.
 */
export interface ModelSelectorPort {
  select(role: AgentRole): { provider: string; model: string; score: number; reason: string } | null;
}

const PLANNER_SYSTEM_PROMPT = `You are the Commander (planner) of a multi-agent system.

Given a user request, decompose it into a sequence of tasks. Each task must be
assigned to one of these roles:
- "backend": server-side code generation
- "frontend": client-side code generation
- "general": other code/text work

Always end with a "review" task that depends on all prior tasks.

Output MUST be a single JSON object (no markdown fences) with this exact shape:
{
  "rationale": "<one paragraph explaining the plan>",
  "tasks": [
    {
      "agentRole": "backend" | "frontend" | "general",
      "description": "<clear, actionable task description>",
      "dependsOn": ["<task-id>"] // empty array if no dependency
    },
    ...
    {
      "agentRole": "review",  // ALWAYS last
      "description": "Review all generated artifacts",
      "dependsOn": ["<id-of-every-prior-task>"]
    }
  ]
}

Rules:
1. 1 to 5 production tasks maximum (excluding review).
2. Each task description is self-contained (the agent sees only its own description + prior results).
3. For a typical "build a Todo web app" request: 1 backend + 1 frontend + 1 review.
4. For pure-doc requests: 1 general + 1 review.
`;

export interface PlannerOutput {
  rationale: string;
  tasks: Array<{
    agentRole: AgentRole;
    description: string;
    dependsOn: string[];
  }>;
}

export class Commander {
  private providerRegistry?: Map<string, Provider>;
  private modelSelector?: ModelSelectorPort;

  /**
   * Provider getter — supports runtime default-provider changes.
   * Pass `() => registry.default()!` (or any function returning the current
   * Provider) so planning reflects the live default, not a stale snapshot
   * captured at Commander construction time.
   */
  constructor(
    private getProvider: () => Provider,
    options?: {
      providerRegistry?: Map<string, Provider>;
      modelSelector?: ModelSelectorPort;
    }
  ) {
    this.providerRegistry = options?.providerRegistry;
    this.modelSelector = options?.modelSelector;
  }

  /**
   * Resolve the best provider for planning.
   * Uses model selector if available, otherwise falls back to default.
   */
  private resolveProvider(): Provider {
    if (this.modelSelector) {
      const selection = this.modelSelector.select("general");
      if (selection && this.providerRegistry) {
        const preferred = this.providerRegistry.get(selection.provider);
        if (preferred) return preferred;
      }
    }
    return this.getProvider();
  }

  /**
   * Create a new workspace for a user request and produce an initial Plan.
   */
  async plan(userRequest: string): Promise<{ workspace: Workspace; plan: Plan }> {
    const workspaceId = `ws-${randomUUID().slice(0, 8)}`;
    const planId = `plan-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    let planner: PlannerOutput;
    try {
      planner = await this.callPlanner(userRequest);
    } catch (err) {
      log.warn({ err }, "planner LLM failed, falling back to default plan");
      planner = defaultPlan(userRequest);
    }

    // Materialize task ids in deterministic order.
    const tasks: Task[] = planner.tasks.map((t, i) => ({
      id: `task-${i + 1}`,
      agentRole: t.agentRole,
      description: t.description,
      status: "pending" as const,
      dependsOn: t.dependsOn,
    }));

    const plan: Plan = {
      id: planId,
      workspaceId,
      userRequest,
      rationale: planner.rationale,
      tasks,
      createdAt: now,
    };

    const workspace: Workspace = {
      id: workspaceId,
      userRequest,
      status: "planning",
      plan,
      results: [],
      createdAt: now,
      updatedAt: now,
      metadata: {},
    };

    return { workspace, plan };
  }

  private async callPlanner(userRequest: string): Promise<PlannerOutput> {
    const provider = this.resolveProvider();
    const messages: ChatMessage[] = [
      { role: "system", content: PLANNER_SYSTEM_PROMPT },
      { role: "user", content: userRequest },
    ];
    const response = await provider.chat(messages, {
      temperature: 0.3,
      maxTokens: 1500,
      jsonMode: true,
    });

    const raw = response.content;
    const json = extractJson(raw);
    if (!json) throw new Error("Planner produced no JSON");
    const parsed = JSON.parse(json) as PlannerOutput;

    if (!parsed.tasks || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
      throw new Error("Planner JSON missing 'tasks'");
    }

    // Validate that last task is a review.
    const last = parsed.tasks[parsed.tasks.length - 1];
    if (!last || last.agentRole !== "review") {
      parsed.tasks.push({
        agentRole: "review",
        description: "Review all generated artifacts",
        dependsOn: parsed.tasks
          .filter((_, i) => i < parsed.tasks.length)
          .map((_, i) => `task-${i + 1}`),
      });
    }

    return parsed;
  }
}

function defaultPlan(userRequest: string): PlannerOutput {
  // Heuristic: if request mentions "前端"/"frontend"/"UI"/"html"/"界面" → add frontend task.
  const lower = userRequest.toLowerCase();
  const wantsFrontend =
    /前端|frontend|ui|html|界面|web|page|页面|网站/.test(lower);

  const tasks: PlannerOutput["tasks"] = [];

  if (wantsFrontend) {
    tasks.push({
      agentRole: "backend",
      description: `Design and implement the backend service for: ${userRequest}. Expose REST endpoints with a clear JSON contract.`,
      dependsOn: [],
    });
    tasks.push({
      agentRole: "frontend",
      description: `Implement the frontend (HTML/CSS/JS) for: ${userRequest}. Consume the backend API contract from the prior backend result.`,
      dependsOn: ["task-1"],
    });
    tasks.push({
      agentRole: "review",
      description: "Review all generated artifacts.",
      dependsOn: ["task-1", "task-2"],
    });
  } else {
    tasks.push({
      agentRole: "general",
      description: `Implement: ${userRequest}`,
      dependsOn: [],
    });
    tasks.push({
      agentRole: "review",
      description: "Review the generated artifact.",
      dependsOn: ["task-1"],
    });
  }

  return {
    rationale: "Heuristic fallback plan (planner LLM unavailable).",
    tasks,
  };
}

function extractJson(text: string): string | null {
  // Try direct parse first.
  try {
    JSON.parse(text);
    return text;
  } catch {
    // Try to find first {...} block.
    const match = text.match(/\{[\s\S]*\}/);
    return match ? match[0] : null;
  }
}