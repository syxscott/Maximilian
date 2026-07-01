/**
 * Phase 5 — Autonomy closed-loop integration tests.
 *
 * These tests verify the full observe() pipeline running across multiple
 * workspaces and feeding into the LearningAPI dashboard surfaces.
 *
 * Run with: pnpm --filter @max/api test
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import type { Provider } from "@max/providers";
import type { Workspace, Result, Task, Plan } from "@max/core";
import { EvolutionFacade } from "@max/evolution";
import { DAGS } from "@max/dags";
import {
  ExecutionStore,
  ReviewIntelligence,
  InsightsStore,
  FailurePatternAnalyzer,
  EvolutionPlanner,
  CandidateGenerator,
  PromotionEngine,
  LearningAPI,
  AutonomyOrchestrator,
  DEFAULT_PROMOTION_CONFIG,
  type ExecutionRecord,
} from "@max/autonomy";

function makeProvider(id: string, model: string): Provider {
  return {
    id,
    name: id,
    defaultModel: model,
    isConfigured: () => true,
    chat: async () => ({
      content: "```html\n<html><body>OK</body></html>\n```",
      model,
    }),
    stream: async function* () { yield { delta: "ok", done: true }; },
  };
}

async function makeTmp(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "max-autonomy-int-"));
}

function makeWorkspace(
  id: string,
  userRequest: string,
  tasks: Array<{ id: string; role: string; score: number }>
): Workspace {
  const planTasks: Task[] = tasks.map((t) => ({
    id: t.id,
    agentRole: t.role as Task["agentRole"],
    description: `${t.role} task`,
    status: "completed" as const,
    dependsOn: [],
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  }));
  const plan: Plan = {
    id: `plan-${id}`,
    workspaceId: id,
    userRequest,
    rationale: "integration",
    tasks: planTasks,
    createdAt: new Date().toISOString(),
  };
  const results: Result[] = tasks.map((t) => ({
    id: `res-${t.id}`,
    taskId: t.id,
    agentRole: t.role as Result["agentRole"],
    agentId: `agent-${t.role}`,
    output: "```html\n<html><body>OK</body></html>\n```",
    metadata: {
      blueprintId: `bp-${t.role}-v1`,
      blueprintVersion: "v1",
      provider: "mock",
      model: "mock-1",
      artifacts: [`${t.role}-artifact.html`],
    },
    createdAt: new Date().toISOString(),
    durationMs: 100,
  }));
  return {
    id,
    userRequest,
    status: "completed",
    plan,
    results,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

interface Harness {
  tmp: string;
  store: ExecutionStore;
  insights: InsightsStore;
  analyzer: FailurePatternAnalyzer;
  gen: CandidateGenerator;
  planner: EvolutionPlanner;
  promo: PromotionEngine;
  review: ReviewIntelligence;
  dags: DAGS;
  orchestrator: AutonomyOrchestrator;
  learning: LearningAPI;
  facade: EvolutionFacade;
}

async function makeHarness(tmp: string): Promise<Harness> {
  const provider = makeProvider("mock", "mock-1");
  const facade = new EvolutionFacade({
    rootDir: tmp,
    candidates: [provider],
    fallbackProvider: provider,
    defaultManifests: {},
  });
  await facade.initialize();
  const dags = new DAGS({ rootDir: tmp, evolution: facade, candidates: [provider] });
  const store = new ExecutionStore(tmp);
  const insights = new InsightsStore(tmp);
  const analyzer = new FailurePatternAnalyzer(insights);
  const gen = new CandidateGenerator(tmp);
  // Integration tests need a low minExecutions to trigger planning on a
  // single observe() call.
  const planner = new EvolutionPlanner(tmp, {
    minExecutions: 1,
    scoreThreshold: 6.0,
    acceptanceThreshold: 0.5,
    topFailureCount: 3,
  });
  const promo = new PromotionEngine(tmp, gen);
  await promo.loadHistory();
  const review = new ReviewIntelligence({ forceHeuristic: true });
  const orchestrator = new AutonomyOrchestrator({
    dags,
    review,
    executionStore: store,
    insightsStore: insights,
    failureAnalyzer: analyzer,
    planner,
    candidateGenerator: gen,
    promotionEngine: promo,
  });
  const learning = new LearningAPI(store, insights, analyzer, gen, promo, planner);
  return { tmp, store, insights, analyzer, gen, planner, promo, review, dags, orchestrator, learning, facade };
}

// ============================================================================
// Integration test 1 — closed loop produces a candidate
// ============================================================================

describe("Integration: closed-loop observe()", () => {
  let tmp: string;
  let h: Harness;

  beforeEach(async () => { tmp = await makeTmp(); h = await makeHarness(tmp); });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it("drives a weak workspace through reviews, plans, candidates, and status updates", async () => {
    // Seed the blueprint store so planner.resolveBlueprint() finds a parent.
    await h.dags.store.save({
      id: "bp-frontend-v1",
      role: "frontend",
      displayName: "Frontend",
      goal: "Build UI",
      systemPrompt: "You are a frontend engineer.",
      capabilities: ["frontend"],
      tools: [],
      preferredModels: [],
      constraints: { outputFormat: "code" },
      version: "v1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stats: { totalTasks: 0, totalSuccesses: 0, avgScore: 0, avgExecutionTimeMs: 0 },
      metadata: {},
    });

    const ws = makeWorkspace("ws-1", "build a frontend", [
      { id: "t1", role: "frontend", score: 3 },
    ]);
    const result = await h.orchestrator.observe(ws);

    expect(result.executions).toHaveLength(1);
    expect(result.reviews).toHaveLength(1);
    expect(result.plans).toHaveLength(1);
    expect(result.candidates).toHaveLength(1);

    const exec = result.executions[0]!;
    expect(exec.review).toBeDefined();

    const candidate = result.candidates[0]!;
    expect(candidate.version).toBe("v2");
    expect(candidate.parentBlueprintId).toBe("bp-frontend-v1");
    expect(candidate.status).toBe("candidate");

    // Promotion should be skipped (sample too small).
    expect(result.promotions).toHaveLength(0);
  });
});

// ============================================================================
// Integration test 2 — multiple workspaces accumulate insights
// ============================================================================

describe("Integration: cross-workspace accumulation", () => {
  let tmp: string;
  let h: Harness;

  beforeEach(async () => { tmp = await makeTmp(); h = await makeHarness(tmp); });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it("accumulates failure patterns across multiple workspace observations", async () => {
    // Seed blueprint so each observe() can resolve a parent.
    await h.dags.store.save({
      id: "bp-frontend-v1",
      role: "frontend",
      displayName: "Frontend",
      goal: "Build UI",
      systemPrompt: "frontend",
      capabilities: ["frontend"],
      tools: [],
      preferredModels: [],
      constraints: { outputFormat: "code" },
      version: "v1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stats: { totalTasks: 0, totalSuccesses: 0, avgScore: 0, avgExecutionTimeMs: 0 },
      metadata: {},
    });

    for (let i = 0; i < 3; i++) {
      const ws = makeWorkspace(`ws-${i}`, `request ${i}`, [
        { id: `t${i}`, role: "frontend", score: 3 },
      ]);
      await h.orchestrator.observe(ws);
    }

    const execs = await h.store.listAll();
    expect(execs).toHaveLength(3);

    const patterns = await h.insights.loadPatterns();
    expect(patterns.length).toBeGreaterThan(0);

    const status = await h.learning.status();
    expect(status.totalExecutions).toBe(3);
    expect(status.roles.find((r) => r.role === "frontend")).toBeDefined();
  });
});

// ============================================================================
// Integration test 3 — LearningAPI dashboards reflect observe() output
// ============================================================================

describe("Integration: LearningAPI surfaces match observe() output", () => {
  let tmp: string;
  let h: Harness;

  beforeEach(async () => { tmp = await makeTmp(); h = await makeHarness(tmp); });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it("evolution-history returns plans and candidates generated by observe()", async () => {
    await h.dags.store.save({
      id: "bp-frontend-v1",
      role: "frontend",
      displayName: "Frontend",
      goal: "Build UI",
      systemPrompt: "frontend",
      capabilities: ["frontend"],
      tools: [],
      preferredModels: [],
      constraints: { outputFormat: "code" },
      version: "v1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stats: { totalTasks: 0, totalSuccesses: 0, avgScore: 0, avgExecutionTimeMs: 0 },
      metadata: {},
    });

    const ws = makeWorkspace("ws-dash", "build", [
      { id: "t1", role: "frontend", score: 4 },
    ]);
    const observed = await h.orchestrator.observe(ws);
    expect(observed.plans).toHaveLength(1);

    const hist = await h.learning.evolutionHistory();
    expect(hist.plans.length).toBeGreaterThanOrEqual(1);
    expect(hist.candidates.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// Integration test 4 — promotion A/B math is correct end-to-end
// ============================================================================

describe("Integration: promotion math end-to-end", () => {
  let tmp: string;
  let h: Harness;

  beforeEach(async () => { tmp = await makeTmp(); h = await makeHarness(tmp); });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it("promotes a candidate when enough sample executions beat current", async () => {
    // Seed the current blueprint so the candidate has a parent.
    const parentBlueprintId = "bp-frontend-v1";
    const now = new Date().toISOString();

    await h.dags.store.save({
      id: parentBlueprintId,
      role: "frontend",
      displayName: "Frontend v1",
      goal: "Build UI",
      systemPrompt: "v1 prompt",
      capabilities: ["frontend"],
      tools: [],
      preferredModels: [],
      constraints: { outputFormat: "code" },
      version: "v1",
      createdAt: now,
      updatedAt: now,
      stats: { totalTasks: 0, totalSuccesses: 0, avgScore: 0, avgExecutionTimeMs: 0 },
      metadata: {},
    });

    // 25 current executions with low score + low acceptance.
    const currentRuns: ExecutionRecord[] = Array.from({ length: 25 }, (_, i) => ({
      id: `cur-${i}`,
      taskId: `cur-task-${i}`,
      workspaceId: `ws-cur-${i}`,
      agentRole: "frontend",
      blueprintId: parentBlueprintId,
      blueprintVersion: "v1",
      artifacts: [],
      review: {
        id: `cur-rev-${i}`,
        taskId: `cur-task-${i}`,
        workspaceId: `ws-cur-${i}`,
        score: 5,
        strengths: [],
        weaknesses: [],
        failurePatterns: [],
        improvementSuggestions: [],
        summary: "",
        reviewedAt: now,
      },
      userFeedback: [],
      startedAt: now,
      status: "completed",
    }));

    // Generate a candidate first so we can use its real id.
    const candidateRecord = await h.gen.generate(
      {
        id: "plan-seed",
        agentRole: "frontend",
        fromVersion: "v1",
        toVersion: "v2",
        changes: [],
        expectedImprovement: { score: 1, acceptance: 0.1 },
        basedOn: { executionCount: 25, avgScore: 5, acceptance: 0, topFailurePatterns: [], topSuggestions: [] },
        createdAt: now,
        status: "draft",
      },
      {
        id: parentBlueprintId,
        role: "frontend",
        displayName: "Frontend v1",
        goal: "Build UI",
        systemPrompt: "v1 prompt",
        capabilities: ["frontend"],
        tools: [],
        preferredModels: [],
        constraints: { outputFormat: "code" },
        version: "v1",
        createdAt: now,
        updatedAt: now,
        stats: { totalTasks: 0, totalSuccesses: 0, avgScore: 0, avgExecutionTimeMs: 0 },
        metadata: {},
      },
    );

    // 25 candidate executions with high score + high acceptance.
    const candidateRuns: ExecutionRecord[] = Array.from({ length: 25 }, (_, i) => ({
      id: `cand-${i}`,
      taskId: `cand-task-${i}`,
      workspaceId: `ws-cand-${i}`,
      agentRole: "frontend",
      blueprintId: candidateRecord.id,
      blueprintVersion: "v2",
      artifacts: [],
      review: {
        id: `cand-rev-${i}`,
        taskId: `cand-task-${i}`,
        workspaceId: `ws-cand-${i}`,
        score: 9,
        strengths: [],
        weaknesses: [],
        failurePatterns: [],
        improvementSuggestions: [],
        summary: "",
        reviewedAt: now,
      },
      userFeedback: [{ at: now, text: "good" }],
      startedAt: now,
      status: "completed",
    }));

    for (const r of [...currentRuns, ...candidateRuns]) {
      await h.store.save(r);
    }

    const decision = await h.promo.decide(candidateRecord, parentBlueprintId, [
      ...currentRuns,
      ...candidateRuns,
    ]);

    expect(decision.verdict).toBe("promote");
    expect(decision.record).toBeDefined();
    expect(decision.record!.oldAvgScore).toBe(5);
    expect(decision.record!.newAvgScore).toBe(9);
    expect(DEFAULT_PROMOTION_CONFIG.minSample).toBe(20);
  });
});
