/**
 * Phase 6 — Meta-System integration tests.
 *
 * Verifies the closed loop across packages:
 *   discovery → registry → birth → retirement → meta-agent → memory → governance
 * Run with: pnpm --filter @max/api test
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
  type MetaOrchestratorDeps,
  type MetaCycleInput,
  type DiscoverySignal,
} from "@max/meta-system";

function makeReview(score: number): StructuredReview {
  return {
    summary: "ok",
    strengths: [],
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
    workspaceId: "ws-int",
    agentRole: "frontend_agent",
    blueprintId: "bp-frontend-v1",
    artifacts: [],
    review: makeReview(7),
    userFeedback: [],
    startedAt: new Date().toISOString(),
    durationMs: 1500,
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
    goal: "Frontend code",
    systemPrompt: "Frontend prompt",
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
    userRequest: "Build app",
    capabilities: ["frontend"],
    nodes: [
      { id: "n1", blueprintId: "bp-1", role: "frontend", displayName: "FE", dependsOn: [] },
    ],
    edges: [],
    layers: [{ index: 0, nodeIds: ["n1"] }],
    createdAt: now,
    status: "draft",
    ...overrides,
  };
}

async function makeTmp(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "max-meta-int-"));
}

function makeHarness(tmp: string): { deps: MetaOrchestratorDeps; orchestrator: MetaOrchestrator } {
  const registry = new CapabilityRegistry(tmp);
  const discovery = new CapabilityDiscoveryEngine(tmp);
  const birth = new AgentBirthEngine({ rootDir: tmp });
  const retirement = new AgentRetirementEngine();
  const metaAgent = new MetaAgent();
  const teamOptimizer = new TeamOptimizer();
  const orgMemory = new OrganizationMemory(tmp);
  const governance = new GovernanceEngine(tmp);
  const deps: MetaOrchestratorDeps = {
    registry, discovery, birth, retirement, metaAgent, teamOptimizer, orgMemory, governance,
  };
  const orchestrator = new MetaOrchestrator(deps);
  return { deps, orchestrator };
}

describe("Phase 6 Meta-System integration", () => {
  let tmp: string;
  let orchestrator: MetaOrchestrator;
  let deps: MetaOrchestratorDeps;

  beforeEach(async () => {
    tmp = await makeTmp();
    ({ deps, orchestrator } = makeHarness(tmp));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("discovers → proposes → activates → births → records → memory", async () => {
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
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(result.activated.length).toBeGreaterThan(0);
    expect(result.births.length).toBeGreaterThan(0);

    // Verify organization memory recorded each step.
    const events = await deps.orgMemory.listAll();
    const types = new Set(events.map((e) => e.type));
    expect(types.has("capability_proposed")).toBe(true);
    expect(types.has("capability_promoted")).toBe(true);
    expect(types.has("agent_born")).toBe(true);
    expect(types.has("team_optimized")).toBe(true);
  });

  it("retires an orphan blueprint and records the event", async () => {
    const input: MetaCycleInput = {
      recentExecutions: [],
      blueprints: [makeBlueprint({ id: "bp-orphan", role: "orphan_agent" })],
      graphs: [],
      discoverySignals: [],
    };
    const result = await orchestrator.cycle(input);
    expect(result.retirements.length).toBeGreaterThan(0);
    expect(result.retirements[0]!.blueprintId).toBe("bp-orphan");

    const events = await deps.orgMemory.listAll();
    expect(events.some((e) => e.type === "agent_retired")).toBe(true);
  });

  it("MetaAgent emits create/delete/merge/split across a rich cycle", async () => {
    const blueprints = [
      makeBlueprint({ id: "bp-a", role: "low_a" }),
      makeBlueprint({ id: "bp-b", role: "low_b" }),
      makeBlueprint({ id: "bp-slow", role: "slow_agent" }),
    ];
    const executions: ExecutionRecord[] = [
      ...Array.from({ length: 6 }, () =>
        makeExecution({ agentRole: "low_a", blueprintId: "bp-a", review: makeReview(3), durationMs: 1500 })
      ),
      ...Array.from({ length: 6 }, () =>
        makeExecution({ agentRole: "low_b", blueprintId: "bp-b", review: makeReview(3.5), durationMs: 1500 })
      ),
      ...Array.from({ length: 6 }, () =>
        makeExecution({ agentRole: "slow_agent", blueprintId: "bp-slow", review: makeReview(8), durationMs: 90000 })
      ),
    ];
    const input: MetaCycleInput = {
      recentExecutions: executions,
      blueprints,
      graphs: [makeTeamGraph()],
      discoverySignals: [
        { text: "Build Android app", context: "user", source: "user_request_analysis" },
        { text: "iOS Swift code", context: "user", source: "user_request_analysis" },
        { text: "Flutter cross-platform", context: "user", source: "user_request_analysis" },
      ],
    };
    const result = await orchestrator.cycle(input);
    const actions = new Set(result.changePlan.decisions.map((d) => d.action));
    expect(actions.has("delete")).toBe(true); // from retirement
    expect(actions.has("merge")).toBe(true); // from low-score pair
    expect(actions.has("split")).toBe(true); // from high-latency role
    expect(actions.has("create")).toBe(true); // from proposals
  });

  it("governance blocks when agent limit exceeded", async () => {
    const strict = new GovernanceEngine(tmp, { ...DEFAULT_GOVERNANCE_CONFIG, maxAgents: 0 });
    const strictOrchestrator = new MetaOrchestrator({
      ...deps,
      governance: strict,
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

  it("simulation predicts cost/latency/quality/risk for an org", async () => {
    const sim = new SimulationEngine();
    const graph = makeTeamGraph({
      nodes: [
        { id: "n1", blueprintId: "b1", role: "frontend", displayName: "FE", dependsOn: [] },
        { id: "n2", blueprintId: "b2", role: "backend", displayName: "BE", dependsOn: ["n1"] },
      ],
    });
    const r = await sim.simulate({
      orgName: "OrgA",
      graph,
      profiles: {
        frontend: { costPerCall: 1, latencyMs: 1000, qualityScore: 8 },
        backend: { costPerCall: 2, latencyMs: 2000, qualityScore: 7 },
      },
    });
    expect(r.totalEstimatedCost).toBe(3);
    expect(r.teamSize).toBe(2);
    expect(r.estimatedAvgQuality).toBeGreaterThan(7);

    const cmp = await sim.compare(
      { orgName: "A", graph, profiles: { frontend: { costPerCall: 1, latencyMs: 1000, qualityScore: 9 }, backend: { costPerCall: 1, latencyMs: 1000, qualityScore: 9 } } },
      { orgName: "B", graph, profiles: { frontend: { costPerCall: 5, latencyMs: 5000, qualityScore: 6 }, backend: { costPerCall: 5, latencyMs: 5000, qualityScore: 6 } } },
    );
    expect(cmp.recommendation).toBe("A");
  });

  it("team optimizer identifies missing review node", async () => {
    const input: MetaCycleInput = {
      recentExecutions: [],
      blueprints: [],
      graphs: [makeTeamGraph({
        nodes: [
          { id: "n1", blueprintId: "b1", role: "frontend", displayName: "FE", dependsOn: [] },
        ],
      })],
      discoverySignals: [],
    };
    const result = await orchestrator.cycle(input);
    expect(result.teamHint.suggestions.some((s) => s.type === "add_review_node")).toBe(true);
  });

  it("organization memory timeline is queryable by subject", async () => {
    const input: MetaCycleInput = {
      recentExecutions: [],
      blueprints: [],
      graphs: [],
      discoverySignals: [
        { text: "Build iOS app", context: "user", source: "user_request_analysis" },
        { text: "iOS Swift code", context: "user", source: "user_request_analysis" },
      ],
    };
    await orchestrator.cycle(input);
    const all = await deps.orgMemory.listAll();
    const mobile = await deps.orgMemory.timeline("mobile_app_development");
    expect(mobile.length).toBeGreaterThan(0);
    expect(mobile.length).toBeLessThanOrEqual(all.length);
  });

  it("capability registry enforces valid lifecycle transitions across cycles", async () => {
    const registry = new CapabilityRegistry(tmp);
    await registry.propose({ capabilityId: "alpha", displayName: "Alpha" });
    await registry.transition("alpha", "experimental");
    await registry.transition("alpha", "active");
    await registry.transition("alpha", "deprecated");
    await registry.transition("alpha", "active"); // revival
    const rec = await registry.get("alpha");
    expect(rec!.status).toBe("active");
  });

  it("agent birth writes audit trail per birth", async () => {
    const birth = new AgentBirthEngine({ rootDir: tmp });
    const saved: AgentBlueprint[] = [];
    const birthEngine = new AgentBirthEngine({
      rootDir: tmp,
      saveBlueprint: async (bp) => { saved.push(bp); },
    });
    const result = await birthEngine.birth({
      id: "prop-1",
      capabilityId: "x",
      displayName: "X",
      rationale: "test",
      source: "user_request_analysis",
      evidence: [],
      proposedAt: new Date().toISOString(),
    });
    expect(saved.length).toBe(1);
    expect(saved[0]!.id).toBe(result.blueprintId);
    const auditPath = path.join(tmp, "agent-births", `${result.blueprintId}.json`);
    const exists = await fs.stat(auditPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
    void birth;
  });

  it("governance config save/load round-trip", async () => {
    const governance = new GovernanceEngine(tmp);
    const newCfg = { ...DEFAULT_GOVERNANCE_CONFIG, maxAgents: 99, maxCapabilities: 88, maxDepth: 7 };
    await governance.saveConfig(newCfg);
    const loaded = await governance.loadConfig();
    expect(loaded.maxAgents).toBe(99);
    expect(loaded.maxCapabilities).toBe(88);
    expect(loaded.maxDepth).toBe(7);
  });
});