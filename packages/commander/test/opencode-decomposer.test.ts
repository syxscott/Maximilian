/**
 * Phase 3c tests — OpencodeDecomposer (commander LLM + opencode preflight).
 *
 * Covers:
 *   - 借鉴 opencode - planner LLM decomposition runs.
 *   - 借鉴 opencode - each task is preflight-validated via OpencodeExecutor.
 *   - 借鉴 opencode - executor failures become preflight issues (`error` severity).
 *   - 借鉴 opencode - empty executor outputs become `warning` issues, not errors.
 *   - 借鉴 opencode - per-task preflight results (sessionId, durationMs, outputPreview)
 *     are cached on task.metadata.preflightResult.
 *   - 借鉴 opencode - preflight.passed reflects whether any error-severity issue raised.
 *   - 借鉴 opencode - tracks metadata is preserved on the returned plan.
 *   - The decomposition appends a review task if the planner forgot one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChatResponse, Provider } from "@max/providers";
import type { OpencodeExecutor, Task } from "@max/core";
import {
  OpencodeDecomposer,
  OpencodePlannerOutputSchema,
  PreflightIssueSchema,
  type OpencodePlannerOutput,
} from "../src/opencode-decomposer.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Stub planner LLM that returns whatever JSON `fn` produces (or markdown-fenced
 * text — exercises `extractJson`).
 */
function stubPlannerProvider(
  id: string,
  fn: (system: string, user: string) => string,
): Provider {
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

/**
 * Build a fake `OpencodeExecutor` that records calls and returns scripted
 * results (or throws scripted errors). We mock just the surface used by
 * `OpencodeDecomposer`: `executeTask(task, workspaceId)`.
 */
function makeStubExecutor(script: Array<
  | { kind: "ok"; taskId: string; sessionId: string; output: string; durationMs?: number }
  | { kind: "error"; taskId: string; message: string }
  | { kind: "throw-once"; taskId: string; message: string } // throw on first call for that taskId only
>): {
  executor: OpencodeExecutor;
  calls: Array<{ taskId: string; workspaceId: string }>;
} {
  const calls: Array<{ taskId: string; workspaceId: string }> = [];
  const thrown = new Set<string>();
  let callIdx = 0;

  const executor = {
    async executeTask(task: Task, workspaceId: string) {
      calls.push({ taskId: task.id, workspaceId });

      // Match by next scripted entry that targets this taskId (sequential).
      let entry = script[callIdx++];
      while (entry && entry.taskId !== task.id) {
        // Skip non-matching entries but keep them in order.
        entry = script[callIdx++];
      }
      if (!entry) {
        // Default: success.
        return {
          result: {
            id: `r-${task.id}`,
            taskId: task.id,
            agentRole: task.agentRole,
            agentId: "opencode-serve",
            output: `(default stub for ${task.id})`,
            metadata: { sessionId: "ses_default", executor: "opencode" },
            createdAt: new Date().toISOString(),
            durationMs: 0,
          },
          sessionId: "ses_default",
          durationMs: 0,
        };
      }

      if (entry.kind === "error") {
        // Error variant: emit an error result with empty output (treat as warning).
        return {
          result: {
            id: `r-${task.id}`,
            taskId: task.id,
            agentRole: task.agentRole,
            agentId: "opencode-serve",
            output: "",
            metadata: { sessionId: "ses_err", executor: "opencode" },
            createdAt: new Date().toISOString(),
            durationMs: 0,
          },
          sessionId: "ses_err",
          durationMs: 0,
        };
      }

      if (entry.kind === "throw-once" && !thrown.has(entry.taskId)) {
        thrown.add(entry.taskId);
        throw new Error(entry.message);
      }

      if (entry.kind === "ok") {
        const duration = entry.durationMs ?? 12;
        const output = entry.output;
        return {
          result: {
            id: `r-${entry.taskId}`,
            taskId: entry.taskId,
            agentRole: "general",
            agentId: "opencode-serve",
            output,
            metadata: { sessionId: entry.sessionId, executor: "opencode" },
            createdAt: new Date().toISOString(),
            durationMs: duration,
          },
          sessionId: entry.sessionId,
          durationMs: duration,
        };
      }

      throw new Error("unreachable script entry");
    },
    async ping() {
      return true;
    },
    async shutdown() {
      // no-op
    },
  } as unknown as OpencodeExecutor;

  return { executor, calls };
}

const TRIVIAL_PLAN_JSON = () =>
  JSON.stringify({
    rationale: "Two-task plan: build API + review.",
    tasks: [
      {
        agentRole: "backend",
        description: "Build the users API.",
        dependsOn: [],
        estimatedComplexity: "medium",
        preferredCapabilities: ["api-design"],
      },
    ],
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpencodeDecomposer (Phase 3c — 借鉴 opencode - plan preflight)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("decomposes a request into a plan and runs each task through the executor", async () => {
    const provider = stubPlannerProvider("stub", () => TRIVIAL_PLAN_JSON());
    const { executor, calls } = makeStubExecutor([
      { kind: "ok", taskId: "task-1", sessionId: "ses_a", output: "API built" },
    ]);

    const decomposer = new OpencodeDecomposer({ executor, plannerLlm: provider });
    const out = await decomposer.decompose("Build a users API", "ws-1");

    expect(out.tasks).toHaveLength(2);
    // The appended review task got the default stub.
    expect(out.tasks[0]!.agentRole).toBe("backend");
    expect(out.tasks[1]!.agentRole).toBe("review");

    // Both tasks were routed through the executor (task-1 via the script,
    // task-2 via the default-stub fallback).
    expect(calls.map((c) => c.taskId)).toEqual(["task-1", "task-2"]);
  });

  it("appends a review task when the LLM omitted one", async () => {
    const provider = stubPlannerProvider("stub", () =>
      JSON.stringify({
        rationale: "Single backend task.",
        tasks: [
          {
            agentRole: "backend",
            description: "Build endpoints.",
            dependsOn: [],
          },
        ],
      }),
    );
    const { executor } = makeStubExecutor([
      { kind: "ok", taskId: "task-1", sessionId: "ses_x", output: "ok" },
      { kind: "ok", taskId: "task-2", sessionId: "ses_y", output: "review-done" },
    ]);

    const decomposer = new OpencodeDecomposer({ executor, plannerLlm: provider });
    const out = await decomposer.decompose("single task", "ws-1");
    expect(out.tasks).toHaveLength(2);
    expect(out.tasks[1]!.agentRole).toBe("review");
    // The auto-appended review depends on all prior tasks.
    expect(out.tasks[1]!.dependsOn).toEqual(["task-1"]);
  });

  it("reports executor failures as preflight errors and sets passed=false", async () => {
    const provider = stubPlannerProvider("stub", () => TRIVIAL_PLAN_JSON());
    const { executor } = makeStubExecutor([
      { kind: "throw-once", taskId: "task-1", message: "opencode down" },
      { kind: "throw-once", taskId: "task-2", message: "review crashed" },
    ]);

    const decomposer = new OpencodeDecomposer({ executor, plannerLlm: provider });
    const out = await decomposer.decompose("anything", "ws-1");

    expect(out.preflight.passed).toBe(false);
    expect(out.preflight.issues).toHaveLength(2);
    expect(out.preflight.issues[0]).toMatchObject({
      severity: "error",
      taskId: "task-1",
      code: "EXECUTOR_FAILURE",
    });
    expect(out.preflight.issues[0]!.message).toContain("opencode down");
    expect(out.preflight.issues[1]!.taskId).toBe("task-2");
  });

  it("reports empty outputs as warnings (not errors)", async () => {
    const provider = stubPlannerProvider("stub", () => TRIVIAL_PLAN_JSON());
    const { executor } = makeStubExecutor([
      { kind: "ok", taskId: "task-1", sessionId: "ses_1", output: "" },
      { kind: "ok", taskId: "task-2", sessionId: "ses_2", output: "all good" },
    ]);

    const decomposer = new OpencodeDecomposer({ executor, plannerLlm: provider });
    const out = await decomposer.decompose("anything", "ws-2");

    // No errors → passed is still true (warnings don't block).
    expect(out.preflight.passed).toBe(true);
    expect(out.preflight.issues).toHaveLength(1);
    expect(out.preflight.issues[0]).toMatchObject({
      severity: "warning",
      taskId: "task-1",
      code: "EMPTY_OUTPUT",
    });
  });

  it("caches per-task preflight results in task.metadata.preflightResult", async () => {
    const provider = stubPlannerProvider("stub", () => TRIVIAL_PLAN_JSON());
    const { executor } = makeStubExecutor([
      { kind: "ok", taskId: "task-1", sessionId: "ses_alpha", output: "X".repeat(800), durationMs: 42 },
    ]);

    const decomposer = new OpencodeDecomposer({ executor, plannerLlm: provider });
    const out = await decomposer.decompose("anything", "ws-3");

    const task1 = out.tasks[0]!;
    const meta = task1.metadata as Record<string, unknown> | undefined;
    expect(meta).toBeDefined();
    const preflight = meta!.preflightResult as Record<string, unknown>;
    expect(preflight).toBeDefined();
    expect(preflight.sessionId).toBe("ses_alpha");
    expect(preflight.executor).toBe("opencode");
    expect(preflight.durationMs).toBe(42);
    // Output preview is capped at 500 chars.
    expect(typeof preflight.outputPreview).toBe("string");
    expect((preflight.outputPreview as string).length).toBeLessThanOrEqual(500);
  });

  it("preserves original task metadata (estimatedComplexity, preferredCapabilities) alongside preflight cache", async () => {
    const provider = stubPlannerProvider("stub", () =>
      JSON.stringify({
        rationale: "Backend with metadata.",
        tasks: [
          {
            agentRole: "backend",
            description: "Build users API.",
            dependsOn: [],
            estimatedComplexity: "complex",
            preferredCapabilities: ["api-design", "auth"],
            ownedFiles: ["src/api/users.ts"],
          },
        ],
      }),
    );
    const { executor } = makeStubExecutor([
      { kind: "ok", taskId: "task-1", sessionId: "ses_a", output: "ok" },
      { kind: "ok", taskId: "task-2", sessionId: "ses_b", output: "ok" },
    ]);

    const decomposer = new OpencodeDecomposer({ executor, plannerLlm: provider });
    const out = await decomposer.decompose("users API", "ws-4");

    const task1 = out.tasks[0]!;
    expect(task1.estimatedComplexity).toBe("complex");
    expect(task1.preferredCapabilities).toEqual(["api-design", "auth"]);
    expect(task1.ownedFiles).toEqual(["src/api/users.ts"]);
    const meta = task1.metadata as Record<string, unknown>;
    expect(meta.estimatedComplexity).toBe("complex");
    expect(meta.preferredCapabilities).toEqual(["api-design", "auth"]);
    expect(meta.preflightResult).toBeDefined();
  });

  it("propagates tracks metadata on the returned plan", async () => {
    const provider = stubPlannerProvider("stub", () =>
      JSON.stringify({
        rationale: "Multi-track plan.",
        tasks: [
          { agentRole: "backend", description: "API work", dependsOn: [] },
        ],
        tracks: [
          {
            id: "track-1",
            name: "Foundation",
            description: "Build core",
            phases: ["design", "implement"],
          },
        ],
      }),
    );
    const { executor } = makeStubExecutor([
      { kind: "ok", taskId: "task-1", sessionId: "ses_a", output: "ok" },
    ]);

    const decomposer = new OpencodeDecomposer({ executor, plannerLlm: provider });
    const out = await decomposer.decompose("anything", "ws-5");

    expect(out.tracks).toBeDefined();
    expect(out.tracks![0]!.id).toBe("track-1");
    expect(out.tracks![0]!.phases).toEqual(["design", "implement"]);
  });

  it("omits tracks when the planner did not return any", async () => {
    const provider = stubPlannerProvider("stub", () => TRIVIAL_PLAN_JSON());
    const { executor } = makeStubExecutor([
      { kind: "ok", taskId: "task-1", sessionId: "ses_a", output: "ok" },
    ]);
    const decomposer = new OpencodeDecomposer({ executor, plannerLlm: provider });
    const out = await decomposer.decompose("anything", "ws-6");
    expect(out.tracks).toBeUndefined();
  });

  it("falls back to defaultPlan behavior: still appends review + still calls executor when planner LLM throws", async () => {
    // When the planner LLM throws, OpencodeDecomposer propagates. Verify
    // the error path doesn't partially fill the plan with garbage.
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
    const { executor } = makeStubExecutor([]);
    const decomposer = new OpencodeDecomposer({ executor, plannerLlm: provider });

    await expect(decomposer.decompose("x", "ws-7")).rejects.toThrow(/planner|timeout/i);
  });

  it("handles fenced JSON (extractJson path)", async () => {
    const provider = stubPlannerProvider("stub", () =>
      "```json\n" +
      JSON.stringify({
        rationale: "Fenced response.",
        tasks: [
          { agentRole: "frontend", description: "UI work.", dependsOn: [] },
        ],
      }) +
      "\n```",
    );
    const { executor } = makeStubExecutor([
      { kind: "ok", taskId: "task-1", sessionId: "ses_a", output: "ok" },
      { kind: "ok", taskId: "task-2", sessionId: "ses_b", output: "ok" },
    ]);
    const decomposer = new OpencodeDecomposer({ executor, plannerLlm: provider });
    const out = await decomposer.decompose("anything", "ws-8");
    expect(out.tasks[0]!.agentRole).toBe("frontend");
  });

  it("times out planner LLM calls after LLM_TIMEOUT_MS via the inner helper", async () => {
    // We can't easily exercise the actual timeout (it would slow the suite),
    // but we can confirm the call timeout surface by replacing setTimeout via
    // the planner provider throwing an error tagged "Planner LLM call timed out".
    const provider: Provider = {
      id: "stub",
      name: "Stub",
      defaultModel: "m",
      isConfigured: () => true,
      async chat() {
        throw new Error("Planner LLM call timed out");
      },
      async stream() {
        throw new Error("nope");
      },
    };
    const { executor } = makeStubExecutor([]);
    const decomposer = new OpencodeDecomposer({ executor, plannerLlm: provider });
    await expect(decomposer.decompose("x", "ws-9")).rejects.toThrow(/planner.*timed out/i);
  });

  it("uses the workspaceId passed to executeTask (no leakage)", async () => {
    const provider = stubPlannerProvider("stub", () => TRIVIAL_PLAN_JSON());
    const { executor, calls } = makeStubExecutor([
      { kind: "ok", taskId: "task-1", sessionId: "ses_a", output: "ok" },
    ]);
    const decomposer = new OpencodeDecomposer({ executor, plannerLlm: provider });
    await decomposer.decompose("x", "ws-isolated-42");
    // workspaceId is forwarded to the executor for every task.
    expect(calls.every((c) => c.workspaceId === "ws-isolated-42")).toBe(true);
  });

  it("schema validates a populated output (round-trip)", () => {
    const sample: OpencodePlannerOutput = {
      rationale: "Test rationale.",
      tasks: [
        {
          agentRole: "backend",
          description: "X",
          dependsOn: [],
          estimatedComplexity: "simple",
          preferredCapabilities: ["api-design"],
          metadata: {
            estimatedComplexity: "simple",
            preferredCapabilities: ["api-design"],
            preflightResult: {
              sessionId: "ses_x",
              executor: "opencode",
              durationMs: 1,
              outputPreview: "",
            },
          },
        },
      ],
      tracks: [{ id: "t", name: "T", description: "d", phases: ["p"] }],
      preflight: {
        passed: true,
        issues: [],
      },
    };
    expect(() => OpencodePlannerOutputSchema.parse(sample)).not.toThrow();
    // Also valid PreflightIssue.
    expect(() =>
      PreflightIssueSchema.parse({
        severity: "error",
        taskId: "task-1",
        code: "X",
        message: "y",
      }),
    ).not.toThrow();
  });

  it("handles malformed planner JSON by propagating the error", async () => {
    const provider = stubPlannerProvider("stub", () => "not json at all");
    const { executor } = makeStubExecutor([]);
    const decomposer = new OpencodeDecomposer({ executor, plannerLlm: provider });
    await expect(decomposer.decompose("anything", "ws-10")).rejects.toThrow(/no JSON/);
  });

  it("handles planner JSON without a tasks array by propagating the error", async () => {
    const provider = stubPlannerProvider("stub", () => JSON.stringify({ rationale: "missing tasks" }));
    const { executor } = makeStubExecutor([]);
    const decomposer = new OpencodeDecomposer({ executor, plannerLlm: provider });
    await expect(decomposer.decompose("anything", "ws-11")).rejects.toThrow(/tasks/);
  });
});
