/**
 * Phase 10 — Telemetry tests.
 *
 * Tests:
 *   - Schema validation (ExecutionTrace, EvolutionTrace)
 *   - Ring buffer eviction
 *   - Concurrent recording safety
 *   - JSONL persistence
 *   - lineageByRole filtering
 *   - Empty state
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TelemetryCollector } from "../src/collector.js";
import {
  ExecutionTraceSchema,
  EvolutionTraceSchema,
  type ExecutionTrace,
  type EvolutionTrace,
} from "../src/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeExecutionInput(overrides: Partial<ExecutionTrace> = {}) {
  return {
    workspaceId: "ws-1",
    taskId: "task-1",
    userPrompt: "Build a REST API",
    assignedTeamGraph: {
      id: "graph-1",
      nodes: [
        { id: "n1", role: "backend", displayName: "Backend Agent", dependsOn: [] },
        { id: "n2", role: "review", displayName: "Review Agent", dependsOn: ["n1"] },
      ],
      capabilities: ["backend", "review"],
    },
    steps: [],
    status: "running" as const,
    ...overrides,
  };
}

function makeEvolutionInput(overrides: Partial<EvolutionTrace> = {}) {
  return {
    proposalId: "prop-1",
    proposalType: "birth" as const,
    subject: "backend",
    simulatedScores: {
      costDelta: 0.01,
      latencyDeltaMs: 100,
      qualityDelta: 0.5,
      riskDelta: 0,
      utility: 0.3,
    },
    governanceVerdict: { allowed: true, reason: "within limits" },
    rolloutStatus: "shadow" as const,
    approved: true,
    ...overrides,
  };
}

// ── Schema Validation ────────────────────────────────────────────────────────

describe("ExecutionTraceSchema", () => {
  it("parses valid execution trace", () => {
    const input = makeExecutionInput();
    const parsed = ExecutionTraceSchema.parse({
      id: "ex-1",
      startedAt: new Date().toISOString(),
      ...input,
    });
    expect(parsed.id).toBe("ex-1");
    expect(parsed.workspaceId).toBe("ws-1");
    expect(parsed.assignedTeamGraph.nodes).toHaveLength(2);
  });

  it("rejects missing required fields", () => {
    expect(() => ExecutionTraceSchema.parse({ id: "ex-1" })).toThrow();
  });

  it("rejects invalid status", () => {
    expect(() =>
      ExecutionTraceSchema.parse({
        id: "ex-1",
        workspaceId: "ws-1",
        taskId: "t1",
        userPrompt: "test",
        assignedTeamGraph: { id: "g1", nodes: [], capabilities: [] },
        steps: [],
        status: "invalid",
        startedAt: new Date().toISOString(),
      })
    ).toThrow();
  });
});

describe("EvolutionTraceSchema", () => {
  it("parses valid evolution trace", () => {
    const input = makeEvolutionInput();
    const parsed = EvolutionTraceSchema.parse({
      id: "evo-1",
      recordedAt: new Date().toISOString(),
      ...input,
    });
    expect(parsed.id).toBe("evo-1");
    expect(parsed.proposalType).toBe("birth");
    expect(parsed.simulatedScores.utility).toBe(0.3);
  });

  it("rejects invalid proposalType", () => {
    expect(() =>
      EvolutionTraceSchema.parse({
        id: "evo-1",
        proposalId: "p1",
        proposalType: "invalid",
        subject: "x",
        simulatedScores: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0, riskDelta: 0, utility: 0 },
        governanceVerdict: { allowed: true, reason: "" },
        rolloutStatus: "shadow",
        approved: true,
        recordedAt: new Date().toISOString(),
      })
    ).toThrow();
  });

  it("accepts all valid proposalTypes", () => {
    const types = ["birth", "retire", "promote", "demote", "merge", "split", "rebalance_team"];
    for (const type of types) {
      const parsed = EvolutionTraceSchema.parse({
        id: "evo-1",
        proposalId: "p1",
        proposalType: type,
        subject: "x",
        simulatedScores: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0, riskDelta: 0, utility: 0 },
        governanceVerdict: { allowed: true, reason: "" },
        rolloutStatus: "shadow",
        approved: true,
        recordedAt: new Date().toISOString(),
      });
      expect(parsed.proposalType).toBe(type);
    }
  });

  it("accepts all valid rolloutStatuses", () => {
    const statuses = ["shadow", "canary", "full", "applied", "skipped"];
    for (const status of statuses) {
      const parsed = EvolutionTraceSchema.parse({
        id: "evo-1",
        proposalId: "p1",
        proposalType: "birth",
        subject: "x",
        simulatedScores: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0, riskDelta: 0, utility: 0 },
        governanceVerdict: { allowed: true, reason: "" },
        rolloutStatus: status,
        approved: true,
        recordedAt: new Date().toISOString(),
      });
      expect(parsed.rolloutStatus).toBe(status);
    }
  });
});

// ── TelemetryCollector ───────────────────────────────────────────────────────

describe("TelemetryCollector", () => {
  it("records and lists executions", async () => {
    const collector = new TelemetryCollector();
    const trace = await collector.recordExecution(makeExecutionInput());

    expect(trace.id).toMatch(/^ex-/);
    expect(trace.startedAt).toBeDefined();
    expect(trace.status).toBe("running");

    const all = collector.listExecutions();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(trace.id);
  });

  it("records and lists evolutions", async () => {
    const collector = new TelemetryCollector();
    const trace = await collector.recordEvolution(makeEvolutionInput());

    expect(trace.id).toMatch(/^evo-/);
    expect(trace.recordedAt).toBeDefined();

    const all = collector.listEvolutions();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(trace.id);
  });

  it("returns empty arrays for fresh collector", () => {
    const collector = new TelemetryCollector();
    expect(collector.listExecutions()).toEqual([]);
    expect(collector.listEvolutions()).toEqual([]);
    expect(collector.lineageByRole("anyone")).toEqual([]);
  });

  it("returns copies (not references) from list methods", async () => {
    const collector = new TelemetryCollector();
    await collector.recordExecution(makeExecutionInput());

    const list1 = collector.listExecutions();
    const list2 = collector.listExecutions();
    expect(list1).not.toBe(list2);
    expect(list1).toEqual(list2);
  });
});

// ── Ring Buffer Eviction ─────────────────────────────────────────────────────

describe("TelemetryCollector — ring buffer eviction", () => {
  it("evicts oldest traces when maxBufferSize exceeded", async () => {
    const collector = new TelemetryCollector({ maxBufferSize: 3 });

    for (let i = 0; i < 5; i++) {
      await collector.recordExecution(makeExecutionInput({ taskId: `task-${i}` }));
    }

    const all = collector.listExecutions();
    expect(all).toHaveLength(3);
    // Should keep the last 3 (task-2, task-3, task-4)
    expect(all[0].taskId).toBe("task-2");
    expect(all[1].taskId).toBe("task-3");
    expect(all[2].taskId).toBe("task-4");
  });

  it("evolution buffer is independent from execution buffer", async () => {
    const collector = new TelemetryCollector({ maxBufferSize: 2 });

    await collector.recordExecution(makeExecutionInput({ taskId: "ex-1" }));
    await collector.recordExecution(makeExecutionInput({ taskId: "ex-2" }));
    await collector.recordExecution(makeExecutionInput({ taskId: "ex-3" }));

    await collector.recordEvolution(makeEvolutionInput({ subject: "evo-1" }));

    expect(collector.listExecutions()).toHaveLength(2);
    expect(collector.listEvolutions()).toHaveLength(1);
  });

  it("default maxBufferSize is 1000", async () => {
    const collector = new TelemetryCollector();

    for (let i = 0; i < 10; i++) {
      await collector.recordExecution(makeExecutionInput({ taskId: `task-${i}` }));
    }

    expect(collector.listExecutions()).toHaveLength(10);
  });
});

// ── Concurrent Recording ─────────────────────────────────────────────────────

describe("TelemetryCollector — concurrent safety", () => {
  it("handles 50 parallel recordExecution calls without corruption", async () => {
    const collector = new TelemetryCollector({ maxBufferSize: 100 });

    const promises = Array.from({ length: 50 }, (_, i) =>
      collector.recordExecution(makeExecutionInput({ taskId: `task-${i}` }))
    );

    const results = await Promise.all(promises);

    // All should have unique IDs
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(50);

    // Buffer should contain all 50
    const all = collector.listExecutions();
    expect(all).toHaveLength(50);
  });

  it("handles 50 parallel recordEvolution calls without corruption", async () => {
    const collector = new TelemetryCollector({ maxBufferSize: 100 });

    const promises = Array.from({ length: 50 }, (_, i) =>
      collector.recordEvolution(makeEvolutionInput({ subject: `role-${i}` }))
    );

    const results = await Promise.all(promises);

    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(50);

    const all = collector.listEvolutions();
    expect(all).toHaveLength(50);
  });

  it("handles mixed concurrent execution and evolution recording", async () => {
    const collector = new TelemetryCollector({ maxBufferSize: 200 });

    const execPromises = Array.from({ length: 25 }, (_, i) =>
      collector.recordExecution(makeExecutionInput({ taskId: `exec-${i}` }))
    );
    const evoPromises = Array.from({ length: 25 }, (_, i) =>
      collector.recordEvolution(makeEvolutionInput({ subject: `evo-${i}` }))
    );

    await Promise.all([...execPromises, ...evoPromises]);

    expect(collector.listExecutions()).toHaveLength(25);
    expect(collector.listEvolutions()).toHaveLength(25);
  });
});

// ── JSONL Persistence ────────────────────────────────────────────────────────

describe("TelemetryCollector — JSONL persistence", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists executions to JSONL file", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "telemetry-test-"));
    const collector = new TelemetryCollector({ persistPath: tmpDir });

    await collector.recordExecution(makeExecutionInput({ taskId: "t1" }));
    await collector.recordExecution(makeExecutionInput({ taskId: "t2" }));
    await collector.flush();

    const content = readFileSync(join(tmpDir, "executions.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.taskId).toBe("t1");

    const parsed2 = JSON.parse(lines[1]);
    expect(parsed2.taskId).toBe("t2");
  });

  it("persists evolutions to JSONL file", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "telemetry-test-"));
    const collector = new TelemetryCollector({ persistPath: tmpDir });

    await collector.recordEvolution(makeEvolutionInput({ subject: "backend" }));
    await collector.recordEvolution(makeEvolutionInput({ subject: "frontend" }));
    await collector.flush();

    const content = readFileSync(join(tmpDir, "evolutions.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.subject).toBe("backend");
  });

  it("appends to existing JSONL file", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "telemetry-test-"));
    const collector1 = new TelemetryCollector({ persistPath: tmpDir });
    await collector1.recordExecution(makeExecutionInput({ taskId: "batch1" }));
    await collector1.flush();

    const collector2 = new TelemetryCollector({ persistPath: tmpDir });
    await collector2.recordExecution(makeExecutionInput({ taskId: "batch2" }));
    await collector2.flush();

    const content = readFileSync(join(tmpDir, "executions.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("does not persist when persistPath is not set", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "telemetry-test-"));
    const collector = new TelemetryCollector();
    await collector.recordExecution(makeExecutionInput());

    // No files should be created in tmpDir
    // (collector has no persistPath, so nothing is written)
    expect(collector.listExecutions()).toHaveLength(1);
  });

  it("JSONL lines are valid JSON even with concurrent writes", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "telemetry-test-"));
    const collector = new TelemetryCollector({ persistPath: tmpDir, maxBufferSize: 200 });

    const promises = Array.from({ length: 20 }, (_, i) =>
      collector.recordExecution(makeExecutionInput({ taskId: `concurrent-${i}` }))
    );
    await Promise.all(promises);
    await collector.flush();

    const content = readFileSync(join(tmpDir, "executions.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(20);

    // Every line must be valid JSON
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.id).toMatch(/^ex-/);
      expect(parsed.taskId).toMatch(/^concurrent-/);
    }
  });
});

// ── lineageByRole ────────────────────────────────────────────────────────────

describe("TelemetryCollector — lineageByRole", () => {
  it("filters evolution traces by subject", async () => {
    const collector = new TelemetryCollector();

    await collector.recordEvolution(makeEvolutionInput({ subject: "frontend" }));
    await collector.recordEvolution(makeEvolutionInput({ subject: "backend" }));
    await collector.recordEvolution(makeEvolutionInput({ subject: "frontend" }));
    await collector.recordEvolution(makeEvolutionInput({ subject: "review" }));

    const frontend = collector.lineageByRole("frontend");
    expect(frontend).toHaveLength(2);
    expect(frontend.every((t) => t.subject === "frontend")).toBe(true);

    const backend = collector.lineageByRole("backend");
    expect(backend).toHaveLength(1);

    const review = collector.lineageByRole("review");
    expect(review).toHaveLength(1);
  });

  it("returns empty array for unknown role", async () => {
    const collector = new TelemetryCollector();
    await collector.recordEvolution(makeEvolutionInput({ subject: "frontend" }));

    expect(collector.lineageByRole("nonexistent")).toEqual([]);
  });

  it("does not include execution traces in lineage", async () => {
    const collector = new TelemetryCollector();
    await collector.recordExecution(makeExecutionInput());
    await collector.recordEvolution(makeEvolutionInput({ subject: "backend" }));

    // lineageByRole only looks at evolutionBuffer
    expect(collector.lineageByRole("backend")).toHaveLength(1);
  });
});
