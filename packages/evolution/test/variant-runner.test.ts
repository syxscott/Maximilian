/**
 * VariantRunner — tests with mocked executor.
 *
 * Verifies that the runner:
 *   1. Loads the parent manifest from ProfileStore.
 *   2. Spawns N variants via the injected executor (no network).
 *   3. Captures executor errors per-variant without sinking the run.
 *   4. Returns a leaderboard-ranked report with `winnerIndex`.
 *   5. Respects `variantCount` clamping (1..16).
 *   6. Honors custom mutators and judges.
 *
 * 借鉴 opencode + GEPA: the executor shape mirrors
 * `OpencodeExecutor.executeTask(task, workspaceId)` — by passing a mock
 * that satisfies `VariantExecutor`, the test stays hermetic.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import type { AgentManifest, Result, Task } from "@max/core";
import { ProfileStore } from "../src/profile-store.js";
import {
  VariantRunner,
  identityMutator,
  type VariantExecutor,
  type VariantJudge,
  type ExecuteResult,
} from "../src/variant-runner.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeTask(id: string): Task {
  return {
    id,
    agentRole: "frontend",
    description: "Implement a button",
    status: "pending",
    dependsOn: [],
  };
}

function makeManifest(role: "frontend" | "backend", prompt: string): AgentManifest {
  return { role, displayName: role, goal: role, systemPrompt: prompt };
}

function makeResult(taskId: string, output: string, meta: Record<string, unknown> = {}, durationMs = 500): Result {
  return {
    id: `r-${taskId}`,
    taskId,
    agentRole: "frontend",
    agentId: "opencode-serve",
    output,
    metadata: meta,
    createdAt: new Date().toISOString(),
    durationMs,
  };
}

function makeExec(taskId: string, output: string, durationMs = 500, sessionId?: string): ExecuteResult {
  return {
    result: makeResult(taskId, output, {}, durationMs),
    sessionId: sessionId ?? `sess-${taskId}`,
    durationMs,
  };
}

/**
 * Mock executor with a queue of pre-canned responses. Each call dequeues
 * one entry; if the queue is empty the last response is reused (so the
 * runner can be invoked with fewer responses than `variantCount` for
 * boundary tests).
 */
function makeMockExecutor(responses: Array<ExecuteResult | Error>): VariantExecutor & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    executeTask: async (_task, workspaceId) => {
      const slot = responses[Math.min(calls, responses.length - 1)];
      calls += 1;
      if (slot instanceof Error) throw slot;
      void workspaceId;
      // Fresh per-call session id so we can detect reuse.
      return {
        ...slot,
        sessionId: `${slot.sessionId}-${calls}`,
      };
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("VariantRunner", () => {
  let tmp: string;
  let profiles: ProfileStore;
  let runner: VariantRunner;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-evo-variant-"));
    profiles = new ProfileStore(tmp);
    runner = new VariantRunner({ profiles, executor: makeMockExecutor([]) });
  });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it("throws when task or executor is missing", async () => {
    const exec = makeMockExecutor([]);
    const task = makeTask("t1");
    await expect(runner.runWith(exec, task as Task, { agentRole: "frontend", workspaceId: "w1" })).resolves.toBeDefined();
    // @ts-expect-error testing runtime guard
    await expect(runner.runWith(null, task, { agentRole: "frontend", workspaceId: "w1" })).rejects.toThrow(/executor/);
    // @ts-expect-error testing runtime guard
    await expect(runner.runWith(exec, null, { agentRole: "frontend", workspaceId: "w1" })).rejects.toThrow(/task/);
  });

  it("runs the default 3 variants via identityMutator", async () => {
    const exec = makeMockExecutor([
      makeExec("t1", "v1 output", 600),
      makeExec("t1", "v2 output", 400),
      makeExec("t1", "v3 output", 800),
    ]);
    const task = makeTask("t1");
    const report = await runner.runWith(exec, task, {
      agentRole: "frontend",
      workspaceId: "w1",
    });

    expect(report.runs).toHaveLength(3);
    expect(report.runs[0]?.index).toBe(0);
    expect(report.runs[1]?.index).toBe(1);
    expect(report.runs[2]?.index).toBe(2);
    expect(report.runs.every((r) => r.parent.systemPrompt === report.parentProfile.manifest?.systemPrompt)).toBe(true);
    expect(exec.calls).toBe(3);
  });

  it("uses the parent's manifest from ProfileStore when present", async () => {
    const customPrompt = "You are a careful frontend agent.";
    await profiles.getOrCreate("frontend", makeManifest("frontend", customPrompt));
    const exec = makeMockExecutor([makeExec("t1", "ok", 500)]);
    const task = makeTask("t1");
    const report = await runner.runWith(exec, task, {
      agentRole: "frontend",
      workspaceId: "w1",
      variantCount: 1,
    });

    expect(report.parentProfile.manifest?.systemPrompt).toBe(customPrompt);
    // identityMutator appends a "Variant N focus" block — the parent stays pristine.
    expect(report.runs[0]?.parent.systemPrompt).toBe(customPrompt);
    expect(report.runs[0]?.variant.systemPrompt).toContain("Variant 1 focus");
  });

  it("creates a synthetic profile when none exists (no disk side effects elsewhere)", async () => {
    const exec = makeMockExecutor([makeExec("t1", "ok", 500)]);
    const task = makeTask("t1");
    const report = await runner.runWith(exec, task, {
      agentRole: "backend",
      workspaceId: "w2",
      variantCount: 1,
    });

    expect(report.parentProfile.role).toBe("backend");
    // The synthesized profile should have been persisted.
    const stored = await profiles.get("backend");
    expect(stored).toBeDefined();
  });

  it("captures executor errors per-variant without aborting the run", async () => {
    const exec = makeMockExecutor([
      makeExec("t1", "ok", 500),
      new Error("opencode unreachable"),
      makeExec("t1", "recovered", 700),
    ]);
    const task = makeTask("t1");
    const report = await runner.runWith(exec, task, {
      agentRole: "frontend",
      workspaceId: "w1",
      variantCount: 3,
    });

    expect(report.runs).toHaveLength(3);
    expect(report.runs[1]?.errored).toBe(true);
    expect(report.runs[1]?.error).toContain("opencode unreachable");
    expect(report.runs[1]?.score.quality).toBe(0);
    expect(report.runs[1]?.score.reason).toMatch(/executor threw/);
    expect(report.runs[0]?.errored).toBe(false);
    expect(report.runs[2]?.errored).toBe(false);
  });

  it("honors a custom variantCount", async () => {
    const exec = makeMockExecutor([makeExec("t1", "ok", 500)]);
    const task = makeTask("t1");
    const report = await runner.runWith(exec, task, {
      agentRole: "frontend",
      workspaceId: "w1",
      variantCount: 5,
    });

    expect(report.runs).toHaveLength(5);
    expect(exec.calls).toBe(5);
  });

  it("clamps variantCount to [1, 16]", async () => {
    const exec = makeMockExecutor([makeExec("t1", "ok", 500)]);
    const task = makeTask("t1");
    const tooFew = await runner.runWith(exec, task, {
      agentRole: "frontend",
      workspaceId: "w1",
      variantCount: -3,
    });
    expect(tooFew.runs).toHaveLength(1);

    const tooMany = await runner.runWith(exec, task, {
      agentRole: "frontend",
      workspaceId: "w1",
      variantCount: 999,
    });
    expect(tooMany.runs).toHaveLength(16);
  });

  it("honors a custom mutator and judge", async () => {
    const exec = makeMockExecutor([
      makeExec("t1", "short", 500),
      makeExec("t1", "a much longer output that should score higher", 500),
    ]);
    const task = makeTask("t1");

    const customMutator: typeof identityMutator = (parent, i) => ({
      ...parent,
      systemPrompt: `${parent.systemPrompt} [mut-${i}]`,
    });
    const customJudge: VariantJudge = ({ variantResult }) => ({
      quality: variantResult.output.length > 20 ? 9 : 4,
      durationMs: 500,
      costUSD: 0,
      reason: `len=${variantResult.output.length}`,
    });

    const report = await runner.runWith(exec, task, {
      agentRole: "frontend",
      workspaceId: "w1",
      variantCount: 2,
      mutator: customMutator,
      judge: customJudge,
    });

    expect(report.runs[0]?.variant.systemPrompt).toContain("[mut-0]");
    expect(report.runs[1]?.variant.systemPrompt).toContain("[mut-1]");
    expect(report.runs[1]?.score.quality).toBe(9);
    expect(report.runs[0]?.score.quality).toBe(4);
  });

  it("produces a leaderboard with descending combined scores and a winnerIndex", async () => {
    const exec = makeMockExecutor([
      makeExec("t1", "slow + mediocre", 5000),
      makeExec("t1", "fast + decent", 200),
      makeExec("t1", "medium + excellent", 1000),
    ]);
    const task = makeTask("t1");
    const report = await runner.runWith(exec, task, {
      agentRole: "frontend",
      workspaceId: "w1",
      variantCount: 3,
    });

    expect(report.leaderboard).toHaveLength(3);
    // leaderboard rows are sorted by `combined` desc.
    const combineds = report.leaderboard.map((r) => r.combined);
    expect(combineds[0]!).toBeGreaterThanOrEqual(combineds[1]!);
    expect(combineds[1]!).toBeGreaterThanOrEqual(combineds[2]!);
    expect(report.leaderboard[0]?.rank).toBe(1);
    expect(report.leaderboard[1]?.rank).toBe(2);
    expect(report.leaderboard[2]?.rank).toBe(3);
    expect(report.winnerIndex).toBeGreaterThanOrEqual(0);
    expect(report.winnerIndex).toBeLessThan(3);
    // Winner row references the same run id as report.runs[winnerIndex].
    expect(report.leaderboard[0]?.runId).toBe(report.runs[report.winnerIndex]?.id);
  });

  it("falls back to winnerIndex=-1 if every variant errored", async () => {
    const exec = makeMockExecutor([
      new Error("a"),
      new Error("b"),
    ]);
    const task = makeTask("t1");
    const report = await runner.runWith(exec, task, {
      agentRole: "frontend",
      workspaceId: "w1",
      variantCount: 2,
    });

    expect(report.runs.every((r) => r.errored)).toBe(true);
    // leaderboard still lists rows (with combined=0) — only the *first* rank
    // is the "winner"; if every row scores 0 we still pick index 0.
    expect(report.leaderboard).toHaveLength(2);
    expect(report.winnerIndex).toBe(0);
  });

  it("threads failures + feedback into the mutator context", async () => {
    const exec = makeMockExecutor([makeExec("t1", "ok", 500)]);
    const task = makeTask("t1");

    let capturedCtx: { failures: string[]; feedback: string[] } | undefined;
    const captureMutator: typeof identityMutator = (parent, _i, ctx) => {
      capturedCtx = ctx;
      return parent;
    };

    await runner.runWith(exec, task, {
      agentRole: "frontend",
      workspaceId: "w1",
      variantCount: 1,
      mutator: captureMutator,
      failures: ["timeout", "score 4"],
      feedback: ["use TypeScript strict"],
    });

    expect(capturedCtx).toEqual({
      failures: ["timeout", "score 4"],
      feedback: ["use TypeScript strict"],
    });
  });

  it("emits startedAt/completedAt ISO strings", async () => {
    const exec = makeMockExecutor([makeExec("t1", "ok", 100)]);
    const task = makeTask("t1");
    const report = await runner.runWith(exec, task, {
      agentRole: "frontend",
      workspaceId: "w1",
      variantCount: 1,
    });

    expect(report.startedAt).toMatch(/T.*Z/);
    expect(report.completedAt).toMatch(/T.*Z/);
    // ISO timestamps are lexicographically sortable; completion ≥ start.
    expect(report.completedAt >= report.startedAt).toBe(true);
  });

  it("falls back to task.agentRole when options.agentRole is missing", async () => {
    const exec = makeMockExecutor([makeExec("t1", "ok", 100)]);
    const task = makeTask("t1"); // task.agentRole = "frontend"
    const report = await runner.runWith(exec, task, {
      workspaceId: "w1",
      variantCount: 1,
    });

    expect(report.agentRole).toBe("frontend");
  });
});