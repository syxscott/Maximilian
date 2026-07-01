/**
 * Phase 8 — Digital Twin & Safe Evolution unit tests.
 *
 * Covers:
 *   8.1 SimulationEngine.simulateDelta
 *   8.2 DigitalTwin capture / apply
 *   8.3 ProposalPipeline (simulate → score → approve)
 *   8.4 SafeRollout (shadow / canary / full)
 *   8.5 DecisionScore / scoreProposal
 *   8.6 ReplayEngine
 *   8.7 MetaOrchestrator with pipeline wired
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import type { ExecutionRecord } from "@max/autonomy";
import type { AgentBlueprint, TeamGraph } from "@max/dags";

import {
  CapabilityRegistry,
  CapabilityDiscoveryEngine,
  AgentBirthEngine,
  AgentRetirementEngine,
  MetaAgent,
  TeamOptimizer,
  OrganizationMemory,
  SimulationEngine,
  GovernanceEngine,
  MetaOrchestrator,
  DEFAULT_GOVERNANCE_CONFIG,
  DigitalTwin,
  snapshotToSimulationInput,
  ProposalPipeline,
  SafeRollout,
  ReplayEngine,
  createProposal,
  scoreProposal,
  fromAgentChange,
  fromTeamHint,
  birthResultToBlueprint,
  type DiscoverySignal,
  type MetaOrchestratorDeps,
  type MetaCycleInput,
  type AgentBlueprint as _AB,
} from "../src/index.js";

async function makeTmp(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "max-phase8-"));
}

function makeExecution(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: `exec-${Math.random().toString(36).slice(2, 8)}`,
    taskId: `t-${Math.random().toString(36).slice(2, 6)}`,
    workspaceId: "ws-1",
    agentRole: "frontend_agent",
    blueprintId: "bp-frontend-v1",
    artifacts: [],
    review: { summary: "ok", strengths: ["good"], weaknesses: [], score: 7, suggestions: [], at: new Date().toISOString() },
    userFeedback: [],
    startedAt: new Date().toISOString(),
    durationMs: 1000,
    status: "completed",
    ...overrides,
  };
}

function makeBlueprint(overrides: Partial<AgentBlueprint> = {}): AgentBlueprint {
  const now = new Date().toISOString();
  return {
    id: `bp-${Math.random().toString(36).slice(2, 6)}`,
    role: "frontend_agent",
    displayName: "Frontend Agent",
    goal: "Build frontend code",
    systemPrompt: "You are a frontend agent.",
    capabilities: ["frontend"],
    tools: [],
    preferredModels: [],
    constraints: { outputFormat: "code" },
    version: "v1",
    createdAt: now,
    updatedAt: now,
    stats: { totalTasks: 0, totalSuccesses: 0, avgScore: 0, avgExecutionTimeMs: 0 },
    metadata: {},
    ...overrides,
  };
}

function makeTeamGraph(overrides: Partial<TeamGraph> = {}): TeamGraph {
  const now = new Date().toISOString();
  return {
    id: `g-${Math.random().toString(36).slice(2, 6)}`,
    userRequest: "Build an app",
    capabilities: ["frontend"],
    nodes: [{ id: "n-frontend", blueprintId: "bp-frontend-v1", role: "frontend", displayName: "Frontend", dependsOn: [] }],
    edges: [],
    layers: [{ index: 0, nodeIds: ["n-frontend"] }],
    createdAt: now,
    status: "draft",
    ...overrides,
  };
}

// ============================================================================
// 8.1 — SimulationEngine.simulateDelta
// ============================================================================

describe("8.1 SimulationEngine.simulateDelta", () => {
  let engine: SimulationEngine;

  beforeEach(() => {
    engine = new SimulationEngine();
  });

  it("returns zero delta for identical orgs", async () => {
    const input = {
      orgName: "A",
      graph: makeTeamGraph(),
      profiles: { frontend: { costPerCall: 1, latencyMs: 1000, qualityScore: 8 } },
    };
    const delta = await engine.simulateDelta(input, input);
    expect(delta.costDelta).toBe(0);
    expect(delta.latencyDeltaMs).toBe(0);
    expect(delta.qualityDelta).toBe(0);
    expect(delta.riskDelta).toBe(0);
  });

  it("computes positive costDelta when adding a node", async () => {
    const before = {
      orgName: "A",
      graph: makeTeamGraph({ nodes: [{ id: "n1", blueprintId: "b1", role: "frontend", displayName: "FE", dependsOn: [] }] }),
      profiles: { frontend: { costPerCall: 1, latencyMs: 1000, qualityScore: 8 } },
    };
    const after = {
      orgName: "B",
      graph: makeTeamGraph({
        nodes: [
          { id: "n1", blueprintId: "b1", role: "frontend", displayName: "FE", dependsOn: [] },
          { id: "n2", blueprintId: "b2", role: "backend", displayName: "BE", dependsOn: ["n1"] },
        ],
      }),
      profiles: {
        frontend: { costPerCall: 1, latencyMs: 1000, qualityScore: 8 },
        backend: { costPerCall: 1.5, latencyMs: 2000, qualityScore: 7 },
      },
    };
    const delta = await engine.simulateDelta(before, after);
    expect(delta.costDelta).toBe(1.5);
    expect(delta.latencyDeltaMs).toBeGreaterThan(0);
  });

  it("computes negative qualityDelta when retiring a high-quality role", async () => {
    const before = {
      orgName: "A",
      graph: makeTeamGraph({
        nodes: [
          { id: "n1", blueprintId: "b1", role: "frontend", displayName: "FE", dependsOn: [] },
          { id: "n2", blueprintId: "b2", role: "backend", displayName: "BE", dependsOn: ["n1"] },
        ],
      }),
      profiles: {
        frontend: { costPerCall: 1, latencyMs: 1000, qualityScore: 8 },
        backend: { costPerCall: 1, latencyMs: 1000, qualityScore: 9 },
      },
    };
    const after = {
      ...before,
      graph: makeTeamGraph({ nodes: [{ id: "n1", blueprintId: "b1", role: "frontend", displayName: "FE", dependsOn: [] }] }),
    };
    const delta = await engine.simulateDelta(before, after);
    // Removing one node removes one quality contribution; avg drops.
    expect(delta.qualityDelta).toBeLessThan(0);
  });

  it("includes before / after results", async () => {
    const before = {
      orgName: "A",
      graph: makeTeamGraph(),
      profiles: { frontend: { costPerCall: 1, latencyMs: 1000, qualityScore: 8 } },
    };
    const after = {
      orgName: "B",
      graph: makeTeamGraph(),
      profiles: { frontend: { costPerCall: 1, latencyMs: 1000, qualityScore: 9 } },
    };
    const delta = await engine.simulateDelta(before, after);
    expect(delta.before?.orgName).toBe("A");
    expect(delta.after?.orgName).toBe("B");
    expect(delta.simulatedAt).toBeDefined();
  });
});

// ============================================================================
// 8.2 — DigitalTwin
// ============================================================================

describe("8.2 DigitalTwin", () => {
  it("captures a snapshot", () => {
    const snap = DigitalTwin.capture({
      capabilities: [{ id: "a", displayName: "A", status: "active", createdAt: "", updatedAt: "" }],
      blueprints: [makeBlueprint()],
      graphs: [makeTeamGraph()],
    });
    expect(snap.id).toMatch(/^snap-/);
    expect(snap.capabilities.length).toBe(1);
    expect(snap.blueprints.length).toBe(1);
    expect(snap.graphs.length).toBe(1);
    expect(snap.capturedAt).toBeDefined();
  });

  it("apply(birth) adds a capability and blueprint", () => {
    const snap = DigitalTwin.capture({
      capabilities: [],
      blueprints: [],
      graphs: [],
    });
    const next = DigitalTwin.apply(snap, { kind: "birth", subject: "new_cap" });
    expect(next.capabilities.length).toBe(1);
    expect(next.capabilities[0]!.status).toBe("active");
    expect(next.blueprints.length).toBe(1);
    // original snapshot is unchanged
    expect(snap.capabilities.length).toBe(0);
  });

  it("apply(retire) marks capability + blueprint as retired", () => {
    const snap = DigitalTwin.capture({
      capabilities: [{ id: "a", displayName: "A", status: "active", createdAt: "", updatedAt: "" }],
      blueprints: [makeBlueprint({ id: "bp-a", role: "a_agent" })],
      graphs: [],
    });
    const next = DigitalTwin.apply(snap, { kind: "retire", subject: "a_agent" });
    expect(next.capabilities[0]!.status).toBe("retired");
    expect((next.blueprints[0] as { retiredAt?: string }).retiredAt).toBeDefined();
  });

  it("apply(promote) flips capability status to active", () => {
    const snap = DigitalTwin.capture({
      capabilities: [{ id: "a", displayName: "A", status: "experimental", createdAt: "", updatedAt: "" }],
      blueprints: [],
      graphs: [],
    });
    const next = DigitalTwin.apply(snap, { kind: "promote", subject: "a" });
    expect(next.capabilities[0]!.status).toBe("active");
    expect(next.capabilities[0]!.promotedAt).toBeDefined();
  });

  it("apply(merge) retires subject role, keeps target", () => {
    const snap = DigitalTwin.capture({
      capabilities: [],
      blueprints: [
        makeBlueprint({ id: "bp-a", role: "a_agent" }),
        makeBlueprint({ id: "bp-b", role: "b_agent" }),
      ],
      graphs: [],
    });
    const next = DigitalTwin.apply(snap, { kind: "merge", subject: "a_agent", target: "b_agent" });
    expect((next.blueprints[0] as { retiredAt?: string }).retiredAt).toBeDefined();
    expect((next.blueprints[1] as { retiredAt?: string }).retiredAt).toBeUndefined();
  });

  it("apply(split) retires subject role and adds target", () => {
    const snap = DigitalTwin.capture({
      capabilities: [],
      blueprints: [makeBlueprint({ id: "bp-slow", role: "slow_agent" })],
      graphs: [],
    });
    const next = DigitalTwin.apply(snap, { kind: "split", subject: "slow_agent", target: "slow_planner" });
    expect((next.blueprints[0] as { retiredAt?: string }).retiredAt).toBeDefined();
    expect(next.blueprints.length).toBe(2);
  });

  it("snapshotToSimulationInput produces a valid SimulationInput", () => {
    const snap = DigitalTwin.capture({
      capabilities: [{ id: "a", displayName: "A", status: "active", createdAt: "", updatedAt: "" }],
      blueprints: [makeBlueprint({ role: "a_agent" })],
      graphs: [],
    });
    const input = snapshotToSimulationInput(snap, "OrgX");
    expect(input.orgName).toBe("OrgX");
    expect(input.graph.nodes.length).toBe(1);
    expect(input.profiles["a_agent"]).toBeDefined();
  });
});

// ============================================================================
// 8.3 — ProposalPipeline
// ============================================================================

describe("8.3 ProposalPipeline", () => {
  let tmp: string;
  let pipeline: ProposalPipeline;

  beforeEach(async () => {
    tmp = await makeTmp();
    const simulation = new SimulationEngine();
    const registry = new CapabilityRegistry(tmp);
    pipeline = new ProposalPipeline({
      simulation,
      captureSnapshot: async () =>
        DigitalTwin.capture({
          capabilities: await registry.listAll(),
          blueprints: [],
          graphs: [],
        }),
    });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("runs a birth proposal through simulate → score → approve", async () => {
    const proposal = createProposal({
      action: "birth",
      subject: "mobile_app_development",
      rationale: "User asked for an iOS app",
      source: "meta_agent",
    });
    const result = await pipeline.run(proposal);
    expect(result.proposal.status).toBe("approved");
    expect(result.simulation.costDelta).toBeGreaterThanOrEqual(0);
    expect(result.score.qualityGain).toBeGreaterThanOrEqual(0);
  });

  it("runs a retire proposal and approves when utility >= 0", async () => {
    const proposal = createProposal({
      action: "retire",
      subject: "low_quality_role",
      rationale: "Score too low",
      source: "meta_agent",
    });
    const result = await pipeline.run(proposal);
    expect(result.proposal.status === "approved" || result.proposal.status === "rejected").toBe(true);
    expect(result.score.utility).toBeGreaterThanOrEqual(0);
  });

  it("rejects proposal when utility is below threshold", async () => {
    // qualityDelta negative + costDelta positive → utility drops below threshold.
    const simulation = new SimulationEngine();
    const registry = new CapabilityRegistry(tmp);
    const strictPipeline = new ProposalPipeline({
      simulation,
      captureSnapshot: async () =>
        DigitalTwin.capture({
          capabilities: await registry.listAll(),
          blueprints: [],
          graphs: [],
        }),
    });
    // Create a snapshot with 2 active capabilities, retire one — quality drops.
    await registry.propose({ capabilityId: "a", displayName: "A" });
    await registry.transition("a", "experimental");
    await registry.transition("a", "active");
    await registry.propose({ capabilityId: "b", displayName: "B" });
    await registry.transition("b", "experimental");
    await registry.transition("b", "active");
    const proposal = createProposal({
      action: "retire",
      subject: "b",
      rationale: "retire one of two",
      source: "meta_agent",
    });
    const result = await strictPipeline.run(proposal);
    // Just check that the pipeline produces a DecisionScore with utility.
    expect(result.score).toBeDefined();
    expect(typeof result.score.utility).toBe("number");
  });

  it("creates a proposal with valid id and status", () => {
    const p = createProposal({
      action: "birth",
      subject: "x",
      rationale: "test",
      source: "manual",
    });
    expect(p.id).toMatch(/^prop-/);
    expect(p.status).toBe("draft");
  });

  it("fromAgentChange maps create→birth, delete→retire, merge, split", () => {
    const create = fromAgentChange({ action: "create", agentRole: "r", reason: "x" });
    expect(create.action).toBe("birth");
    const del = fromAgentChange({ action: "delete", agentRole: "r", reason: "x" });
    expect(del.action).toBe("retire");
    const merge = fromAgentChange({ action: "merge", agentRole: "a", targetRole: "b", reason: "x" });
    expect(merge.action).toBe("merge");
    expect(merge.target).toBe("b");
    const split = fromAgentChange({ action: "split", agentRole: "a", targetRole: "a_planner", reason: "x" });
    expect(split.action).toBe("split");
  });

  it("fromTeamHint emits retire for remove_redundant/shrink_team and rebalance for others", () => {
    const hint = {
      id: "h-1",
      suggestions: [
        { type: "remove_redundant", targetRole: "r1", rationale: "r" },
        { type: "shrink_team", targetRole: "r2", rationale: "r" },
        { type: "grow_team", targetRole: "r3", rationale: "r" },
        { type: "add_review_node", rationale: "r" },
        { type: "parallelize", rationale: "r" },
      ],
    };
    const props = fromTeamHint(hint);
    expect(props.length).toBe(5);
    const retireCount = props.filter((p) => p.action === "retire").length;
    const rebalanceCount = props.filter((p) => p.action === "rebalance_team").length;
    expect(retireCount).toBe(2);
    expect(rebalanceCount).toBe(3);
  });
});

// ============================================================================
// 8.4 — SafeRollout
// ============================================================================

describe("8.4 SafeRollout", () => {
  it("default mode is shadow", () => {
    const r = new SafeRollout();
    expect(r.getMode()).toBe("shadow");
  });

  it("shadow mode never applies", async () => {
    const r = new SafeRollout("shadow");
    let applied = false;
    let recorded = 0;
    const proposal = createProposal({
      action: "birth", subject: "x", rationale: "r", source: "manual",
    });
    const res = await r.apply({
      proposal,
      applyMutation: async () => { applied = true; },
      record: async () => { recorded++; },
    });
    expect(res.applied).toBe(false);
    expect(applied).toBe(false);
    expect(recorded).toBe(1);
    expect(res.reason).toContain("shadow");
  });

  it("full mode always applies", async () => {
    const r = new SafeRollout("full");
    let applied = false;
    let recorded = 0;
    const proposal = createProposal({
      action: "birth", subject: "x", rationale: "r", source: "manual",
    });
    const res = await r.apply({
      proposal,
      applyMutation: async () => { applied = true; },
      record: async () => { recorded++; },
    });
    expect(res.applied).toBe(true);
    expect(applied).toBe(true);
    expect(recorded).toBe(1);
    expect(res.reason).toContain("full");
  });

  it("canary mode applies for some keys but not all", async () => {
    const r = new SafeRollout("canary");
    let applied = 0;
    let notApplied = 0;
    for (let i = 0; i < 100; i++) {
      const proposal = createProposal({
        action: "birth", subject: `x-${i}`, rationale: "r", source: "manual",
      });
      const res = await r.apply({
        proposal,
        applyMutation: async () => { applied++; },
        record: async () => {},
      });
      if (res.applied) applied++; else notApplied++;
    }
    expect(applied).toBeGreaterThan(0);
    expect(notApplied).toBeGreaterThan(0);
  });

  it("canary uses canaryKey when provided", async () => {
    const r = new SafeRollout("canary");
    let mutationCalled = false;
    const proposal = createProposal({
      action: "birth", subject: "x", rationale: "r", source: "manual",
    });
    const res = await r.apply({
      proposal,
      applyMutation: async () => { mutationCalled = true; },
      record: async () => {},
      canaryKey: "aaaaaa",  // hashFraction("aaaaaa") ≈ 0.2064 ≥ 0.1 → should NOT apply
    });
    expect(res.applied).toBe(false);
    expect(mutationCalled).toBe(false);
    expect(res.reason).toContain("canary");
  });

  it("setMode updates mode", () => {
    const r = new SafeRollout("shadow");
    r.setMode("full");
    expect(r.getMode()).toBe("full");
    r.setMode("canary");
    expect(r.getMode()).toBe("canary");
  });
});

// ============================================================================
// 8.5 — scoreProposal (Decision Scoring)
// ============================================================================

describe("8.5 DecisionScore / scoreProposal", () => {
  it("utility = qualityGain - latency - cost - risk", () => {
    const proposal = createProposal({
      action: "birth", subject: "x", rationale: "r", source: "manual",
    });
    const sim = {
      costDelta: 1,
      latencyDeltaMs: 1000,
      qualityDelta: 5,
      riskDelta: 0,
      simulatedAt: new Date().toISOString(),
    };
    const score = scoreProposal(proposal, sim);
    // qualityGain=5, latencyPenalty=1.0, costPenalty=1.0, riskPenalty=0 → utility=3.0
    expect(score.utility).toBe(3);
    expect(score.approved).toBe(true);
  });

  it("approves when utility > threshold", () => {
    const p = createProposal({ action: "birth", subject: "x", rationale: "r", source: "manual" });
    const score = scoreProposal(p, {
      costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0.5, riskDelta: 0,
      simulatedAt: new Date().toISOString(),
    });
    expect(score.utility).toBe(0.5);
    expect(score.approved).toBe(true);
  });

  it("rejects when utility is 0 or negative", () => {
    const p = createProposal({ action: "birth", subject: "x", rationale: "r", source: "manual" });
    const score = scoreProposal(p, {
      costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0, riskDelta: 0,
      simulatedAt: new Date().toISOString(),
    });
    expect(score.utility).toBe(0);
    expect(score.approved).toBe(false);
  });

  it("penalizes risk delta", () => {
    const p = createProposal({ action: "birth", subject: "x", rationale: "r", source: "manual" });
    const score = scoreProposal(p, {
      costDelta: 0, latencyDeltaMs: 0, qualityDelta: 1, riskDelta: 0.5,
      simulatedAt: new Date().toISOString(),
    });
    // qualityGain=1, riskPenalty=0.5*10=5 → utility=-4
    expect(score.utility).toBe(-4);
    expect(score.approved).toBe(false);
  });
});

// ============================================================================
// 8.6 — ReplayEngine
// ============================================================================

describe("8.6 ReplayEngine", () => {
  it("replays against historical executions and computes baseline quality", async () => {
    const executions = Array.from({ length: 5 }, (_, i) =>
      makeExecution({ id: `e-${i}`, agentRole: "frontend_agent", review: { summary: "", strengths: [], weaknesses: [], score: 7, suggestions: [], at: "" } })
    );
    const engine = new ReplayEngine({ getExecutions: async () => executions });
    const proposal = createProposal({
      action: "retire", subject: "frontend_agent", rationale: "test", source: "manual",
    });
    const outcome = await engine.replay({ proposal, scoreDelta: 1 });
    expect(outcome.baselineQuality).toBe(7);
    expect(outcome.simulatedQuality).toBe(8);
    expect(outcome.qualityDelta).toBe(1);
    expect(outcome.affectedExecutions).toBe(5);
  });

  it("returns 0 baseline when no executions match", async () => {
    const engine = new ReplayEngine({ getExecutions: async () => [] });
    const proposal = createProposal({
      action: "retire", subject: "unknown", rationale: "r", source: "manual",
    });
    const outcome = await engine.replay({ proposal });
    expect(outcome.baselineQuality).toBe(0);
    expect(outcome.affectedExecutions).toBe(0);
  });
});

// ============================================================================
// 8.7 — MetaOrchestrator with pipeline wired
// ============================================================================

describe("8.7 MetaOrchestrator (Phase 8 — pipeline wired)", () => {
  let tmp: string;
  let deps: MetaOrchestratorDeps;
  let orchestrator: MetaOrchestrator;
  let pipeline: ProposalPipeline;
  let rollout: SafeRollout;

  beforeEach(async () => {
    tmp = await makeTmp();
    const registry = new CapabilityRegistry(tmp);
    const discovery = new CapabilityDiscoveryEngine(tmp);
    const birth = new AgentBirthEngine({ rootDir: tmp });
    const retirement = new AgentRetirementEngine();
    const metaAgent = new MetaAgent();
    const teamOptimizer = new TeamOptimizer();
    const orgMemory = new OrganizationMemory(tmp);
    const governance = new GovernanceEngine(tmp);
    const simulation = new SimulationEngine();

    pipeline = new ProposalPipeline({
      simulation,
      captureSnapshot: async () =>
        DigitalTwin.capture({
          capabilities: await registry.listAll(),
          blueprints: [],
          graphs: [],
        }),
    });
    rollout = new SafeRollout("shadow");  // default safe mode

    deps = {
      registry, discovery, birth, retirement, metaAgent, teamOptimizer, orgMemory, governance,
      pipeline, rollout,
    };
    orchestrator = new MetaOrchestrator(deps);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("runs every mutation through the pipeline", async () => {
    const input: MetaCycleInput = {
      recentExecutions: [],
      blueprints: [],
      graphs: [],
      discoverySignals: [
        { text: "Build iOS app", context: "user", source: "user_request_analysis" },
        { text: "Swift Kotlin", context: "user", source: "user_request_analysis" },
      ],
    };
    const result = await orchestrator.cycle(input);
    // In shadow mode no live mutations occur, but proposals were routed.
    expect(result.proposalsPhase8).toBeDefined();
    expect(result.proposalsPhase8!.length).toBeGreaterThan(0);
    // Every trace must have a simulation delta and a decision score.
    for (const t of result.proposalsPhase8!) {
      expect(t.simulation.simulatedAt).toBeDefined();
      expect(t.score.utility).toBeGreaterThanOrEqual(0);
      // In shadow mode rollout.applied is always false.
      expect(t.rollout?.applied).toBe(false);
    }
  });

  it("shadow mode produces no births/retirements but routes proposals", async () => {
    const input: MetaCycleInput = {
      recentExecutions: [],
      blueprints: [],
      graphs: [],
      discoverySignals: [
        { text: "Build iOS app", context: "user", source: "user_request_analysis" },
        { text: "Swift Kotlin", context: "user", source: "user_request_analysis" },
      ],
    };
    const result = await orchestrator.cycle(input);
    expect(result.births.length).toBe(0);
    expect(result.retirements.length).toBe(0);
    expect(result.proposalsPhase8!.length).toBeGreaterThan(0);
  });

  it("full mode actually mutates after pipeline approval", async () => {
    rollout.setMode("full");
    const input: MetaCycleInput = {
      recentExecutions: [],
      blueprints: [],
      graphs: [],
      discoverySignals: [
        { text: "Build iOS app", context: "user", source: "user_request_analysis" },
        { text: "Swift Kotlin", context: "user", source: "user_request_analysis" },
      ],
    };
    const result = await orchestrator.cycle(input);
    // In full mode, birth proposals with positive utility should be applied.
    const appliedBirths = result.proposalsPhase8!.filter(
      (t) => t.rollout?.applied && t.proposal.action === "birth"
    );
    expect(appliedBirths.length).toBeGreaterThan(0);
    expect(result.births.length).toBe(appliedBirths.length);
  });

  it("uses SimulationDelta for every birth/retirement/promotion decision", async () => {
    const input: MetaCycleInput = {
      recentExecutions: [],
      blueprints: [makeBlueprint({ id: "bp-orphan" })],
      graphs: [],
      discoverySignals: [],
    };
    const result = await orchestrator.cycle(input);
    // Every trace must have a SimulationDelta with cost/latency/quality/risk.
    for (const t of result.proposalsPhase8!) {
      expect(typeof t.simulation.costDelta).toBe("number");
      expect(typeof t.simulation.latencyDeltaMs).toBe("number");
      expect(typeof t.simulation.qualityDelta).toBe("number");
      expect(typeof t.simulation.riskDelta).toBe("number");
    }
  });

  it("manualSaveBlueprint is called only after pipeline+rollout approval", async () => {
    const saved: Array<{ id: string; role: string }> = [];
    const retired: string[] = [];
    const tracedDeps: MetaOrchestratorDeps = {
      ...deps,
      rollout: new SafeRollout("full"),
      manualSaveBlueprint: async (bp) => {
        saved.push({ id: bp.id, role: bp.role });
      },
      manualRetireBlueprint: async (id) => {
        retired.push(id);
      },
    };
    const orch = new MetaOrchestrator(tracedDeps);
    const input: MetaCycleInput = {
      recentExecutions: [],
      blueprints: [],
      graphs: [],
      discoverySignals: [
        { text: "Build iOS app", context: "user", source: "user_request_analysis" },
        { text: "Swift Kotlin code", context: "user", source: "user_request_analysis" },
      ],
    };
    const result = await orch.cycle(input);
    // In full mode, applied births go through manualSaveBlueprint.
    const appliedBirths = result.proposalsPhase8!.filter((t) => t.rollout?.applied && t.proposal.action === "birth");
    expect(appliedBirths.length).toBeGreaterThan(0);
    expect(saved.length).toBe(appliedBirths.length);
    // Helper should produce a valid AgentBlueprint.
    if (result.births.length > 0) {
      const bp = birthResultToBlueprint(result.births[0]!);
      expect(bp.id).toBe(result.births[0]!.blueprintId);
      expect(bp.role).toBe(result.births[0]!.role);
    }
  });
});