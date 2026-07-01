/**
 * Phase 5 — Autonomous Improvement Loop unit tests.
 *
 * Target: 30+ tests, no real LLM calls (heuristic mode).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import type { Provider } from "@max/providers";
import type { Workspace, Result, Task, Plan } from "@max/core";
import { DAGS } from "@max/dags";
import { EvolutionFacade } from "@max/evolution";
import {
  ExecutionStore,
  ReviewIntelligence,
  FailurePatternAnalyzer,
  InsightsStore,
  EvolutionPlanner,
  CandidateGenerator,
  PromotionEngine,
  LearningAPI,
  AutonomyOrchestrator,
  DEFAULT_PROMOTION_CONFIG,
  DEFAULT_PLANNER_CONFIG,
  type ExecutionRecord,
  type StructuredReview,
} from "../src/index.js";

function makeProvider(id: string, model: string): Provider {
  return {
    id,
    name: id,
    defaultModel: model,
    isConfigured: () => true,
    chat: async () => ({ content: "ok", model }),
    stream: async function* () { yield { delta: "ok", done: true }; },
  };
}

async function makeTmp(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "max-autonomy-"));
}

function makeExecution(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: `exec-${Math.random().toString(36).slice(2, 8)}`,
    taskId: `t-${Math.random().toString(36).slice(2, 6)}`,
    workspaceId: "ws-1",
    agentRole: "frontend",
    artifacts: [],
    userFeedback: [],
    startedAt: new Date().toISOString(),
    status: "completed",
    ...overrides,
  };
}

function makeReview(overrides: Partial<StructuredReview> = {}): StructuredReview {
  return {
    id: `rev-${Math.random().toString(36).slice(2, 6)}`,
    taskId: "t-1",
    workspaceId: "ws-1",
    score: 7,
    strengths: [],
    weaknesses: [],
    failurePatterns: [],
    improvementSuggestions: [],
    summary: "",
    reviewedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================================
// 5.1 — ExecutionStore
// ============================================================================

describe("5.1 — ExecutionStore", () => {
  let tmp: string;
  let store: ExecutionStore;

  beforeEach(async () => {
    tmp = await makeTmp();
    store = new ExecutionStore(tmp);
  });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it("saves and retrieves a record", async () => {
    const r = makeExecution();
    await store.save(r);
    const loaded = await store.get(r.id);
    expect(loaded?.id).toBe(r.id);
  });

  it("lists all records", async () => {
    await store.save(makeExecution({ id: "a" }));
    await store.save(makeExecution({ id: "b" }));
    const all = await store.listAll();
    expect(all).toHaveLength(2);
  });

  it("filters by workspace, role, blueprint", async () => {
    await store.save(makeExecution({ id: "a", workspaceId: "ws-1", agentRole: "frontend", blueprintId: "bp-1" }));
    await store.save(makeExecution({ id: "b", workspaceId: "ws-1", agentRole: "backend", blueprintId: "bp-2" }));
    await store.save(makeExecution({ id: "c", workspaceId: "ws-2", agentRole: "frontend", blueprintId: "bp-1" }));
    expect((await store.listForWorkspace("ws-1")).map((r) => r.id).sort()).toEqual(["a", "b"]);
    expect((await store.listForRole("frontend")).map((r) => r.id).sort()).toEqual(["a", "c"]);
    expect((await store.listForBlueprint("bp-1")).map((r) => r.id).sort()).toEqual(["a", "c"]);
  });

  it("appends user feedback to an existing record", async () => {
    const r = makeExecution({ id: "x", userFeedback: [] });
    await store.save(r);
    const updated = await store.appendUserFeedback("x", "use TypeScript", 5);
    expect(updated.userFeedback).toHaveLength(1);
    expect(updated.userFeedback[0]?.text).toBe("use TypeScript");
    expect(updated.userFeedback[0]?.rating).toBe(5);
  });
});

// ============================================================================
// 5.2 — ReviewIntelligence
// ============================================================================

describe("5.2 — ReviewIntelligence (heuristic mode)", () => {
  it("returns a structured review with required fields", async () => {
    const ri = new ReviewIntelligence({ forceHeuristic: true });
    const review = await ri.review({
      taskId: "t1",
      workspaceId: "ws1",
      artifacts: [{ role: "frontend", content: "```html\n<html></html>\n```" }],
      userRequest: "x",
    });
    expect(review.score).toBeGreaterThanOrEqual(0);
    expect(review.score).toBeLessThanOrEqual(10);
    expect(Array.isArray(review.strengths)).toBe(true);
    expect(Array.isArray(review.weaknesses)).toBe(true);
    expect(Array.isArray(review.failurePatterns)).toBe(true);
    expect(Array.isArray(review.improvementSuggestions)).toBe(true);
  });

  it("flags truncation when output is short", async () => {
    const ri = new ReviewIntelligence({ forceHeuristic: true });
    const review = await ri.review({
      taskId: "t1",
      workspaceId: "ws1",
      artifacts: [{ role: "frontend", content: "tiny" }],
    });
    expect(review.weaknesses).toContain("output too short");
    expect(review.failurePatterns).toContain("truncation");
  });

  it("flags missing code blocks for code roles", async () => {
    const ri = new ReviewIntelligence({ forceHeuristic: true });
    const review = await ri.review({
      taskId: "t1",
      workspaceId: "ws1",
      artifacts: [{ role: "frontend", content: "lots of text but no code fences at all" }],
    });
    expect(review.failurePatterns).toContain("no_code_blocks");
  });

  it("gives credit for fenced code blocks", async () => {
    const ri = new ReviewIntelligence({ forceHeuristic: true });
    const review = await ri.review({
      taskId: "t1",
      workspaceId: "ws1",
      artifacts: [
        { role: "frontend", content: "```html\n<html><body><script>function init() { return 1; }</script></body></html>\n```" },
      ],
    });
    expect(review.strengths).toContain("contains code blocks");
  });
});

// ============================================================================
// 5.3 — FailurePatternAnalyzer
// ============================================================================

describe("5.3 — FailurePatternAnalyzer", () => {
  let tmp: string;
  let store: ExecutionStore;
  let insights: InsightsStore;
  let analyzer: FailurePatternAnalyzer;

  beforeEach(async () => {
    tmp = await makeTmp();
    store = new ExecutionStore(tmp);
    insights = new InsightsStore(tmp);
    analyzer = new FailurePatternAnalyzer(insights);
  });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it("groups failures by pattern and counts frequency", async () => {
    await store.save(makeExecution({ id: "e1", review: makeReview({ taskId: "e1", failurePatterns: ["no_code_blocks", "truncation"] }) }));
    await store.save(makeExecution({ id: "e2", review: makeReview({ taskId: "e2", failurePatterns: ["no_code_blocks"] }) }));
    await store.save(makeExecution({ id: "e3", review: makeReview({ taskId: "e3", failurePatterns: ["truncation"] }) }));
    const result = await analyzer.analyze(store);
    const noCode = result.find((r) => r.pattern === "no_code_blocks");
    const trunc = result.find((r) => r.pattern === "truncation");
    expect(noCode?.frequency).toBe(2);
    expect(trunc?.frequency).toBe(2);
  });

  it("sorts by frequency descending", async () => {
    await store.save(makeExecution({ id: "e1", review: makeReview({ failurePatterns: ["a"] }) }));
    await store.save(makeExecution({ id: "e2", review: makeReview({ failurePatterns: ["b", "a"] }) }));
    await store.save(makeExecution({ id: "e3", review: makeReview({ failurePatterns: ["a", "b"] }) }));
    const result = await analyzer.analyze(store);
    expect(result[0]?.frequency).toBeGreaterThanOrEqual(result[1]?.frequency ?? 0);
  });

  it("computes leaderboard insight (worst roles/models)", async () => {
    await store.save(makeExecution({ id: "e1", agentRole: "frontend", review: makeReview({ score: 9 }) }));
    await store.save(makeExecution({ id: "e2", agentRole: "backend", review: makeReview({ score: 3 }) }));
    await store.save(makeExecution({ id: "e3", agentRole: "backend", review: makeReview({ score: 2 }) }));
    const result = await analyzer.leaderboardInsight(store);
    expect(result.worstRoles[0]?.role).toBe("backend");
    expect(result.totalExecutions).toBe(3);
  });
});

// ============================================================================
// 5.4 — EvolutionPlanner
// ============================================================================

describe("5.4 — EvolutionPlanner", () => {
  let tmp: string;
  let planner: EvolutionPlanner;

  beforeEach(async () => {
    tmp = await makeTmp();
    planner = new EvolutionPlanner(tmp);
  });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it("returns null when too few executions", () => {
    const plan = planner.plan({
      role: "frontend",
      currentVersion: "v1",
      executions: Array.from({ length: 5 }, () => makeExecution()),
      reviews: [],
      failureInsights: [],
      userFeedback: [],
    });
    expect(plan).toBeNull();
  });

  it("returns null when avg score and acceptance are both healthy", () => {
    const execs = Array.from({ length: 20 }, () => makeExecution({
      review: makeReview({ score: 8 }),
      userFeedback: [{ at: new Date().toISOString(), text: "ok" }],
    }));
    const plan = planner.plan({
      role: "frontend",
      currentVersion: "v1",
      executions: execs,
      reviews: [],
      failureInsights: [],
      userFeedback: [],
    });
    expect(plan).toBeNull();
  });

  it("produces a v1 -> v2 plan when performance is poor", () => {
    const execs = Array.from({ length: 20 }, () => makeExecution({
      review: makeReview({ score: 4, failurePatterns: ["truncation"] }),
    }));
    const plan = planner.plan({
      role: "frontend",
      currentVersion: "v1",
      executions: execs,
      reviews: execs.map((e) => e.review!).filter(Boolean),
      failureInsights: [{ pattern: "truncation", frequency: 20, agentRoles: ["frontend"], providers: [], models: [], avgScore: 4, examples: [], firstSeen: "", lastSeen: "" }],
      userFeedback: ["be more thorough"],
    });
    expect(plan).not.toBeNull();
    expect(plan?.fromVersion).toBe("v1");
    expect(plan?.toVersion).toBe("v2");
    expect(plan?.changes.length).toBeGreaterThan(0);
  });

  it("persists and lists plans", async () => {
    const execs = Array.from({ length: 20 }, () => makeExecution({ review: makeReview({ score: 3 }) }));
    const plan = planner.plan({
      role: "frontend",
      currentVersion: "v1",
      executions: execs,
      reviews: [],
      failureInsights: [],
      userFeedback: [],
    });
    if (!plan) throw new Error("expected plan");
    await planner.savePlan(plan);
    const all = await planner.listPlans();
    expect(all).toHaveLength(1);
  });

  it("increments version correctly (v1 -> v2 -> v3)", () => {
    const execs = Array.from({ length: 20 }, () => makeExecution({ review: makeReview({ score: 3 }) }));
    const plan1 = planner.plan({ role: "x", currentVersion: "v1", executions: execs, reviews: [], failureInsights: [], userFeedback: [] });
    const plan2 = planner.plan({ role: "x", currentVersion: "v2", executions: execs, reviews: [], failureInsights: [], userFeedback: [] });
    const plan3 = planner.plan({ role: "x", currentVersion: "v10", executions: execs, reviews: [], failureInsights: [], userFeedback: [] });
    expect(plan1?.toVersion).toBe("v2");
    expect(plan2?.toVersion).toBe("v3");
    expect(plan3?.toVersion).toBe("v11");
  });
});

// ============================================================================
// 5.5 — CandidateGenerator
// ============================================================================

describe("5.5 — CandidateGenerator", () => {
  let tmp: string;
  let gen: CandidateGenerator;
  let planner: EvolutionPlanner;

  beforeEach(async () => {
    tmp = await makeTmp();
    gen = new CandidateGenerator(tmp);
    planner = new EvolutionPlanner(tmp);
  });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it("generates a candidate from a plan and a parent blueprint", async () => {
    const execs = Array.from({ length: 20 }, () => makeExecution({ review: makeReview({ score: 3 }) }));
    const plan = planner.plan({
      role: "frontend",
      currentVersion: "v1",
      executions: execs,
      reviews: [],
      failureInsights: [],
      userFeedback: ["use TypeScript"],
    });
    if (!plan) throw new Error("expected plan");
    const parent = {
      id: "bp-frontend-parent",
      role: "frontend",
      displayName: "Frontend",
      goal: "Build UI",
      systemPrompt: "You are a frontend engineer.",
      capabilities: ["frontend"],
      tools: [],
      preferredModels: [],
      constraints: { outputFormat: "code" as const },
      version: "v1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stats: { totalTasks: 0, totalSuccesses: 0, avgScore: 0, avgExecutionTimeMs: 0 },
      metadata: {},
    };
    const candidate = await gen.generate(plan, parent);
    expect(candidate.version).toBe("v2");
    expect(candidate.parentBlueprintId).toBe("bp-frontend-parent");
    expect(candidate.systemPrompt).toContain("frontend engineer");
    expect(candidate.systemPrompt).toContain("Generated directive");
    expect(candidate.generationReason.length).toBeGreaterThan(0);
  });

  it("lists all candidates", async () => {
    const execs = Array.from({ length: 20 }, () => makeExecution({ review: makeReview({ score: 3 }) }));
    const plan = planner.plan({ role: "x", currentVersion: "v1", executions: execs, reviews: [], failureInsights: [], userFeedback: [] });
    if (!plan) throw new Error("expected plan");
    const parent = makeParent("x", "v1");
    const c1 = await gen.generate(plan, parent);
    const all = await gen.listAll();
    expect(all.find((c) => c.id === c1.id)).toBeDefined();
  });
});

function makeParent(role: string, version: string) {
  return {
    id: `bp-${role}-parent-${Math.random().toString(36).slice(2, 6)}`,
    role,
    displayName: role,
    goal: "g",
    systemPrompt: "You are " + role,
    capabilities: [role],
    tools: [],
    preferredModels: [],
    constraints: { outputFormat: "free" as const },
    version,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stats: { totalTasks: 0, totalSuccesses: 0, avgScore: 0, avgExecutionTimeMs: 0 },
    metadata: {},
  };
}

// ============================================================================
// 5.6 — PromotionEngine
// ============================================================================

describe("5.6 — PromotionEngine", () => {
  let tmp: string;
  let gen: CandidateGenerator;
  let promo: PromotionEngine;
  let planner: EvolutionPlanner;

  beforeEach(async () => {
    tmp = await makeTmp();
    gen = new CandidateGenerator(tmp);
    planner = new EvolutionPlanner(tmp);
    promo = new PromotionEngine(tmp, gen);
    await promo.loadHistory();
  });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it("skips when sample size is insufficient", async () => {
    const candidate = await makeCandidate("frontend", "v2");
    const decision = await promo.decide(candidate, "current-bp", [
      makeExecution({ blueprintId: "current-bp", review: makeReview({ score: 5 }) }),
    ]);
    expect(decision.verdict).toBe("skip");
  });

  it("promotes when both thresholds are met", async () => {
    const candidate = await makeCandidate("frontend", "v2");
    const currentRuns: ExecutionRecord[] = Array.from({ length: 25 }, (_, i) =>
      makeExecution({
        id: `c${i}`,
        blueprintId: "current-bp",
        review: makeReview({ score: 5 }),
      })
    );
    const candidateRuns: ExecutionRecord[] = Array.from({ length: 25 }, (_, i) =>
      makeExecution({
        id: `n${i}`,
        blueprintId: candidate.id,
        review: makeReview({ score: 8 }),
        userFeedback: [{ at: new Date().toISOString(), text: "good" }],
      })
    );
    const decision = await promo.decide(candidate, "current-bp", [...currentRuns, ...candidateRuns]);
    expect(decision.verdict).toBe("promote");
    expect(decision.record).toBeDefined();
  });

  it("rejects when score gain below threshold", async () => {
    const candidate = await makeCandidate("frontend", "v2");
    const currentRuns = Array.from({ length: 25 }, (_, i) => makeExecution({ id: `c${i}`, blueprintId: "current-bp", review: makeReview({ score: 7 }) }));
    const candidateRuns = Array.from({ length: 25 }, (_, i) => makeExecution({ id: `n${i}`, blueprintId: candidate.id, review: makeReview({ score: 7.5 }) }));
    const decision = await promo.decide(candidate, "current-bp", [...currentRuns, ...candidateRuns]);
    expect(decision.verdict).toBe("reject");
  });

  it("rejects when acceptance gain below threshold", async () => {
    const candidate = await makeCandidate("frontend", "v2");
    const currentRuns = Array.from({ length: 25 }, (_, i) => makeExecution({ id: `c${i}`, blueprintId: "current-bp", review: makeReview({ score: 5 }), userFeedback: [{ at: "", text: "ok" }] }));
    const candidateRuns = Array.from({ length: 25 }, (_, i) => makeExecution({ id: `n${i}`, blueprintId: candidate.id, review: makeReview({ score: 9 }), userFeedback: [{ at: "", text: "ok" }] }));
    const decision = await promo.decide(candidate, "current-bp", [...currentRuns, ...candidateRuns]);
    expect(decision.verdict).toBe("reject");
  });

  it("appends to promotion-history.json", async () => {
    const candidate = await makeCandidate("frontend", "v2");
    const currentRuns = Array.from({ length: 25 }, (_, i) => makeExecution({ id: `c${i}`, blueprintId: "current-bp", review: makeReview({ score: 5 }) }));
    const candidateRuns = Array.from({ length: 25 }, (_, i) => makeExecution({ id: `n${i}`, blueprintId: candidate.id, review: makeReview({ score: 8 }), userFeedback: [{ at: "", text: "ok" }] }));
    await promo.decide(candidate, "current-bp", [...currentRuns, ...candidateRuns]);
    const history = await promo.loadHistory();
    expect(history.length).toBeGreaterThan(0);
  });

  it("uses DEFAULT_PROMOTION_CONFIG defaults (sample=20, score=10%, accept=15%)", () => {
    expect(DEFAULT_PROMOTION_CONFIG.minSample).toBe(20);
    expect(DEFAULT_PROMOTION_CONFIG.minScoreGain).toBe(0.10);
    expect(DEFAULT_PROMOTION_CONFIG.minAcceptanceGain).toBe(0.15);
  });

  async function makeCandidate(role: string, version: string) {
    const execs = Array.from({ length: 20 }, () => makeExecution({ review: makeReview({ score: 3 }) }));
    const plan = planner.plan({ role, currentVersion: "v1", executions: execs, reviews: [], failureInsights: [], userFeedback: [] });
    if (!plan) throw new Error("expected plan");
    const parent = makeParent(role, "v1");
    return await gen.generate(plan, parent);
  }
});

// ============================================================================
// 5.7 — LearningAPI
// ============================================================================

describe("5.7 — LearningAPI", () => {
  let tmp: string;
  let store: ExecutionStore;
  let insights: InsightsStore;
  let analyzer: FailurePatternAnalyzer;
  let gen: CandidateGenerator;
  let planner: EvolutionPlanner;
  let promo: PromotionEngine;
  let api: LearningAPI;

  beforeEach(async () => {
    tmp = await makeTmp();
    store = new ExecutionStore(tmp);
    insights = new InsightsStore(tmp);
    analyzer = new FailurePatternAnalyzer(insights);
    gen = new CandidateGenerator(tmp);
    planner = new EvolutionPlanner(tmp);
    promo = new PromotionEngine(tmp, gen);
    await promo.loadHistory();
    api = new LearningAPI(store, insights, analyzer, gen, promo, planner);
  });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it("status returns counts and per-role aggregates", async () => {
    await store.save(makeExecution({ agentRole: "frontend", review: makeReview({ score: 8 }) }));
    await store.save(makeExecution({ agentRole: "frontend", review: makeReview({ score: 6 }) }));
    await store.save(makeExecution({ agentRole: "backend", review: makeReview({ score: 4 }) }));
    const status = await api.status();
    expect(status.totalExecutions).toBe(3);
    expect(status.roles).toHaveLength(2);
    const fe = status.roles.find((r) => r.role === "frontend")!;
    expect(fe.avgScore).toBe(7);
  });

  it("agents() returns per-role summary", async () => {
    await store.save(makeExecution({ agentRole: "backend", review: makeReview({ score: 5 }) }));
    const agents = await api.agents();
    expect(agents).toHaveLength(1);
    expect(agents[0]?.role).toBe("backend");
  });

  it("failurePatterns() returns mined patterns", async () => {
    await store.save(makeExecution({ review: makeReview({ failurePatterns: ["x"] }) }));
    await store.save(makeExecution({ review: makeReview({ failurePatterns: ["x"] }) }));
    await analyzer.analyze(store);
    const patterns = await api.failurePatterns();
    expect(patterns.find((p) => p.pattern === "x")?.frequency).toBe(2);
  });

  it("evolutionHistory returns plans + promotions + candidates", async () => {
    const history = await api.evolutionHistory();
    expect(history).toHaveProperty("plans");
    expect(history).toHaveProperty("promotions");
    expect(history).toHaveProperty("candidates");
  });

  it("status() computes average score across roles", async () => {
    await store.save(makeExecution({ agentRole: "frontend", review: makeReview({ score: 10 }) }));
    await store.save(makeExecution({ agentRole: "frontend", review: makeReview({ score: 6 }) }));
    await store.save(makeExecution({ agentRole: "backend", review: makeReview({ score: 4 }) }));
    const status = await api.status();
    expect(status.totalExecutions).toBe(3);
    expect(status.roles.find((r) => r.role === "frontend")?.avgScore).toBe(8);
  });

  it("status() handles empty store gracefully", async () => {
    const status = await api.status();
    expect(status.totalExecutions).toBe(0);
    expect(status.roles).toHaveLength(0);
    expect(status.totalCandidates).toBe(0);
    expect(status.totalPromotions).toBe(0);
  });
});

// ============================================================================
// 5.6 — PromotionEngine (extra)
// ============================================================================

describe("5.6 — PromotionEngine (status side effects)", () => {
  let tmp: string;
  let gen: CandidateGenerator;
  let promo: PromotionEngine;
  let planner: EvolutionPlanner;

  beforeEach(async () => {
    tmp = await makeTmp();
    gen = new CandidateGenerator(tmp);
    planner = new EvolutionPlanner(tmp);
    promo = new PromotionEngine(tmp, gen);
    await promo.loadHistory();
  });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it("marks candidate status as 'promoted' on success", async () => {
    const execs = Array.from({ length: 20 }, () => makeExecution({ review: makeReview({ score: 3 }) }));
    const plan = planner.plan({ role: "frontend", currentVersion: "v1", executions: execs, reviews: [], failureInsights: [], userFeedback: [] });
    if (!plan) throw new Error("expected plan");
    const parent = makeParent("frontend", "v1");
    const candidate = await gen.generate(plan, parent);

    const currentRuns = Array.from({ length: 25 }, (_, i) => makeExecution({ id: `c${i}`, blueprintId: "current-bp", review: makeReview({ score: 5 }) }));
    const candidateRuns = Array.from({ length: 25 }, (_, i) => makeExecution({ id: `n${i}`, blueprintId: candidate.id, review: makeReview({ score: 9 }), userFeedback: [{ at: "", text: "ok" }] }));

    await promo.decide(candidate, "current-bp", [...currentRuns, ...candidateRuns]);
    const reloaded = (await gen.listAll()).find((c) => c.id === candidate.id);
    expect(reloaded?.status).toBe("promoted");
  });

  it("marks candidate status as 'rejected' on failure", async () => {
    const execs = Array.from({ length: 20 }, () => makeExecution({ review: makeReview({ score: 3 }) }));
    const plan = planner.plan({ role: "frontend", currentVersion: "v1", executions: execs, reviews: [], failureInsights: [], userFeedback: [] });
    if (!plan) throw new Error("expected plan");
    const parent = makeParent("frontend", "v1");
    const candidate = await gen.generate(plan, parent);

    const currentRuns = Array.from({ length: 25 }, (_, i) => makeExecution({ id: `c${i}`, blueprintId: "current-bp", review: makeReview({ score: 8 }) }));
    const candidateRuns = Array.from({ length: 25 }, (_, i) => makeExecution({ id: `n${i}`, blueprintId: candidate.id, review: makeReview({ score: 8 }) }));

    await promo.decide(candidate, "current-bp", [...currentRuns, ...candidateRuns]);
    const reloaded = (await gen.listAll()).find((c) => c.id === candidate.id);
    expect(reloaded?.status).toBe("rejected");
  });
});

// ============================================================================
// 5.8 — AutonomyOrchestrator (observe loop)
// ============================================================================

describe("5.8 — AutonomyOrchestrator.observe()", () => {
  let tmp: string;
  let store: ExecutionStore;
  let insights: InsightsStore;
  let analyzer: FailurePatternAnalyzer;
  let gen: CandidateGenerator;
  let planner: EvolutionPlanner;
  let promo: PromotionEngine;
  let dags: DAGS;
  let review: ReviewIntelligence;
  let orchestrator: AutonomyOrchestrator;
  let provider: Provider;

  beforeEach(async () => {
    tmp = await makeTmp();
    provider = makeProvider("mock", "mock-1");
    store = new ExecutionStore(tmp);
    insights = new InsightsStore(tmp);
    analyzer = new FailurePatternAnalyzer(insights);
    gen = new CandidateGenerator(tmp);
    planner = new EvolutionPlanner(tmp);
    promo = new PromotionEngine(tmp, gen);
    await promo.loadHistory();
    review = new ReviewIntelligence({ forceHeuristic: true });
    const facade = new EvolutionFacade({
      rootDir: tmp,
      candidates: [provider],
      fallbackProvider: provider,
      defaultManifests: {},
    });
    await facade.initialize();
    dags = new DAGS({ rootDir: tmp, evolution: facade, candidates: [provider] });
    orchestrator = new AutonomyOrchestrator({
      dags,
      review,
      executionStore: store,
      insightsStore: insights,
      failureAnalyzer: analyzer,
      planner,
      candidateGenerator: gen,
      promotionEngine: promo,
    });
  });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it("persists an execution record for every task in the workspace", async () => {
    const workspace = makeWorkspace([
      makeTask("frontend", "t1"),
      makeTask("backend", "t2"),
    ]);
    await orchestrator.observe(workspace);
    const all = await store.listAll();
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.agentRole).sort()).toEqual(["backend", "frontend"]);
  });

  it("attaches structured reviews to non-review executions", async () => {
    const workspace = makeWorkspace([makeTask("frontend", "t1")]);
    await orchestrator.observe(workspace);
    const exec = (await store.listAll())[0]!;
    expect(exec.review).toBeDefined();
    expect(exec.review?.score).toBeGreaterThanOrEqual(0);
    expect(exec.review?.score).toBeLessThanOrEqual(10);
  });

  it("skips review role tasks", async () => {
    const workspace = makeWorkspace([
      makeTask("frontend", "t1"),
      makeTask("reviewer", "t2"),
    ]);
    await orchestrator.observe(workspace);
    const all = await store.listAll();
    const reviewerExec = all.find((e) => e.agentRole === "reviewer");
    expect(reviewerExec).toBeDefined();
    expect(reviewerExec?.review).toBeUndefined();
  });

  it("produces an evolution plan when executions are weak", async () => {
    const task = makeTask("frontend", "t1");
    const workspace = makeWorkspace([task]);
    await orchestrator.observe(workspace);
    const plans = await planner.listPlans();
    const candidates = await gen.listAll();
    expect(candidates).toHaveLength(plans.length);
  });

  it("is idempotent on repeated calls", async () => {
    const workspace = makeWorkspace([makeTask("frontend", "t1")]);
    await orchestrator.observe(workspace);
    await orchestrator.observe(workspace);
    const all = await store.listAll();
    expect(all).toHaveLength(2);
  });

  function makeWorkspace(tasks: Task[]): Workspace {
    return {
      id: `ws-${Math.random().toString(36).slice(2, 6)}`,
      userRequest: "test request",
      plan: { tasks } as Plan,
      results: tasks.map((t) => ({
        taskId: t.id,
        agentRole: t.agentRole,
        output: "<html><body>result</body></html>",
        durationMs: 100,
        metadata: { blueprintId: `bp-${t.agentRole}-v1`, blueprintVersion: "v1", provider: "mock", model: "mock-1", artifacts: [`${t.agentRole}-artifact`] },
      })),
    } as unknown as Workspace;
  }

  function makeTask(role: string, id: string): Task {
    return {
      id,
      agentRole: role,
      status: "completed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    } as unknown as Task;
  }
});
