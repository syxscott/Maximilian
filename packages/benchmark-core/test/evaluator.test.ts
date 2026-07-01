/**
 * Phase 9 — Benchmark Core tests.
 *
 * Tests:
 *   - DatabaseRunner: real SQLite execution, comparison, error handling
 *   - Bridge: toRoleProfile, aggregateToRoleProfile, computeBenchmarkDelta
 *   - BenchmarkEvaluator: baseline path with mock provider
 */

import { describe, it, expect } from "vitest";
import { DatabaseRunner } from "../src/runners/database-runner.js";
import {
  toRoleProfile,
  aggregateToRoleProfile,
  computeBenchmarkDelta,
} from "../src/bridge.js";
import { BenchmarkEvaluator } from "../src/evaluator.js";
import { computeAggregate } from "../src/types.js";
import type { BenchmarkResult, BenchmarkTask, DatabaseTaskContext } from "../src/types.js";
import type { Provider, ChatResponse } from "@max/providers";

// ── DatabaseRunner ──────────────────────────────────────────────────────────

describe("DatabaseRunner", () => {
  const runner = new DatabaseRunner();
  const baseContext = {
    ddl: `
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER);
      INSERT INTO users VALUES (1, 'Alice', 30);
      INSERT INTO users VALUES (2, 'Bob', 25);
      INSERT INTO users VALUES (3, 'Charlie', 35);
    `,
  };

  it("executes valid SQL and returns rows", () => {
    const result = runner.executeSql("SELECT * FROM users ORDER BY id", baseContext);
    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({ id: 1, name: "Alice", age: 30 });
    expect(result.columns).toEqual(["id", "name", "age"]);
  });

  it("returns error for invalid SQL", () => {
    const result = runner.executeSql("SELECT * FROM nonexistent", baseContext);
    expect(result.error).toBeDefined();
    expect(result.rows).toHaveLength(0);
  });

  it("returns error for syntax error", () => {
    const result = runner.executeSql("SELCT * FROM users", baseContext);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("syntax error");
  });

  it("returns error when DDL is missing", () => {
    const result = runner.executeSql("SELECT 1", {});
    expect(result.error).toContain("context.ddl is missing");
  });

  it("handles empty result set", () => {
    const result = runner.executeSql("SELECT * FROM users WHERE age > 100", baseContext);
    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(0);
  });

  it("handles scalar results (SELECT 1)", () => {
    const result = runner.executeSql("SELECT 42 AS answer", baseContext);
    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({ answer: 42 });
  });

  it("compareResults returns 1.0 for exact match", () => {
    const agentResult = runner.executeSql("SELECT * FROM users ORDER BY id", baseContext);
    const goldResult = [
      { id: 1, name: "Alice", age: 30 },
      { id: 2, name: "Bob", age: 25 },
      { id: 3, name: "Charlie", age: 35 },
    ];
    const { quality, reason } = runner.compareResults(agentResult, goldResult);
    expect(quality).toBe(1);
    expect(reason).toContain("exact match");
  });

  it("compareResults returns 0 for SQL error", () => {
    const agentResult = { rows: [], columns: [], error: "syntax error" };
    const { quality, reason } = runner.compareResults(agentResult, [{ id: 1 }]);
    expect(quality).toBe(0);
    expect(reason).toContain("SQL error");
  });

  it("compareResults returns partial credit for row count mismatch with same columns", () => {
    const agentResult = { rows: [{ id: 1 }], columns: ["id"] };
    const { quality, reason } = runner.compareResults(agentResult, [{ id: 1 }, { id: 2 }]);
    expect(quality).toBe(0.5); // partial credit: column count matches
    expect(reason).toContain("row count mismatch");
  });

  it("compareResults returns 0.5 for same columns but different data", () => {
    const agentResult = { rows: [{ id: 1, name: "X" }], columns: ["id", "name"] };
    const goldResult = [{ id: 1, name: "Y" }];
    const { quality, reason } = runner.compareResults(agentResult, goldResult);
    expect(quality).toBe(0.5);
    expect(reason).toContain("columns match");
  });

  it("compareResults handles column order differences", () => {
    const agentResult = runner.executeSql("SELECT name, id FROM users WHERE id = 1", baseContext);
    const goldResult = [{ id: 1, name: "Alice" }];
    const { quality } = runner.compareResults(agentResult, goldResult);
    expect(quality).toBe(1);
  });

  it("compareResults handles GROUP_CONCAT order differences", () => {
    const agentResult = {
      rows: [{ tags: "b,a,c" }],
      columns: ["tags"],
    };
    const goldResult = [{ tags: "a,b,c" }];
    const { quality } = runner.compareResults(agentResult, goldResult);
    expect(quality).toBe(1);
  });
});

// ── Bridge ──────────────────────────────────────────────────────────────────

describe("Bridge: toRoleProfile", () => {
  it("maps quality 0-1 to qualityScore 0-10", () => {
    const result: BenchmarkResult = {
      taskId: "t1",
      passed: true,
      quality: 0.8,
      latencyMs: 500,
      tokenUsage: { prompt: 100, completion: 50, total: 150 },
      acceptanceScore: 0.8,
      output: "SELECT 1",
    };
    const profile = toRoleProfile(result);
    expect(profile.qualityScore).toBe(8);
    expect(profile.latencyMs).toBe(500);
    expect(profile.costPerCall).toBeCloseTo(0.0015, 4);
  });

  it("maps quality 0 to qualityScore 0", () => {
    const result: BenchmarkResult = {
      taskId: "t2",
      passed: false,
      quality: 0,
      latencyMs: 1000,
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
      acceptanceScore: 0,
      output: "",
      error: "failed",
    };
    const profile = toRoleProfile(result);
    expect(profile.qualityScore).toBe(0);
    expect(profile.costPerCall).toBe(0);
  });
});

describe("Bridge: aggregateToRoleProfile", () => {
  it("averages across multiple results", () => {
    const results: BenchmarkResult[] = [
      { taskId: "t1", passed: true, quality: 1, latencyMs: 200, tokenUsage: { prompt: 100, completion: 50, total: 150 }, acceptanceScore: 1, output: "" },
      { taskId: "t2", passed: false, quality: 0, latencyMs: 800, tokenUsage: { prompt: 200, completion: 100, total: 300 }, acceptanceScore: 0, output: "" },
    ];
    const profile = aggregateToRoleProfile(results);
    expect(profile.qualityScore).toBe(5); // (10+0)/2
    expect(profile.latencyMs).toBe(500); // (200+800)/2
    // costPerCall = round4((0.0015 + 0.003) / 2) = round4(0.00225) = 0.0023
    expect(profile.costPerCall).toBeCloseTo(0.0023, 4);
  });

  it("returns zeros for empty results", () => {
    const profile = aggregateToRoleProfile([]);
    expect(profile).toEqual({ costPerCall: 0, latencyMs: 0, qualityScore: 0 });
  });
});

describe("Bridge: computeBenchmarkDelta", () => {
  it("computes positive quality delta when maximilian is better", () => {
    const baseline: BenchmarkResult[] = [
      { taskId: "t1", passed: false, quality: 0.5, latencyMs: 1000, tokenUsage: { prompt: 100, completion: 50, total: 150 }, acceptanceScore: 0.5, output: "" },
    ];
    const maximilian: BenchmarkResult[] = [
      { taskId: "t1", passed: true, quality: 1, latencyMs: 800, tokenUsage: { prompt: 80, completion: 40, total: 120 }, acceptanceScore: 1, output: "" },
    ];
    const delta = computeBenchmarkDelta(baseline, maximilian);
    expect(delta.qualityDelta).toBe(5); // 10 - 5
    expect(delta.latencyDeltaMs).toBe(-200); // 800 - 1000
    expect(delta.costDelta).toBeLessThan(0); // cheaper
    expect(delta.riskDelta).toBe(0);
  });
});

// ── computeAggregate ────────────────────────────────────────────────────────

describe("computeAggregate", () => {
  it("computes correct aggregates", () => {
    const results: BenchmarkResult[] = [
      { taskId: "t1", passed: true, quality: 1, latencyMs: 200, tokenUsage: { prompt: 100, completion: 50, total: 150 }, acceptanceScore: 1, output: "" },
      { taskId: "t2", passed: false, quality: 0.5, latencyMs: 400, tokenUsage: { prompt: 200, completion: 100, total: 300 }, acceptanceScore: 0.5, output: "" },
    ];
    const agg = computeAggregate(results);
    expect(agg.passRate).toBe(0.5);
    expect(agg.avgQuality).toBe(0.75);
    expect(agg.avgLatencyMs).toBe(300);
    expect(agg.totalTokens).toBe(450);
    expect(agg.avgAcceptance).toBe(0.75);
  });

  it("returns zeros for empty results", () => {
    const agg = computeAggregate([]);
    expect(agg.passRate).toBe(0);
    expect(agg.avgQuality).toBe(0);
  });
});

// ── BenchmarkEvaluator ──────────────────────────────────────────────────────

function makeMockProvider(response: string): Provider {
  return {
    id: "mock",
    name: "mock",
    defaultModel: "mock-1",
    isConfigured: () => true,
    chat: async (): Promise<ChatResponse> => ({
      content: response,
      model: "mock-1",
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    }),
    stream: async function* () { yield { delta: "ok", done: true }; },
  };
}

describe("BenchmarkEvaluator (baseline)", () => {
  it("runs a simple SQL task through baseline and gets quality=1", async () => {
    const task: BenchmarkTask = {
      id: "test-simple",
      domain: "database",
      difficulty: "easy",
      input: "List all users",
      context: {
        ddl: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users VALUES (1,'Alice'); INSERT INTO users VALUES (2,'Bob');",
        goldQuery: "SELECT * FROM users ORDER BY id",
        goldResult: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
      } satisfies DatabaseTaskContext as unknown as Record<string, unknown>,
      expectedOutputAssertion: async (output: string) => /SELECT/i.test(output),
    };

    const mockSql = "```sql\nSELECT * FROM users ORDER BY id;\n```";
    const provider = makeMockProvider(mockSql);
    const runner = new DatabaseRunner();

    // Mock DAGS (not used in baseline path)
    const mockDags = { compose: async () => ({}) } as never;

    const evaluator = new BenchmarkEvaluator({ provider, dags: mockDags, runner });
    const result = await evaluator.evaluateBaseline(task);

    expect(result.taskId).toBe("test-simple");
    expect(result.passed).toBe(true);
    expect(result.quality).toBe(1);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.tokenUsage.total).toBe(70);
    expect(result.error).toBeUndefined();
  });

  it("returns quality=0 when SQL has errors", async () => {
    const task: BenchmarkTask = {
      id: "test-error",
      domain: "database",
      difficulty: "easy",
      input: "Query nonexistent table",
      context: {
        ddl: "CREATE TABLE t(x INTEGER);",
        goldQuery: "SELECT * FROM t",
        goldResult: [],
      } satisfies DatabaseTaskContext as unknown as Record<string, unknown>,
      expectedOutputAssertion: async () => true,
    };

    const mockSql = "```sql\nSELECT * FROM nonexistent_table;\n```";
    const provider = makeMockProvider(mockSql);
    const runner = new DatabaseRunner();
    const mockDags = { compose: async () => ({}) } as never;
    const evaluator = new BenchmarkEvaluator({ provider, dags: mockDags, runner });
    const result = await evaluator.evaluateBaseline(task);

    expect(result.quality).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns quality=0 when no SQL found in output", async () => {
    const task: BenchmarkTask = {
      id: "test-no-sql",
      domain: "database",
      difficulty: "easy",
      input: "Do something",
      context: {
        ddl: "CREATE TABLE t(x INTEGER);",
        goldQuery: "SELECT * FROM t",
        goldResult: [],
      } satisfies DatabaseTaskContext as unknown as Record<string, unknown>,
      expectedOutputAssertion: async () => true,
    };

    const provider = makeMockProvider("I don't know how to write SQL.");
    const runner = new DatabaseRunner();
    const mockDags = { compose: async () => ({}) } as never;
    const evaluator = new BenchmarkEvaluator({ provider, dags: mockDags, runner });
    const result = await evaluator.evaluateBaseline(task);

    expect(result.quality).toBe(0);
    expect(result.error).toContain("No SQL found");
  });

  it("evaluate() runs multiple tasks and computes aggregates", async () => {
    const tasks: BenchmarkTask[] = [
      {
        id: "t1",
        domain: "database",
        difficulty: "easy",
        input: "List all",
        context: {
          ddl: "CREATE TABLE t(x INTEGER); INSERT INTO t VALUES (1);",
          goldQuery: "SELECT * FROM t",
          goldResult: [{ x: 1 }],
        } satisfies DatabaseTaskContext as unknown as Record<string, unknown>,
        expectedOutputAssertion: async () => true,
      },
      {
        id: "t2",
        domain: "database",
        difficulty: "easy",
        input: "Count rows",
        context: {
          ddl: "CREATE TABLE t(x INTEGER); INSERT INTO t VALUES (1); INSERT INTO t VALUES (2);",
          goldQuery: "SELECT COUNT(*) as cnt FROM t",
          goldResult: [{ cnt: 2 }],
        } satisfies DatabaseTaskContext as unknown as Record<string, unknown>,
        expectedOutputAssertion: async () => true,
      },
    ];

    const provider = makeMockProvider("```sql\nSELECT * FROM t;\n```");
    const runner = new DatabaseRunner();
    const mockDags = { compose: async () => ({}) } as never;
    const evaluator = new BenchmarkEvaluator({ provider, dags: mockDags, runner });
    const suite = await evaluator.evaluate(tasks);

    expect(suite.results).toHaveLength(2);
    expect(suite.aggregateMetrics.passRate).toBeGreaterThanOrEqual(0);
    expect(suite.aggregateMetrics.avgLatencyMs).toBeGreaterThanOrEqual(0);
    expect(suite.suiteId).toMatch(/^suite-/);
    expect(suite.startedAt).toBeDefined();
    expect(suite.completedAt).toBeDefined();
  });
});
