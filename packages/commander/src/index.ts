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
  Result,
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
assigned to one of these roles based on the agent's declared capabilities.

## Available agents and their capabilities

- "backend": server-side code generation.
  Strengths: REST APIs, DB schemas, auth, business logic, migrations, integrations.
  Use for: any server-side / API / database request.
- "frontend": client-side code generation.
  Strengths: HTML/CSS/JS, UI components, single-file demos, browser interaction.
  Use for: any UI / page / user-facing request.
- "general": anything else (configs, docs, scripts, plain text).
  Default fallback when neither backend nor frontend clearly fits.
- "review": critique-only; reviews all prior outputs and returns a JSON verdict.
  ALWAYS last; depends on every prior task.

## Task fields

For each task, output:
- "agentRole": one of "backend" | "frontend" | "general" (review is appended automatically if missing)
- "description": self-contained task description (the agent sees only its own description + prior results)
- "dependsOn": array of task-ids this task depends on (empty if no dependency)
- "estimatedComplexity": "simple" | "medium" | "complex"
  - simple: a one-line change, rename, trivial fix (< 80 chars description OR explicit keywords like "fix typo", "rename")
  - complex: refactor, migration, performance, security, architecture (> 500 chars OR keywords like "refactor", "migrate", "design system")
  - medium: anything in between
- "preferredCapabilities": array of capability tags this task needs (free-form strings drawn from the agent's strength list above; e.g. ["api-design", "auth"], ["ui-rendering"], ["docs"])

Always end with a "review" task that depends on all prior tasks (the runtime appends it automatically if missing).

Output MUST be a single JSON object (no markdown fences) with this exact shape:
{
  "rationale": "<one paragraph explaining the plan and why these capabilities/agents fit>",
  "tasks": [
    {
      "agentRole": "backend" | "frontend" | "general",
      "description": "<clear, actionable task description>",
      "dependsOn": ["<task-id>"],
      "estimatedComplexity": "simple" | "medium" | "complex",
      "preferredCapabilities": ["<capability-tag>", ...]
    },
    ...
  ]
}

Rules:
1. 1 to 5 production tasks maximum (excluding review).
2. Each task description is self-contained.
3. Match each task's agentRole to the agent whose declared capability best fits the task.
4. The "preferredCapabilities" tags should describe what kind of work the task needs (drawn from the agent's strength list, e.g. ["api-design"], ["ui-rendering"]).
5. The "estimatedComplexity" guides model selection — be honest about task difficulty.
6. For a typical "build a Todo web app" request: 1 backend + 1 frontend + 1 review.
7. For pure-doc requests: 1 general + 1 review.
`;

export interface PlannerOutput {
  rationale: string;
  tasks: Array<{
    agentRole: AgentRole;
    description: string;
    dependsOn: string[];
    estimatedComplexity?: "simple" | "medium" | "complex";
    preferredCapabilities?: string[];
  }>;
}

/**
 * Output of `Commander.replan`. Same shape as `PlannerOutput` but
 * `rationale` is optional (replans often have short justifications).
 */
export interface ReplanOutput {
  rationale?: string;
  tasks: Array<{
    agentRole: AgentRole;
    description: string;
    dependsOn: string[];
    estimatedComplexity?: "simple" | "medium" | "complex";
    preferredCapabilities?: string[];
  }>;
}

const REPLANNER_SYSTEM_PROMPT = `You are the Commander re-planner of a multi-agent system.

The original plan has stalled — some tasks completed but the system has been
idle for several rounds with no progress on the remaining tasks. Your job is
to revise ONLY the remaining tasks so the system can move forward.

Inputs:
- The original user request
- The list of completed results (each has agentRole + truncated output)
- The list of remaining tasks that have NOT started or completed

Output a JSON object with the new set of remaining tasks (replacement list,
NOT a continuation — the runtime will replace the pending list with whatever
you return). Keep the same task id scheme ("task-N") for tasks you're
re-using, and use "task-N+" for new tasks if you want to add more.

For each task, output:
- "agentRole": "backend" | "frontend" | "general" | "review"
- "description": self-contained task description
- "dependsOn": array of existing task-ids (completed or other remaining) this task depends on
- "estimatedComplexity": "simple" | "medium" | "complex"
- "preferredCapabilities": array of capability tags

Strategies for unblocking a stall:
1. Break a stalled task into smaller sub-tasks (e.g. "implement X" → "design X interface" + "implement X function").
2. Switch the agent role if the work doesn't match the original assignment.
3. Add a clarifying intermediate task that produces a concrete artifact the next task can consume.
4. If a task seems already-done by an earlier result, drop it.

Output MUST be a single JSON object:
{
  "rationale": "<one paragraph explaining the replan>",
  "tasks": [ { ... }, ... ]
}

Rules:
1. Output ONLY remaining tasks (do not duplicate completed work).
2. Keep the same set of agent capabilities as the original plan (don't invent new roles).
3. If you can't see a clear path forward, return the original remaining tasks unchanged.
`;

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
    const tasks: Task[] = planner.tasks.map((t, i) => {
      const metadata: Record<string, unknown> = {};
      if (t.estimatedComplexity) metadata.estimatedComplexity = t.estimatedComplexity;
      if (t.preferredCapabilities && t.preferredCapabilities.length > 0) {
        metadata.preferredCapabilities = t.preferredCapabilities;
      }
      return {
        id: `task-${i + 1}`,
        agentRole: t.agentRole,
        description: t.description,
        status: "pending" as const,
        dependsOn: t.dependsOn,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      };
    });

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

  /**
   * Re-plan the remaining tasks after a stall.
   *
   * Mirrors Magentic-One's outer-loop: when the Orchestrator observes that
   * progress has stopped, it re-writes the Task Ledger. Here we ask an LLM
   * to revise the remaining task list given the completed results so far.
   *
   * Returns:
   * - `{ tasks: [...] }` if the replanner produced new tasks. Caller is
   *   responsible for swapping them into the runtime's pending list.
   * - `null` if the LLM failed, the response was malformed, or the replanner
   *   explicitly returned the original remaining tasks unchanged. In all
   *   failure cases the caller should keep executing the original plan.
   *
   * The replanner intentionally receives *only* the truncated output of
   * completed results so it can't blow the context window on long-running
   * workspaces.
   */
  async replan(
    userRequest: string,
    completedResults: Result[],
    remainingTasks: Task[],
  ): Promise<{ tasks: Task[] } | null> {
    if (remainingTasks.length === 0) {
      // Nothing to replan — no stall possible.
      return null;
    }

    const summary = this.summariseResults(completedResults);
    const remainingListing = remainingTasks
      .map((t) => `- [${t.id}] (${t.agentRole}, status=${t.status}) ${t.description}`)
      .join("\n");

    const userMessage =
      `Original user request: ${userRequest}\n\n` +
      `Completed results (${completedResults.length}):\n${summary}\n\n` +
      `Remaining tasks to replan (${remainingTasks.length}):\n${remainingListing}\n\n` +
      `Return the revised remaining-task list as JSON.`;

    try {
      const provider = this.resolveProvider();
      const messages: ChatMessage[] = [
        { role: "system", content: REPLANNER_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ];
      const response = await provider.chat(messages, {
        temperature: 0.3,
        maxTokens: 1500,
        jsonMode: true,
      });
      const json = extractJson(response.content);
      if (!json) return null;
      const parsed = JSON.parse(json) as ReplanOutput;
      if (!parsed.tasks || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
        return null;
      }

      // Materialize: assign sequential ids preserving the first remaining
      // task's prefix so existing plan ids stay valid for dependsOn refs.
      const startIdx = remainingTasks[0]?.id.match(/task-(\d+)/)?.[1];
      const offset = startIdx ? Number(startIdx) - 1 : 0;
      const tasks: Task[] = parsed.tasks.map((t, i) => {
        const metadata: Record<string, unknown> = {};
        if (t.estimatedComplexity) metadata.estimatedComplexity = t.estimatedComplexity;
        if (t.preferredCapabilities && t.preferredCapabilities.length > 0) {
          metadata.preferredCapabilities = t.preferredCapabilities;
        }
        return {
          id: `task-${offset + i + 1}`,
          agentRole: t.agentRole,
          description: t.description,
          status: "pending" as const,
          dependsOn: t.dependsOn,
          ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        };
      });

      log.info({
        userRequest: userRequest.slice(0, 80),
        completedCount: completedResults.length,
        originalRemaining: remainingTasks.length,
        newRemaining: tasks.length,
      }, "replan produced new task list");
      return { tasks };
    } catch (err) {
      log.warn({ err }, "replan LLM failed — caller will keep original plan");
      return null;
    }
  }

  /** Build a compact summary of completed results for the replanner prompt. */
  private summariseResults(results: Result[]): string {
    if (results.length === 0) return "(none)";
    return results
      .map((r) => {
        const snippet = r.output.length > 200 ? r.output.slice(0, 200) + "…" : r.output;
        return `- [${r.taskId}] (${r.agentRole}): ${snippet}`;
      })
      .join("\n");
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
      estimatedComplexity: "medium",
      preferredCapabilities: ["api-design"],
    });
    tasks.push({
      agentRole: "frontend",
      description: `Implement the frontend (HTML/CSS/JS) for: ${userRequest}. Consume the backend API contract from the prior backend result.`,
      dependsOn: ["task-1"],
      estimatedComplexity: "medium",
      preferredCapabilities: ["ui-rendering"],
    });
    tasks.push({
      agentRole: "review",
      description: "Review all generated artifacts.",
      dependsOn: ["task-1", "task-2"],
      estimatedComplexity: "simple",
      preferredCapabilities: ["critique"],
    });
  } else {
    tasks.push({
      agentRole: "general",
      description: `Implement: ${userRequest}`,
      dependsOn: [],
      estimatedComplexity: "medium",
      preferredCapabilities: ["general"],
    });
    tasks.push({
      agentRole: "review",
      description: "Review the generated artifact.",
      dependsOn: ["task-1"],
      estimatedComplexity: "simple",
      preferredCapabilities: ["critique"],
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