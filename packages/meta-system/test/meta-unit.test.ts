/**
 * Phase 6 — Meta-System unit tests.
 *
 * Target: 50+ tests covering:
 *   6.1 CapabilityDiscoveryEngine
 *   6.2 CapabilityRegistry (lifecycle state machine)
 *   6.3 MetaAgent (create/delete/merge/split)
 *   6.4 TeamOptimizer
 *   6.5 AgentBirthEngine
 *   6.6 AgentRetirementEngine
 *   6.7 OrganizationMemory
 *   6.8 SimulationEngine
 *   6.9 GovernanceEngine
 *   6.X MetaOrchestrator
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import type { ExecutionRecord, StructuredReview } from "@max/autonomy";
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
  type DiscoverySignal,
  type MetaOrchestratorDeps,
  type MetaCycleInput,
} from "../src/index.js";

// ============================================================================
// Helpers
// ============================================================================

async function makeTmp(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "max-meta-"));
}

function makeReview(score: number = 7): StructuredReview {
  return {
    summary: "ok",
    strengths: ["good"],
    weaknesses: [],
    score,
    suggestions: [],
    at: new Date().toISOString(),
  };
}

function makeExecution(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: `exec-${Math.random().toString(36).slice(2, 8)}`,
    taskId: `t-${Math.random().toString(36).slice(2, 6)}`,
    workspaceId: "ws-1",
    agentRole: "frontend_agent",
    blueprintId: "bp-frontend-v1",
    artifacts: [],
    review: makeReview(7),
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
    stats: {
      totalTasks: 0,
      totalSuccesses: 0,
      avgScore: 0,
      avgExecutionTimeMs: 0,
    },
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
    nodes: [
      {
        id: "n-frontend",
        blueprintId: "bp-frontend-v1",
        role: "frontend",
        displayName: "Frontend",
        dependsOn: [],
      },
    ],
    edges: [],
    layers: [{ index: 0, nodeIds: ["n-frontend"] }],
    createdAt: now,
    status: "draft",
    ...overrides,
  };
}

// ============================================================================
// 6.1 CapabilityDiscoveryEngine
// ============================================================================

describe("6.1 CapabilityDiscoveryEngine", () => {
  let tmp: string;
  let engine: CapabilityDiscoveryEngine;

  beforeEach(async () => {
    tmp = await makeTmp();
    engine = new CapabilityDiscoveryEngine(tmp);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("discovers a new capability from mobile signals", async () => {
    const signals: DiscoverySignal[] = [
      { text: "Build an iOS app", context: "user request", source: "user_request_analysis" },
      { text: "Use Swift and Kotlin", context: "user request", source: "user_request_analysis" },
    ];
    const result = await engine.discover(signals);
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(result.proposals[0]!.capabilityId).toBe("mobile_app_development");
  });

  it("discovers blockchain capability", async () => {
    const signals: DiscoverySignal[] = [
      { text: "Write a smart contract", context: "user", source: "user_request_analysis" },
      { text: "Use solidity on Ethereum", context: "user", source: "user_request_analysis" },
    ];
    const result = await engine.discover(signals);
    const ids = result.proposals.map((p) => p.capabilityId);
    expect(ids).toContain("blockchain_development");
  });

  it("skips proposals for already-known capabilities", async () => {
    const signals: DiscoverySignal[] = [
      { text: "Build React frontend", context: "user", source: "user_request_analysis" },
      { text: "Write CSS and HTML", context: "user", source: "user_request_analysis" },
    ];
    const result = await engine.discover(signals, ["frontend"]);
    expect(result.proposals.length).toBe(0);
  });

  it("requires minimum frequency before proposing", async () => {
    const signals: DiscoverySignal[] = [
      { text: "Build an iOS app", context: "user", source: "user_request_analysis" },
    ];
    const result = await engine.discover(signals);
    expect(result.proposals.length).toBe(0);
  });

  it("persists proposals to disk", async () => {
    const signals: DiscoverySignal[] = [
      { text: "Make a game with Unity", context: "user", source: "user_request_analysis" },
      { text: "Use Unreal Engine", context: "user", source: "user_request_analysis" },
    ];
    await engine.discover(signals);
    const all = await engine.listProposals();
    expect(all.length).toBeGreaterThan(0);
  });

  it("captures evidence samples", async () => {
    const signals: DiscoverySignal[] = [
      { text: "Build iOS app", context: "c1", source: "user_request_analysis" },
      { text: "iOS Swift code", context: "c2", source: "user_request_analysis" },
    ];
    const result = await engine.discover(signals);
    expect(result.proposals[0]!.evidence.length).toBeGreaterThan(0);
  });

  it("ranks capability_gap source higher than user_request_analysis", async () => {
    const signals: DiscoverySignal[] = [
      { text: "Build a game", context: "c", source: "user_request_analysis" },
      { text: "Build a game", context: "c", source: "capability_gap" },
    ];
    const result = await engine.discover(signals);
    expect(result.proposals[0]!.source).toBe("capability_gap");
  });

  it("ignores keywords that map to known capabilities", async () => {
    const signals: DiscoverySignal[] = [
      { text: "Write a paper about ML", context: "user", source: "user_request_analysis" },
      { text: "Analyze arxiv dataset", context: "user", source: "user_request_analysis" },
    ];
    const result = await engine.discover(signals);
    expect(result.proposals.length).toBe(0);
  });
});

// ============================================================================
// 6.2 CapabilityRegistry
// ============================================================================

describe("6.2 CapabilityRegistry", () => {
  let tmp: string;
  let registry: CapabilityRegistry;

  beforeEach(async () => {
    tmp = await makeTmp();
    registry = new CapabilityRegistry(tmp);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("creates a proposed capability", async () => {
    const rec = await registry.propose({
      capabilityId: "mobile_app_development",
      displayName: "Mobile App Dev",
      description: "build iOS/Android apps",
    });
    expect(rec.status).toBe("proposed");
    expect(rec.id).toBe("mobile_app_development");
  });

  it("transitions proposed → experimental", async () => {
    await registry.propose({ capabilityId: "test_cap", displayName: "Test" });
    const rec = await registry.transition("test_cap", "experimental");
    expect(rec.status).toBe("experimental");
  });

  it("transitions experimental → active", async () => {
    await registry.propose({ capabilityId: "test_cap", displayName: "Test" });
    await registry.transition("test_cap", "experimental");
    const rec = await registry.transition("test_cap", "active");
    expect(rec.status).toBe("active");
    expect(rec.promotedAt).toBeDefined();
  });

  it("rejects illegal transitions", async () => {
    await registry.propose({ capabilityId: "test_cap", displayName: "Test" });
    await expect(registry.transition("test_cap", "deprecated")).rejects.toThrow();
  });

  it("allows active → deprecated", async () => {
    await registry.propose({ capabilityId: "test_cap", displayName: "Test" });
    await registry.transition("test_cap", "experimental");
    await registry.transition("test_cap", "active");
    const rec = await registry.transition("test_cap", "deprecated");
    expect(rec.status).toBe("deprecated");
  });

  it("allows deprecated → active (revival)", async () => {
    await registry.propose({ capabilityId: "test_cap", displayName: "Test" });
    await registry.transition("test_cap", "experimental");
    await registry.transition("test_cap", "active");
    await registry.transition("test_cap", "deprecated");
    const rec = await registry.transition("test_cap", "active");
    expect(rec.status).toBe("active");
  });

  it("records retirement timestamp when retiring", async () => {
    await registry.propose({ capabilityId: "test_cap", displayName: "Test" });
    const rec = await registry.transition("test_cap", "retired");
    expect(rec.retiredAt).toBeDefined();
  });

  it("rejects duplicate propose", async () => {
    await registry.propose({ capabilityId: "test_cap", displayName: "Test" });
    await expect(registry.propose({ capabilityId: "test_cap", displayName: "Test" })).rejects.toThrow();
  });

  it("lists by status", async () => {
    await registry.propose({ capabilityId: "a", displayName: "A" });
    await registry.propose({ capabilityId: "b", displayName: "B" });
    const proposed = await registry.listByStatus("proposed");
    expect(proposed.length).toBe(2);
  });

  it("Phase 7 — recordUsage removed (was unused); stats are read-only from executionStore", async () => {
    await registry.propose({ capabilityId: "test_cap", displayName: "Test" });
    const rec = await registry.get("test_cap");
    expect(rec!.usageCount).toBe(0);
    expect(rec!.avgScore).toBe(0);
    expect((registry as unknown as { recordUsage?: unknown }).recordUsage).toBeUndefined();
  });
});

// ============================================================================
// 6.3 MetaAgent
// ============================================================================

describe("6.3 MetaAgent", () => {
  it("emits create for proposals with enough evidence", () => {
    const agent = new MetaAgent({ minProposalEvidence: 3 });
    const plan = agent.decide({
      capabilities: [],
      retirements: [],
      proposals: [{ capabilityId: "mobile", evidenceCount: 5 }],
      executionStats: {},
    });
    expect(plan.decisions.some((d) => d.action === "create")).toBe(true);
  });

  it("skips create if evidence is insufficient", () => {
    const agent = new MetaAgent({ minProposalEvidence: 3 });
    const plan = agent.decide({
      capabilities: [],
      retirements: [],
      proposals: [{ capabilityId: "mobile", evidenceCount: 1 }],
      executionStats: {},
    });
    expect(plan.decisions.some((d) => d.action === "create")).toBe(false);
  });

  it("emits delete for each retirement decision", () => {
    const agent = new MetaAgent();
    const plan = agent.decide({
      capabilities: [],
      retirements: [
        {
          blueprintId: "bp-bad",
          role: "bad_agent",
          reason: "low_usage",
          metrics: { usageCount: 0, avgScore: 0, sampleSize: 0 },
          decidedAt: new Date().toISOString(),
        },
      ],
      proposals: [],
      executionStats: {},
    });
    expect(plan.decisions.some((d) => d.action === "delete" && d.agentRole === "bad_agent")).toBe(true);
  });

  it("emits merge when two roles have low score", () => {
    const agent = new MetaAgent({ mergeScoreThreshold: 5.0 });
    const plan = agent.decide({
      capabilities: [],
      retirements: [],
      proposals: [],
      executionStats: {
        a_agent: { avgScore: 3, avgDurationMs: 1000, usageCount: 10, failureRate: 0.5 },
        b_agent: { avgScore: 4, avgDurationMs: 1000, usageCount: 10, failureRate: 0.4 },
      },
    });
    expect(plan.decisions.some((d) => d.action === "merge")).toBe(true);
  });

  it("emits split for high-latency role", () => {
    const agent = new MetaAgent({ splitLatencyMs: 60000 });
    const plan = agent.decide({
      capabilities: [],
      retirements: [],
      proposals: [],
      executionStats: {
        slow_agent: { avgScore: 8, avgDurationMs: 90000, usageCount: 10, failureRate: 0.1 },
      },
    });
    expect(plan.decisions.some((d) => d.action === "split")).toBe(true);
  });

  it("returns empty plan when system is healthy", () => {
    const agent = new MetaAgent();
    const plan = agent.decide({
      capabilities: [],
      retirements: [],
      proposals: [],
      executionStats: {
        good_agent: { avgScore: 9, avgDurationMs: 1000, usageCount: 10, failureRate: 0.0 },
      },
    });
    expect(plan.decisions.length).toBe(0);
  });

  it("computes expected impact correctly", () => {
    const agent = new MetaAgent();
    const plan = agent.decide({
      capabilities: [],
      retirements: [],
      proposals: [{ capabilityId: "x", evidenceCount: 5 }],
      executionStats: {},
    });
    expect(plan.expectedImpact.costDelta).toBeGreaterThan(0);
  });

  it("produces deterministic plan id format", () => {
    const agent = new MetaAgent();
    const plan = agent.decide({
      capabilities: [],
      retirements: [],
      proposals: [],
      executionStats: {},
    });
    expect(plan.id).toMatch(/^change-/);
  });
});

// ============================================================================
// 6.4 TeamOptimizer
// ============================================================================

describe("6.4 TeamOptimizer", () => {
  let optimizer: TeamOptimizer;

  beforeEach(() => {
    optimizer = new TeamOptimizer();
  });

  it("suggests add_review_node when no review in graph", async () => {
    const hint = await optimizer.suggest({
      graph: makeTeamGraph({
        nodes: [
          { id: "n1", blueprintId: "b1", role: "frontend", displayName: "Frontend", dependsOn: [] },
        ],
      }),
      executions: [],
    });
    expect(hint.suggestions.some((s) => s.type === "add_review_node")).toBe(true);
  });

  it("does not suggest add_review_node if review exists", async () => {
    const hint = await optimizer.suggest({
      graph: makeTeamGraph({
        nodes: [
          { id: "n1", blueprintId: "b1", role: "frontend", displayName: "Frontend", dependsOn: [] },
          { id: "n2", blueprintId: "b2", role: "review", displayName: "Review", dependsOn: ["n1"] },
        ],
      }),
      executions: [],
    });
    expect(hint.suggestions.some((s) => s.type === "add_review_node")).toBe(false);
  });

  it("suggests parallelize for high avg latency", async () => {
    const executions = Array.from({ length: 5 }, () =>
      makeExecution({ durationMs: 40000, review: makeReview(7) })
    );
    const hint = await optimizer.suggest({
      graph: makeTeamGraph(),
      executions,
    });
    expect(hint.suggestions.some((s) => s.type === "parallelize")).toBe(true);
  });

  it("suggests grow_team for low avg quality", async () => {
    const executions = Array.from({ length: 5 }, () =>
      makeExecution({ review: makeReview(4) })
    );
    const hint = await optimizer.suggest({
      graph: makeTeamGraph(),
      executions,
    });
    expect(hint.suggestions.some((s) => s.type === "grow_team")).toBe(true);
  });

  it("returns hint with id and timestamp", async () => {
    const hint = await optimizer.suggest({
      graph: makeTeamGraph(),
      executions: [],
    });
    expect(hint.id).toMatch(/^hint-/);
    expect(hint.createdAt).toBeDefined();
  });

  it("estimates metrics from graph and executions", async () => {
    const executions = Array.from({ length: 3 }, () =>
      makeExecution({ durationMs: 2000, review: makeReview(8) })
    );
    const hint = await optimizer.suggest({
      graph: makeTeamGraph(),
      executions,
    });
    expect(hint.estimatedLatencyMs).toBe(2000);
    expect(hint.estimatedQuality).toBe(8);
  });
});

// ============================================================================
// 6.5 AgentBirthEngine
// ============================================================================

describe("6.5 AgentBirthEngine", () => {
  let tmp: string;
  let engine: AgentBirthEngine;

  beforeEach(async () => {
    tmp = await makeTmp();
    engine = new AgentBirthEngine({ rootDir: tmp });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("births an agent from a capability proposal", async () => {
    const result = await engine.birth({
      id: "prop-1",
      capabilityId: "mobile_app_development",
      displayName: "Mobile App Dev",
      rationale: "test",
      source: "user_request_analysis",
      evidence: ["iOS app"],
      proposedAt: new Date().toISOString(),
    });
    expect(result.role).toBe("mobile_app_development_agent");
    expect(result.parentCapability).toBe("mobile_app_development");
  });

  it("derives blueprint id from capability", async () => {
    const result = await engine.birth({
      id: "prop-1",
      capabilityId: "blockchain_development",
      displayName: "Blockchain",
      rationale: "test",
      source: "user_request_analysis",
      evidence: ["solidity"],
      proposedAt: new Date().toISOString(),
    });
    expect(result.blueprintId).toMatch(/^bp-blockchain_development_agent-v1-/);
  });

  it("writes audit file", async () => {
    const result = await engine.birth({
      id: "prop-1",
      capabilityId: "x",
      displayName: "X",
      rationale: "test",
      source: "user_request_analysis",
      evidence: [],
      proposedAt: new Date().toISOString(),
    });
    const auditPath = path.join(tmp, "agent-births", `${result.blueprintId}.json`);
    const exists = await fs.stat(auditPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("invokes saveBlueprint callback when provided", async () => {
    let saved: unknown = null;
    const cbEngine = new AgentBirthEngine({
      rootDir: tmp,
      saveBlueprint: async (bp) => {
        saved = bp;
      },
    });
    await cbEngine.birth({
      id: "prop-1",
      capabilityId: "y",
      displayName: "Y",
      rationale: "test",
      source: "user_request_analysis",
      evidence: [],
      proposedAt: new Date().toISOString(),
    });
    expect(saved).not.toBeNull();
  });

  it("composes a system prompt", async () => {
    const result = await engine.birth({
      id: "prop-1",
      capabilityId: "z",
      displayName: "Z Agent",
      rationale: "test",
      source: "user_request_analysis",
      evidence: [],
      proposedAt: new Date().toISOString(),
    });
    expect(result.systemPrompt).toContain("Z Agent");
  });
});

// ============================================================================
// 6.6 AgentRetirementEngine
// ============================================================================

describe("6.6 AgentRetirementEngine", () => {
  it("retires a blueprint with zero usage", async () => {
    const engine = new AgentRetirementEngine();
    const d = await engine.evaluate("bp-orphan", "orphan_agent", []);
    expect(d).toBeDefined();
    expect(d!.reason).toBe("low_usage");
    expect(d!.metrics.usageCount).toBe(0);
  });

  it("retires a blueprint with low score", async () => {
    const engine = new AgentRetirementEngine({ minScoreToKeep: 4.0 });
    const executions = Array.from({ length: 5 }, () =>
      makeExecution({ blueprintId: "bp-bad", review: makeReview(2) })
    );
    const d = await engine.evaluate("bp-bad", "bad_agent", executions);
    expect(d).toBeDefined();
    expect(d!.reason).toBe("low_score");
  });

  it("keeps a healthy blueprint", async () => {
    const engine = new AgentRetirementEngine();
    const executions = Array.from({ length: 10 }, () =>
      makeExecution({ blueprintId: "bp-good", review: makeReview(8) })
    );
    const d = await engine.evaluate("bp-good", "good_agent", executions);
    expect(d).toBeUndefined();
  });

  it("retires blueprint with low usage", async () => {
    const engine = new AgentRetirementEngine({ minUsageToKeep: 5 });
    const executions = Array.from({ length: 2 }, () =>
      makeExecution({ blueprintId: "bp-rare", review: makeReview(9) })
    );
    const d = await engine.evaluate("bp-rare", "rare_agent", executions);
    expect(d).toBeDefined();
    expect(d!.reason).toBe("low_usage");
  });

  it("evaluateAll batches decisions", async () => {
    const engine = new AgentRetirementEngine();
    const executions = [
      makeExecution({ blueprintId: "bp-a", review: makeReview(2) }),
      makeExecution({ blueprintId: "bp-b", review: makeReview(8) }),
    ];
    const decisions = await engine.evaluateAll(["bp-a", "bp-b"], executions);
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions.find((d) => d.blueprintId === "bp-a")).toBeDefined();
  });

  it("calls retireBlueprint side-effect", async () => {
    const retired: string[] = [];
    const engine = new AgentRetirementEngine({
      retireBlueprint: async (id) => {
        retired.push(id);
      },
    });
    await engine.evaluateAll(["bp-orphan"], []);
    expect(retired).toContain("bp-orphan");
  });
});

// ============================================================================
// 6.7 OrganizationMemory
// ============================================================================

describe("6.7 OrganizationMemory", () => {
  let tmp: string;
  let memory: OrganizationMemory;

  beforeEach(async () => {
    tmp = await makeTmp();
    memory = new OrganizationMemory(tmp);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("records a capability_proposed event", async () => {
    const e = await memory.record("capability_proposed", "mobile", { reason: "test" });
    expect(e.type).toBe("capability_proposed");
    expect(e.subject).toBe("mobile");
    expect(e.id).toMatch(/^evt-/);
  });

  it("lists all events", async () => {
    await memory.record("capability_proposed", "a", {});
    await memory.record("agent_born", "b", {});
    const all = await memory.listAll();
    expect(all.length).toBe(2);
  });

  it("filters timeline by subject", async () => {
    await memory.record("capability_proposed", "a", {});
    await memory.record("agent_born", "b", {});
    await memory.record("capability_promoted", "a", {});
    const timeline = await memory.timeline("a");
    expect(timeline.length).toBe(2);
  });

  it("counts events by type", async () => {
    await memory.record("capability_proposed", "a", {});
    await memory.record("capability_proposed", "b", {});
    await memory.record("agent_born", "c", {});
    const counts = await memory.countByType();
    expect(counts.capability_proposed).toBe(2);
    expect(counts.agent_born).toBe(1);
  });

  it("returns empty list when no events", async () => {
    const all = await memory.listAll();
    expect(all).toEqual([]);
  });

  it("sorts events chronologically", async () => {
    await memory.record("capability_proposed", "first", {});
    await new Promise((r) => setTimeout(r, 5));
    await memory.record("agent_born", "second", {});
    const all = await memory.listAll();
    expect(all[0]!.subject).toBe("first");
    expect(all[1]!.subject).toBe("second");
  });
});

// ============================================================================
// 6.8 SimulationEngine
// ============================================================================

describe("6.8 SimulationEngine", () => {
  let engine: SimulationEngine;

  beforeEach(() => {
    engine = new SimulationEngine();
  });

  it("simulates a team with all profiles", async () => {
    const result = await engine.simulate({
      orgName: "OrgA",
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
    });
    expect(result.totalEstimatedCost).toBe(2.5);
    expect(result.teamSize).toBe(2);
  });

  it("computes serial latency multiplier", async () => {
    const result = await engine.simulate({
      orgName: "OrgA",
      graph: makeTeamGraph({
        nodes: [
          { id: "n1", blueprintId: "b1", role: "frontend", displayName: "FE", dependsOn: [] },
          { id: "n2", blueprintId: "b2", role: "backend", displayName: "BE", dependsOn: ["n1"] },
        ],
      }),
      profiles: {
        frontend: { costPerCall: 1, latencyMs: 1000, qualityScore: 8 },
        backend: { costPerCall: 1, latencyMs: 1000, qualityScore: 8 },
      },
      serialDepth: 3,
    });
    // 1 + (3-1)*0.3 = 1.6
    expect(result.totalEstimatedLatencyMs).toBe(3200);
  });

  it("marks risk when profiles missing", async () => {
    const result = await engine.simulate({
      orgName: "OrgA",
      graph: makeTeamGraph({
        nodes: [
          { id: "n1", blueprintId: "b1", role: "unknown_role", displayName: "U", dependsOn: [] },
        ],
      }),
      profiles: {},
    });
    expect(result.riskScore).toBeGreaterThan(0);
  });

  it("compares two orgs and picks better", async () => {
    const a = {
      orgName: "A",
      graph: makeTeamGraph({
        nodes: [
          { id: "n1", blueprintId: "b1", role: "frontend", displayName: "FE", dependsOn: [] },
        ],
      }),
      profiles: { frontend: { costPerCall: 1, latencyMs: 1000, qualityScore: 9 } },
    };
    const b = {
      orgName: "B",
      graph: makeTeamGraph({
        nodes: [
          { id: "n1", blueprintId: "b1", role: "frontend", displayName: "FE", dependsOn: [] },
        ],
      }),
      profiles: { frontend: { costPerCall: 5, latencyMs: 1000, qualityScore: 7 } },
    };
    const cmp = await engine.compare(a, b);
    expect(cmp.recommendation).toBe("A");
  });

  it("returns tie when scores are close", async () => {
    const a = {
      orgName: "A",
      graph: makeTeamGraph({
        nodes: [
          { id: "n1", blueprintId: "b1", role: "frontend", displayName: "FE", dependsOn: [] },
        ],
      }),
      profiles: { frontend: { costPerCall: 1, latencyMs: 1000, qualityScore: 8 } },
    };
    const b = {
      orgName: "B",
      graph: makeTeamGraph({
        nodes: [
          { id: "n1", blueprintId: "b1", role: "frontend", displayName: "FE", dependsOn: [] },
        ],
      }),
      profiles: { frontend: { costPerCall: 1, latencyMs: 1000, qualityScore: 8.04 } },
    };
    const cmp = await engine.compare(a, b);
    expect(cmp.recommendation).toBe("tie");
  });

  it("handles empty org", async () => {
    const result = await engine.simulate({
      orgName: "Empty",
      graph: makeTeamGraph({ nodes: [] }),
      profiles: {},
    });
    expect(result.teamSize).toBe(0);
    expect(result.riskScore).toBe(1);
  });
});

// ============================================================================
// 6.9 GovernanceEngine
// ============================================================================

describe("6.9 GovernanceEngine", () => {
  let tmp: string;
  let engine: GovernanceEngine;

  beforeEach(async () => {
    tmp = await makeTmp();
    engine = new GovernanceEngine(tmp);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("allows when under limits", () => {
    const v = engine.check({
      graphs: [],
      capabilities: [],
      blueprints: [makeBlueprint()],
    });
    expect(v.allowed).toBe(true);
  });

  it("blocks when maxAgents reached", () => {
    const cfg = { ...DEFAULT_GOVERNANCE_CONFIG, maxAgents: 1 };
    const limitedEngine = new GovernanceEngine(tmp, cfg);
    const v = limitedEngine.check({
      graphs: [],
      capabilities: [],
      blueprints: [makeBlueprint(), makeBlueprint()],
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("maxAgents");
  });

  it("blocks when maxCapabilities reached", () => {
    const cfg = { ...DEFAULT_GOVERNANCE_CONFIG, maxCapabilities: 1 };
    const limitedEngine = new GovernanceEngine(tmp, cfg);
    const v = limitedEngine.check({
      graphs: [],
      capabilities: [
        { id: "a", displayName: "A", status: "active", createdAt: "", updatedAt: "" },
        { id: "b", displayName: "B", status: "active", createdAt: "", updatedAt: "" },
      ],
      blueprints: [],
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("maxCapabilities");
  });

  it("blocks when graph depth exceeds maxDepth", () => {
    const cfg = { ...DEFAULT_GOVERNANCE_CONFIG, maxDepth: 2 };
    const limitedEngine = new GovernanceEngine(tmp, cfg);
    const v = limitedEngine.check({
      graphs: [
        makeTeamGraph({
          nodes: [
            { id: "n1", blueprintId: "b1", role: "a", displayName: "A", dependsOn: [] },
            { id: "n2", blueprintId: "b2", role: "b", displayName: "B", dependsOn: ["n1"] },
            { id: "n3", blueprintId: "b3", role: "c", displayName: "C", dependsOn: ["n2"] },
            { id: "n4", blueprintId: "b4", role: "d", displayName: "D", dependsOn: ["n3"] },
          ],
        }),
      ],
      capabilities: [],
      blueprints: [],
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("maxDepth");
  });

  it("ignores retired blueprints in agent count", () => {
    const cfg = { ...DEFAULT_GOVERNANCE_CONFIG, maxAgents: 1 };
    const limitedEngine = new GovernanceEngine(tmp, cfg);
    const v = limitedEngine.check({
      graphs: [],
      capabilities: [],
      blueprints: [
        makeBlueprint({ retiredAt: new Date().toISOString() }),
        makeBlueprint(),
      ],
    });
    expect(v.allowed).toBe(true);
  });

  it("ignores retired capabilities in count", () => {
    const cfg = { ...DEFAULT_GOVERNANCE_CONFIG, maxCapabilities: 1 };
    const limitedEngine = new GovernanceEngine(tmp, cfg);
    const v = limitedEngine.check({
      graphs: [],
      capabilities: [
        { id: "a", displayName: "A", status: "retired", createdAt: "", updatedAt: "" },
        { id: "b", displayName: "B", status: "active", createdAt: "", updatedAt: "" },
      ],
      blueprints: [],
    });
    expect(v.allowed).toBe(true);
  });

  it("saves and loads governance config", async () => {
    const newCfg = { ...DEFAULT_GOVERNANCE_CONFIG, maxAgents: 99 };
    await engine.saveConfig(newCfg);
    const loaded = await engine.loadConfig();
    expect(loaded.maxAgents).toBe(99);
  });
});

// ============================================================================
// 6.X MetaOrchestrator
// ============================================================================

describe("6.X MetaOrchestrator", () => {
  let tmp: string;
  let deps: MetaOrchestratorDeps;
  let orchestrator: MetaOrchestrator;

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
    deps = { registry, discovery, birth, retirement, metaAgent, teamOptimizer, orgMemory, governance };
    orchestrator = new MetaOrchestrator(deps);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("runs a full cycle with no signals", async () => {
    const input: MetaCycleInput = {
      recentExecutions: [],
      blueprints: [makeBlueprint()],
      graphs: [makeTeamGraph()],
      discoverySignals: [],
    };
    const result = await orchestrator.cycle(input);
    expect(result.proposals.length).toBe(0);
    expect(result.governance.allowed).toBe(true);
  });

  it("discovers and proposes a new capability", async () => {
    const input: MetaCycleInput = {
      recentExecutions: [],
      blueprints: [],
      graphs: [],
      discoverySignals: [
        { text: "Build iOS app", context: "user", source: "user_request_analysis" },
        { text: "Write Swift code", context: "user", source: "user_request_analysis" },
      ],
    };
    const result = await orchestrator.cycle(input);
    expect(result.proposals.length).toBeGreaterThan(0);
  });

  it("activates capabilities and births agents", async () => {
    const input: MetaCycleInput = {
      recentExecutions: [],
      blueprints: [],
      graphs: [],
      discoverySignals: [
        { text: "Build iOS app", context: "user", source: "user_request_analysis" },
        { text: "Android Kotlin code", context: "user", source: "user_request_analysis" },
      ],
    };
    const result = await orchestrator.cycle(input);
    expect(result.activated.length).toBeGreaterThan(0);
    expect(result.births.length).toBeGreaterThan(0);
  });

  it("evaluates retirements", async () => {
    const input: MetaCycleInput = {
      recentExecutions: [],
      blueprints: [makeBlueprint({ id: "bp-orphan" })],
      graphs: [],
      discoverySignals: [],
    };
    const result = await orchestrator.cycle(input);
    expect(result.retirements.length).toBeGreaterThan(0);
    expect(result.retirements[0]!.blueprintId).toBe("bp-orphan");
  });

  it("runs team optimizer", async () => {
    const input: MetaCycleInput = {
      recentExecutions: [],
      blueprints: [],
      graphs: [makeTeamGraph()],
      discoverySignals: [],
    };
    const result = await orchestrator.cycle(input);
    expect(result.teamHint.id).toMatch(/^hint-/);
  });

  it("records org events", async () => {
    const input: MetaCycleInput = {
      recentExecutions: [],
      blueprints: [],
      graphs: [],
      discoverySignals: [],
    };
    const result = await orchestrator.cycle(input);
    expect(result.recorded).toBeGreaterThan(0);
  });

  it("blocks when governance denies", async () => {
    const strictGovernance = new GovernanceEngine(tmp, {
      ...DEFAULT_GOVERNANCE_CONFIG,
      maxAgents: 0,
    });
    const strictOrchestrator = new MetaOrchestrator({
      ...deps,
      governance: strictGovernance,
    });
    const input: MetaCycleInput = {
      recentExecutions: [],
      blueprints: [makeBlueprint()],
      graphs: [],
      discoverySignals: [],
    };
    const result = await strictOrchestrator.cycle(input);
    expect(result.governance.allowed).toBe(false);
  });

  it("emits governance_violation event when blocked", async () => {
    const strictGovernance = new GovernanceEngine(tmp, {
      ...DEFAULT_GOVERNANCE_CONFIG,
      maxAgents: 0,
    });
    const strictOrchestrator = new MetaOrchestrator({
      ...deps,
      governance: strictGovernance,
    });
    await strictOrchestrator.cycle({
      recentExecutions: [],
      blueprints: [makeBlueprint()],
      graphs: [],
      discoverySignals: [],
    });
    const events = await deps.orgMemory.listAll();
    expect(events.some((e) => e.type === "governance_violation")).toBe(true);
  });

  // ----- Phase 7 — Governance 真阻断 -----

  it("hard-blocks births when maxAgents reached", async () => {
    const strict = new GovernanceEngine(tmp, {
      ...DEFAULT_GOVERNANCE_CONFIG,
      maxAgents: 1,
    });
    const strictOrchestrator = new MetaOrchestrator({
      ...deps,
      governance: strict,
    });
    // Pre-fill with one active blueprint so birthBudget=1 == maxAgents.
    const existingBlueprint = makeBlueprint({ id: "bp-existing" });
    const result = await strictOrchestrator.cycle({
      recentExecutions: [],
      blueprints: [existingBlueprint],
      graphs: [],
      discoverySignals: [
        { text: "Build iOS app", context: "user", source: "user_request_analysis" },
        { text: "Write Swift code", context: "user", source: "user_request_analysis" },
      ],
    });
    expect(result.blockedBy.some((r) => r.includes("maxAgents"))).toBe(true);
    expect(result.births.length).toBe(0);
  });

  it("hard-blocks promotions when maxCapabilities reached", async () => {
    const strict = new GovernanceEngine(tmp, {
      ...DEFAULT_GOVERNANCE_CONFIG,
      maxCapabilities: 1,
    });
    const strictRegistry = new CapabilityRegistry(tmp);
    // Seed with one active capability at the limit.
    await strictRegistry.propose({
      capabilityId: "seed_cap",
      displayName: "Seed",
    });
    await strictRegistry.transition("seed_cap", "experimental");
    await strictRegistry.transition("seed_cap", "active");
    const strictOrchestrator = new MetaOrchestrator({
      ...deps,
      registry: strictRegistry,
      governance: strict,
    });
    const result = await strictOrchestrator.cycle({
      recentExecutions: [],
      blueprints: [],
      graphs: [],
      discoverySignals: [
        { text: "Build Android Kotlin app", context: "user", source: "user_request_analysis" },
        { text: "Write Kotlin mobile code", context: "user", source: "user_request_analysis" },
      ],
    });
    expect(result.blockedBy.some((r) => r.includes("maxCapabilities"))).toBe(true);
    // No new active capabilities should have been added.
    const activeAfter = await strictRegistry.listByStatus("active");
    expect(activeAfter.length).toBe(1);
  });

  it("reports blockedBy list even when one mutation succeeds", async () => {
    // maxAgents=2: should allow 2 births, block the 3rd.
    const limited = new GovernanceEngine(tmp, {
      ...DEFAULT_GOVERNANCE_CONFIG,
      maxAgents: 2,
    });
    const limitedOrchestrator = new MetaOrchestrator({
      ...deps,
      governance: limited,
    });
    const signals = [
      { text: "iOS Swift app", context: "u", source: "user_request_analysis" as const },
      { text: "Android Kotlin", context: "u", source: "user_request_analysis" as const },
      { text: "GraphQL API", context: "u", source: "user_request_analysis" as const },
    ];
    const result = await limitedOrchestrator.cycle({
      recentExecutions: [],
      blueprints: [],
      graphs: [],
      discoverySignals: signals,
    });
    expect(result.births.length).toBeLessThanOrEqual(2);
    if (result.births.length < result.activated.length) {
      expect(result.blockedBy.length).toBeGreaterThan(0);
    }
  });
});