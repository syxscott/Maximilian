/**
 * Tests for @max/commander.
 *
 * Covers:
 *   - extractJson parses plain JSON
 *   - extractJson extracts JSON from markdown-fenced text
 *   - extractJson returns null for garbage
 *   - defaultPlan adds a review task and depends on all prior tasks
 *   - defaultPlan heuristic: requests mentioning frontend/UI/etc. add
 *     a frontend task
 *   - Commander.plan() uses the planner LLM when it returns valid JSON
 *   - Commander.plan() falls back to defaultPlan when the planner throws
 *   - Commander.plan() always appends a review task even if the LLM
 *     forgot to include one
 *   - Workspace + Plan ids / timestamps are populated correctly
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatResponse, Provider } from "@max/providers";
import { Commander } from "../src/index.js";

function stubProvider(id: string, fn: (system: string, user: string) => string): Provider {
  return {
    id,
    name: `Stub ${id}`,
    defaultModel: "stub-model",
    isConfigured: () => true,
    async chat(messages) {
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const user = messages.find((m) => m.role === "user")?.content ?? "";
      const content = fn(system, user);
      const response: ChatResponse = {
        content,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        finishReason: "stop",
      };
      return response;
    },
    async stream() {
      throw new Error("not used in tests");
    },
  };
}

describe("extractJson (via Commander.plan edge cases)", () => {
  // extractJson is a private helper; we exercise it through Commander.plan
  // which calls the planner provider and routes its output through extractJson.

  it("Commander.plan() uses the planner LLM JSON when valid", async () => {
    const provider = stubProvider("stub", () =>
      JSON.stringify({
        rationale: "Two tasks: backend + review.",
        tasks: [
          { agentRole: "backend", description: "Build the API.", dependsOn: [] },
          { agentRole: "review", description: "Review the API.", dependsOn: ["task-1"] },
        ],
      }),
    );
    const commander = new Commander(() => provider);
    const { plan } = await commander.plan("Build a TODO API");
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0].agentRole).toBe("backend");
    expect(plan.tasks[1].agentRole).toBe("review");
    expect(plan.rationale).toMatch(/backend/i);
  });

  it("Commander.plan() extracts JSON from markdown-fenced text", async () => {
    const provider = stubProvider("stub", () =>
      "```json\n" +
      JSON.stringify({
        rationale: "Frontend + review.",
        tasks: [
          { agentRole: "frontend", description: "Build UI.", dependsOn: [] },
          { agentRole: "review", description: "Review.", dependsOn: ["task-1"] },
        ],
      }) +
      "\n```",
    );
    const commander = new Commander(() => provider);
    const { plan } = await commander.plan("Build a todo web app");
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0].agentRole).toBe("frontend");
  });

  it("Commander.plan() falls back to defaultPlan when the planner throws", async () => {
    const provider: Provider = {
      id: "stub",
      name: "Stub",
      defaultModel: "m",
      isConfigured: () => true,
      async chat() {
        throw new Error("planner down");
      },
      async stream() {
        throw new Error("nope");
      },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const commander = new Commander(() => provider);
    const { plan } = await commander.plan("Solve a math problem");
    // defaultPlan: pure-doc → general + review.
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0].agentRole).toBe("general");
    expect(plan.tasks[1].agentRole).toBe("review");
    expect(plan.tasks[1].dependsOn).toEqual(["task-1"]);
    warn.mockRestore();
  });

  it("Commander.plan() falls back to defaultPlan when planner JSON is unparseable", async () => {
    const provider = stubProvider("stub", () => "this is not json at all");
    const commander = new Commander(() => provider);
    const { plan } = await commander.plan("Anything");
    // defaultPlan heuristic: "anything" doesn't match the frontend pattern.
    expect(plan.tasks[0].agentRole).toBe("general");
    expect(plan.tasks.at(-1)?.agentRole).toBe("review");
  });

  it("Commander.plan() appends a review task if the LLM forgot one", async () => {
    const provider = stubProvider("stub", () =>
      JSON.stringify({
        rationale: "Missing review.",
        tasks: [
          { agentRole: "backend", description: "API.", dependsOn: [] },
        ],
      }),
    );
    const commander = new Commander(() => provider);
    const { plan } = await commander.plan("API only");
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks.at(-1)?.agentRole).toBe("review");
    // The appended review depends on all prior tasks (only task-1 here).
    expect(plan.tasks.at(-1)?.dependsOn).toEqual(["task-1"]);
  });

  it("Commander.plan() populates workspace + plan ids and ISO timestamps", async () => {
    const provider = stubProvider("stub", () =>
      JSON.stringify({
        rationale: "trivial",
        tasks: [
          { agentRole: "general", description: "x", dependsOn: [] },
          { agentRole: "review", description: "y", dependsOn: ["task-1"] },
        ],
      }),
    );
    const commander = new Commander(() => provider);
    const { workspace, plan } = await commander.plan("trivial request");
    expect(workspace.id).toMatch(/^ws-[0-9a-f]{8}$/);
    expect(plan.id).toMatch(/^plan-[0-9a-f]{8}$/);
    expect(workspace.status).toBe("planning");
    expect(plan.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(workspace.createdAt).toBe(plan.createdAt);
    expect(workspace.plan).toBe(plan);
  });
});

describe("defaultPlan heuristic", () => {
  let provider: Provider;
  let commander: Commander;

  beforeEach(() => {
    provider = {
      id: "stub",
      name: "Stub",
      defaultModel: "m",
      isConfigured: () => true,
      async chat() {
        throw new Error("always fails — force defaultPlan");
      },
      async stream() {
        throw new Error("nope");
      },
    };
    commander = new Commander(() => provider);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("frontend-y requests → backend + frontend + review", async () => {
    const { plan } = await commander.plan("Build a todo web app");
    expect(plan.tasks.map((t) => t.agentRole)).toEqual([
      "backend",
      "frontend",
      "review",
    ]);
    expect(plan.tasks[2].dependsOn).toEqual(["task-1", "task-2"]);
  });

  it("non-frontend requests → general + review", async () => {
    const { plan } = await commander.plan("Solve a math problem");
    expect(plan.tasks.map((t) => t.agentRole)).toEqual(["general", "review"]);
  });

  it("UI request (Chinese) triggers frontend branch", async () => {
    const { plan } = await commander.plan("做一个前端 UI");
    expect(plan.tasks.map((t) => t.agentRole)).toContain("frontend");
  });
});

describe("Planner schema — estimatedComplexity + preferredCapabilities (借鉴 1+2)", () => {
  it("propagates estimatedComplexity + preferredCapabilities from LLM JSON into task.metadata", async () => {
    const provider = stubProvider("stub", () =>
      JSON.stringify({
        rationale: "Two tasks with planner-declared complexity.",
        tasks: [
          {
            agentRole: "backend",
            description: "Build REST API for users.",
            dependsOn: [],
            estimatedComplexity: "complex",
            preferredCapabilities: ["api-design", "auth"],
          },
          {
            agentRole: "review",
            description: "Review the API.",
            dependsOn: ["task-1"],
            estimatedComplexity: "simple",
            preferredCapabilities: ["critique"],
          },
        ],
      }),
    );
    const commander = new Commander(() => provider);
    const { plan } = await commander.plan("Build a users API");
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0]!.metadata?.estimatedComplexity).toBe("complex");
    expect(plan.tasks[0]!.metadata?.preferredCapabilities).toEqual(["api-design", "auth"]);
    expect(plan.tasks[1]!.metadata?.estimatedComplexity).toBe("simple");
    expect(plan.tasks[1]!.metadata?.preferredCapabilities).toEqual(["critique"]);
  });

  it("does not set task.metadata when planner omits the new fields", async () => {
    const provider = stubProvider("stub", () =>
      JSON.stringify({
        rationale: "Legacy planner output without complexity hints.",
        tasks: [
          { agentRole: "backend", description: "Build X.", dependsOn: [] },
          { agentRole: "review", description: "Review.", dependsOn: ["task-1"] },
        ],
      }),
    );
    const commander = new Commander(() => provider);
    const { plan } = await commander.plan("anything");
    expect(plan.tasks[0]!.metadata?.estimatedComplexity).toBeUndefined();
    expect(plan.tasks[0]!.metadata?.preferredCapabilities).toBeUndefined();
  });

  it("defaultPlan fallback includes estimatedComplexity + preferredCapabilities", async () => {
    const provider: Provider = {
      id: "stub",
      name: "Stub",
      defaultModel: "m",
      isConfigured: () => true,
      async chat() { throw new Error("force fallback"); },
      async stream() { throw new Error("nope"); },
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const commander = new Commander(() => provider);
    const { plan } = await commander.plan("做一个前端 UI");
    // 3-task frontend branch: backend + frontend + review.
    for (const t of plan.tasks) {
      expect(t.metadata?.estimatedComplexity).toMatch(/^(simple|medium|complex)$/);
      expect(Array.isArray(t.metadata?.preferredCapabilities)).toBe(true);
    }
  });
});

describe("Commander.replan (借鉴 3 — Magentic-One outer loop)", () => {
  it("returns null when remainingTasks is empty (no stall possible)", async () => {
    const provider = stubProvider("stub", () => "{}");
    const commander = new Commander(() => provider);
    const out = await commander.replan("original request", [], []);
    expect(out).toBeNull();
  });

  it("returns replacement tasks when the LLM produces valid JSON", async () => {
    const provider = stubProvider("stub", () =>
      JSON.stringify({
        rationale: "Replace the failing task with a focused sub-task.",
        tasks: [
          {
            agentRole: "general",
            description: "Diagnose why the original task is stuck.",
            dependsOn: [],
            estimatedComplexity: "simple",
            preferredCapabilities: ["debugging"],
          },
          {
            agentRole: "review",
            description: "Verify the diagnosis.",
            dependsOn: ["task-2"],
            estimatedComplexity: "simple",
            preferredCapabilities: ["critique"],
          },
        ],
      }),
    );
    const commander = new Commander(() => provider);
    const out = await commander.replan(
      "build a thing",
      [],
      [{ id: "task-2", agentRole: "general", description: "stuck", status: "pending", dependsOn: [] }],
    );
    expect(out).not.toBeNull();
    expect(out!.tasks).toHaveLength(2);
    // Replan re-uses the original task-2 prefix so dependsOn refs stay valid.
    expect(out!.tasks[0]!.id).toBe("task-2");
    expect(out!.tasks[1]!.id).toBe("task-3");
    expect(out!.tasks[0]!.metadata?.estimatedComplexity).toBe("simple");
  });

  it("returns null when the LLM response is malformed", async () => {
    const provider = stubProvider("stub", () => "definitely not JSON");
    const commander = new Commander(() => provider);
    const out = await commander.replan(
      "x",
      [],
      [{ id: "task-2", agentRole: "general", description: "x", status: "pending", dependsOn: [] }],
    );
    expect(out).toBeNull();
  });

  it("returns null when the LLM throws", async () => {
    const provider: Provider = {
      id: "stub",
      name: "Stub",
      defaultModel: "m",
      isConfigured: () => true,
      async chat() { throw new Error("replan LLM down"); },
      async stream() { throw new Error("nope"); },
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const commander = new Commander(() => provider);
    const out = await commander.replan(
      "x",
      [],
      [{ id: "task-2", agentRole: "general", description: "x", status: "pending", dependsOn: [] }],
    );
    expect(out).toBeNull();
  });

  it("returns null when the LLM JSON has no tasks array", async () => {
    const provider = stubProvider("stub", () =>
      JSON.stringify({ rationale: "no tasks here" }),
    );
    const commander = new Commander(() => provider);
    const out = await commander.replan(
      "x",
      [],
      [{ id: "task-2", agentRole: "general", description: "x", status: "pending", dependsOn: [] }],
    );
    expect(out).toBeNull();
  });
});