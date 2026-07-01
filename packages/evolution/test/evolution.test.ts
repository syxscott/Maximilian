/**
 * Agent Evolution Engine — tests.
 *
 * Each phase has a dedicated test section. They share a temp directory.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import type { AgentRole, AgentManifest } from "@max/core";
import type { MetricRecord, AgentMemory } from "../src/index.js";
import { emptyMemory } from "../src/index.js";
import {
  MetricsStore,
  ProfileStore,
  Leaderboard,
  ModelSelector,
  AgentMemoryStore,
  EvolutionEngine,
  EvolutionFacade,
  evolutionAwareFactory,
  COMPRESSION_THRESHOLD,
  aggregate,
  DEFAULT_SELECTOR_CONFIG,
  DEFAULT_EVOLUTION_CONFIG,
} from "../src/index.js";
import type { Provider } from "@max/providers";

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

function makeManifest(role: AgentRole, prompt = "You are the agent."): AgentManifest {
  return { role, displayName: role, goal: role, systemPrompt: prompt };
}

function makeRecord(overrides: Partial<MetricRecord> & { taskId: string; agentRole: AgentRole; provider: string; model: string }): MetricRecord {
  return {
    agentId: "agent-test",
    executionTime: 1000,
    tokenInput: 100,
    tokenOutput: 200,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    retryCount: 0,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("Phase 1 — MetricsStore", () => {
  let tmp: string;
  let store: MetricsStore;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-evo-metrics-"));
    store = new MetricsStore(tmp);
  });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it("persists a record to disk and reads it back", async () => {
    const r = makeRecord({ taskId: "t1", agentRole: "frontend", provider: "openai", model: "gpt-4o" });
    await store.record(r);
    const loaded = await store.get("t1");
    expect(loaded?.taskId).toBe("t1");
    expect(loaded?.provider).toBe("openai");
  });

  it("lists all records across roles", async () => {
    await store.record(makeRecord({ taskId: "t1", agentRole: "frontend", provider: "openai", model: "gpt-4o" }));
    await store.record(makeRecord({ taskId: "t2", agentRole: "backend", provider: "anthropic", model: "claude-sonnet" }));
    await store.record(makeRecord({ taskId: "t3", agentRole: "frontend", provider: "anthropic", model: "claude-sonnet" }));
    const all = await store.listAll();
    expect(all).toHaveLength(3);
    const frontend = await store.listForRole("frontend");
    expect(frontend).toHaveLength(2);
  });

  it("returns undefined for missing taskId", async () => {
    const got = await store.get("nope");
    expect(got).toBeUndefined();
  });
});

describe("Phase 2 — ProfileStore", () => {
  let tmp: string;
  let store: ProfileStore;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-evo-profile-"));
    store = new ProfileStore(tmp);
  });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it("creates a profile on first call and reuses it", async () => {
    const p1 = await store.getOrCreate("frontend", makeManifest("frontend"));
    expect(p1.totalTasks).toBe(0);
    expect(p1.currentVersion).toBe("v1");
    const p2 = await store.getOrCreate("frontend", makeManifest("frontend"));
    expect(p2.id).toBe(p1.id);
  });

  it("recomputes aggregate stats from metrics", async () => {
    const profile = await store.getOrCreate("backend", makeManifest("backend"));
    const records: MetricRecord[] = [
      makeRecord({ taskId: "a", agentRole: "backend", provider: "openai", model: "gpt-4o", reviewScore: 8, executionTime: 1000 }),
      makeRecord({ taskId: "b", agentRole: "backend", provider: "openai", model: "gpt-4o", reviewScore: 6, executionTime: 2000 }),
      makeRecord({ taskId: "c", agentRole: "backend", provider: "openai", model: "gpt-4o", reviewScore: 4, executionTime: 3000, error: "boom" }),
    ];
    const updated = ProfileStore.recompute(profile, records);
    expect(updated.totalTasks).toBe(3);
    expect(updated.avgScore).toBeCloseTo(6, 1);
    expect(updated.successRate).toBeCloseTo(2 / 3, 2);
    expect(updated.avgExecutionTime).toBe(2000);
  });
});

describe("Phase 3 — Leaderboard", () => {
  it("aggregates metrics into per-(role,provider,model) entries", () => {
    const records: MetricRecord[] = [
      makeRecord({ taskId: "1", agentRole: "frontend", provider: "openai", model: "gpt-4o", reviewScore: 9, executionTime: 1000, tokenInput: 100, tokenOutput: 200 }),
      makeRecord({ taskId: "2", agentRole: "frontend", provider: "openai", model: "gpt-4o", reviewScore: 7, executionTime: 1500, tokenInput: 150, tokenOutput: 250 }),
      makeRecord({ taskId: "3", agentRole: "frontend", provider: "anthropic", model: "claude-sonnet", reviewScore: 8, executionTime: 1200, tokenInput: 200, tokenOutput: 300 }),
    ];
    const entries = aggregate(records);
    const fe = entries.filter((e) => e.agentRole === "frontend");
    expect(fe).toHaveLength(2);
    const openai = fe.find((e) => e.provider === "openai")!;
    expect(openai.avgScore).toBe(8);
    expect(openai.sampleSize).toBe(2);
    const anthropic = fe.find((e) => e.provider === "anthropic")!;
    expect(anthropic.avgScore).toBe(8);
  });

  it("rebuilds the leaderboard from disk", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-evo-board-"));
    const metrics = new MetricsStore(tmp);
    await metrics.record(makeRecord({ taskId: "1", agentRole: "frontend", provider: "openai", model: "gpt-4o", reviewScore: 9, executionTime: 1000 }));
    await metrics.record(makeRecord({ taskId: "2", agentRole: "frontend", provider: "anthropic", model: "claude-sonnet", reviewScore: 7, executionTime: 1500 }));
    const board = new Leaderboard();
    await board.rebuild(metrics);
    expect(board.entriesFor("frontend")).toHaveLength(2);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});

describe("Phase 4 — ModelSelector", () => {
  const cfg = { ...DEFAULT_SELECTOR_CONFIG, minSamples: 1 };

  it("returns the highest composite score", () => {
    const entries = [
      { agentRole: "frontend" as AgentRole, provider: "openai", model: "gpt-4o", avgScore: 9, avgExecutionTime: 1000, avgCostUSD: 0.01, userSatisfaction: 1, sampleSize: 10, lastUpdated: "" },
      { agentRole: "frontend" as AgentRole, provider: "anthropic", model: "claude-sonnet", avgScore: 7, avgExecutionTime: 500, avgCostUSD: 0.02, userSatisfaction: 0.9, sampleSize: 10, lastUpdated: "" },
    ];
    const board = Leaderboard.fromEntries(entries);
    const sel = new ModelSelector(cfg, []);
    const choice = sel.select("frontend", board);
    expect(choice.provider).toBe("openai");
    expect(choice.model).toBe("gpt-4o");
    expect(choice.reason).toMatch(/Highest composite score/);
  });

  it("falls back to default when no history", () => {
    const board = new Leaderboard();
    const fallback = makeProvider("openai", "gpt-4o");
    const sel = new ModelSelector(cfg, [{ provider: fallback }]);
    const choice = sel.select("frontend", board, { provider: fallback });
    expect(choice.provider).toBe("openai");
    expect(choice.reason).toMatch(/No history/);
  });

  it("applies uncertainty penalty for low sample size", () => {
    const entries = [
      { agentRole: "frontend" as AgentRole, provider: "openai", model: "gpt-4o", avgScore: 8, avgExecutionTime: 1000, avgCostUSD: 0.01, userSatisfaction: 1, sampleSize: 1, lastUpdated: "" },
      { agentRole: "frontend" as AgentRole, provider: "anthropic", model: "claude-sonnet", avgScore: 7, avgExecutionTime: 1000, avgCostUSD: 0.01, userSatisfaction: 1, sampleSize: 20, lastUpdated: "" },
    ];
    const board = Leaderboard.fromEntries(entries);
    const sel = new ModelSelector({ ...cfg, minSamples: 5 }, []);
    const choice = sel.select("frontend", board);
    // Anthropic wins despite lower raw score, because openai's tiny sample
    // size triggers a 0.1 uncertainty penalty that flips the order.
    expect(choice.provider).toBe("anthropic");
  });
});

describe("Phase 5 — AgentMemory", () => {
  it("appends feedback to the right bucket", () => {
    let mem = AgentMemoryStore.recordFeedback(AgentMemoryStore.recordSuccess(
      AgentMemoryStore.recordFeedback(makeEmptyMemory(), "first"),
      makeRecord({ taskId: "t1", agentRole: "frontend", provider: "openai", model: "gpt-4o" }),
      "snippet"
    ), "second");
    expect(mem.userFeedback.map((e) => e.content)).toContain("first");
    expect(mem.userFeedback.map((e) => e.content)).toContain("second");
    expect(mem.goodExamples.map((e) => e.content)).toContain("snippet");
  });

  it("records failures with the error message", () => {
    const mem = AgentMemoryStore.recordFailure(makeEmptyMemory(), makeRecord({
      taskId: "t1", agentRole: "frontend", provider: "openai", model: "gpt-4o", error: "boom",
    }));
    expect(mem.commonErrors.map((e) => e.content)).toContain("boom");
  });

  it("compresses when any bucket exceeds the threshold", async () => {
    let mem = makeEmptyMemory();
    for (let i = 0; i < COMPRESSION_THRESHOLD + 5; i++) {
      mem = AgentMemoryStore.recordFeedback(mem, `feedback ${i}`);
    }
    expect(mem.userFeedback.length).toBeGreaterThan(COMPRESSION_THRESHOLD);
    const compressed = await AgentMemoryStore.maybeCompress(mem);
    expect(compressed.userFeedback.length).toBeLessThanOrEqual(COMPRESSION_THRESHOLD);
    expect(compressed.compressedAt).toBeDefined();
    expect(compressed.userFeedback[0]!.content).toMatch(/digest/);
  });

  it("renders an empty prelude when memory is fresh", () => {
    const prelude = AgentMemoryStore.toPrelude(makeEmptyMemory());
    expect(prelude).toBe("");
  });

  it("renders a prelude with feedback when present", () => {
    const mem = AgentMemoryStore.recordFeedback(makeEmptyMemory(), "use TypeScript");
    const prelude = AgentMemoryStore.toPrelude(mem);
    expect(prelude).toContain("use TypeScript");
    expect(prelude).toContain("Lessons learned");
  });
});

describe("Phase 6 — EvolutionEngine", () => {
  let tmp: string;
  let metrics: MetricsStore;
  let profiles: ProfileStore;
  let engine: EvolutionEngine;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-evo-engine-"));
    metrics = new MetricsStore(tmp);
    profiles = new ProfileStore(tmp);
    engine = new EvolutionEngine(tmp, metrics, profiles);
  });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it("does not trigger evolution with fewer than MIN_SAMPLES tasks", async () => {
    const profile = await profiles.getOrCreate("frontend", makeManifest("frontend"));
    expect(EvolutionEngine.shouldEvolve(profile, [])).toBe(false);
    const recent = Array.from({ length: 5 }, (_, i) => makeRecord({
      taskId: `t${i}`, agentRole: "frontend", provider: "openai", model: "gpt-4o", reviewScore: 3,
    }));
    expect(EvolutionEngine.shouldEvolve(profile, recent)).toBe(false);
  });

  it("triggers evolution when avg score is below threshold", () => {
    const profile = makeProfileWithTasks(15);
    const recent = Array.from({ length: 12 }, (_, i) => makeRecord({
      taskId: `t${i}`, agentRole: "frontend", provider: "openai", model: "gpt-4o", reviewScore: 4,
    }));
    expect(EvolutionEngine.shouldEvolve(profile, recent)).toBe(true);
  });

  it("creates a v2 candidate when evolution runs", async () => {
    const profile = await profiles.getOrCreate("frontend", makeManifest("frontend"));
    for (let i = 0; i < 12; i++) {
      await metrics.record(makeRecord({
        taskId: `t${i}`, agentRole: "frontend", provider: "openai", model: "gpt-4o",
        reviewScore: 3, executionTime: 5000, error: i % 2 ? "boom" : undefined,
      }));
    }
    const decision = await engine.evolve("frontend", profile.manifest!);
    expect(["promoted", "discarded"]).toContain(decision.outcome);
    const versions = await engine.listVersions("frontend");
    expect(versions.find((v) => v.id === decision.toVersion)).toBeDefined();
  });

  it("EvolutionFacade composes all phases", async () => {
    const facade = new EvolutionFacade({
      rootDir: tmp,
      candidates: [makeProvider("openai", "gpt-4o"), makeProvider("anthropic", "claude-sonnet")],
      fallbackProvider: makeProvider("openai", "gpt-4o"),
      defaultManifests: { frontend: makeManifest("frontend") },
    });
    await facade.initialize();
    await facade.recordCompletion({
      task: { id: "t1", agentRole: "frontend", description: "x", status: "completed", dependsOn: [] },
      provider: "openai",
      model: "gpt-4o",
      executionTimeMs: 1000,
      tokenInput: 100,
      tokenOutput: 200,
      reviewScore: 8,
      defaultManifest: makeManifest("frontend"),
    });
    const board = facade.leaderboard.entriesFor("frontend");
    expect(board.length).toBe(1);
    expect(board[0]?.provider).toBe("openai");

    const sel = facade.selectForRole("frontend");
    expect(sel.provider).toBe("openai");
    expect(sel.reason).toMatch(/Highest composite score|No history/);
  });
});

describe("End-to-end: factory wrapper", () => {
  it("returns an agent that uses the selected provider", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-evo-fac-"));
    const facade = new EvolutionFacade({
      rootDir: tmp,
      candidates: [makeProvider("openai", "gpt-4o")],
      fallbackProvider: makeProvider("openai", "gpt-4o"),
      defaultManifests: { backend: makeManifest("backend") },
    });
    await facade.initialize();
    const factory = evolutionAwareFactory(facade);
    const agent = factory("backend");
    expect(agent).toBeDefined();
    expect(agent?.manifest.role).toBe("backend");
    await fs.rm(tmp, { recursive: true, force: true });
  });
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function makeEmptyMemory(): AgentMemory {
  return emptyMemory();
}

function makeProfileWithTasks(n: number) {
  return {
    id: "frontend",
    role: "frontend" as AgentRole,
    createdAt: new Date().toISOString(),
    totalTasks: n,
    avgScore: 0,
    successRate: 1,
    avgExecutionTime: 0,
    strengths: [],
    weaknesses: [],
    memory: makeEmptyMemory(),
    currentVersion: "v1",
    versions: ["v1"],
    manifest: makeManifest("frontend"),
  };
}
