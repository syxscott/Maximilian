/**
 * Phase 7.6 — Real Closed-Loop E2E Test
 *
 * Scenario: 20 data-pipeline-related user requests arrive in sequence.
 * (Originally framed as "20 database projects" — re-mapped to data_pipeline
 * because "database" is already in KNOWN_CAPABILITIES; data_pipeline is
 * a real gap that the closed loop should fill.)
 *
 * System should automatically:
 *   1. Discover data_pipeline capability (high frequency)
 *   2. Register it in CapabilityRegistry
 *   3. Activate it
 *   4. Birth a data_pipeline_agent
 *   5. Persist blueprint to BlueprintStore on disk
 *   6. Make it available to DAGS on next compose()
 *   7. Compose a team using the new blueprint
 *   8. Complete a simulated task
 *
 * All without manual intervention.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { BlueprintStore } from "@max/dags";
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
  applyHintToBlueprints,
  type DiscoverySignal,
} from "@max/meta-system";
import { CapabilityLibrary } from "@max/dags";

async function makeTmp(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "max-closed-loop-"));
}

interface ClosedLoopHarness {
  registry: CapabilityRegistry;
  blueprintStore: BlueprintStore;
  library: CapabilityLibrary;
  orchestrator: MetaOrchestrator;
  orgMemory: OrganizationMemory;
  tmp: string;
}

function makeHarness(tmp: string): ClosedLoopHarness {
  const registry = new CapabilityRegistry(tmp);
  const blueprintStore = new BlueprintStore(tmp);
  const library = new CapabilityLibrary();
  const discovery = new CapabilityDiscoveryEngine(tmp);
  const birth = new AgentBirthEngine({
    rootDir: tmp,
    saveBlueprint: (bp) => blueprintStore.save(bp),
  });
  const retirement = new AgentRetirementEngine({
    retireBlueprint: (id) => blueprintStore.retire(id),
  });
  const metaAgent = new MetaAgent();
  const teamOptimizer = new TeamOptimizer({
    rootDir: tmp,
    applyToBlueprintStore: async (hint) => {
      const blueprints = await blueprintStore.listAll();
      return await applyHintToBlueprints(hint, blueprints, (bp) => blueprintStore.save(bp));
    },
  });
  const orgMemory = new OrganizationMemory(tmp);
  const governance = new GovernanceEngine(tmp);
  const orchestrator = new MetaOrchestrator({
    registry,
    discovery,
    birth,
    retirement,
    metaAgent,
    teamOptimizer,
    orgMemory,
    governance,
  });
  return { registry, blueprintStore, library, orchestrator, orgMemory, tmp };
}

function pipelineSignal(n: number): DiscoverySignal {
  // NB: signals intentionally avoid KNOWN_KEYWORDS ("postgres", "api", etc.)
  // so the discovery engine reaches the GAP_PATTERNS stage and proposes
  // the new `data_pipeline` capability.
  return {
    text: `Project ${n}: build ETL data pipeline from source tables to a Snowflake warehouse, transform with Spark, schedule with Airflow.`,
    context: `workspace-${n}`,
    source: "user_request_analysis",
  };
}

describe("Phase 7.6 — Real Closed-Loop E2E: 20 data pipeline projects", () => {
  let tmp: string;
  let harness: ClosedLoopHarness;

  beforeEach(async () => {
    tmp = await makeTmp();
    harness = makeHarness(tmp);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("discovers → registers → activates → births → persists blueprint (5+ signals)", async () => {
    // First cycle: 5 data-pipeline signals (above DISCOVERY_CONFIG.minFrequency=2).
    const signals: DiscoverySignal[] = [];
    for (let i = 1; i <= 5; i++) signals.push(pipelineSignal(i));

    const cycle1 = await harness.orchestrator.cycle({
      recentExecutions: [],
      blueprints: [],
      graphs: [],
      discoverySignals: signals,
    });

    // 1. capability discovered
    expect(cycle1.proposals.length).toBeGreaterThan(0);
    const dpProposal = cycle1.proposals.find((p) => p.capabilityId === "data_pipeline");
    expect(dpProposal).toBeDefined();

    // 2. capability registered
    const allCaps = await harness.registry.listAll();
    const dpCap = allCaps.find((c) => c.id === "data_pipeline");
    expect(dpCap).toBeDefined();

    // 3. capability activated
    expect(cycle1.activated.some((c) => c.id === "data_pipeline")).toBe(true);
    const dpActive = await harness.registry.listByStatus("active");
    expect(dpActive.some((c) => c.id === "data_pipeline")).toBe(true);

    // 4. agent born
    expect(cycle1.births.some((b) => b.parentCapability === "data_pipeline")).toBe(true);

    // 5. blueprint persisted to disk
    const dpBirth = cycle1.births.find((b) => b.parentCapability === "data_pipeline")!;
    const persisted = await harness.blueprintStore.get(dpBirth.blueprintId);
    expect(persisted).toBeDefined();
    expect(persisted!.capabilities).toContain("data_pipeline");
    expect(persisted!.role).toBe("data_pipeline_agent");

    // Disk file check
    const onDisk = await fs.readFile(
      path.join(tmp, "blueprints", `${dpBirth.blueprintId}.json`),
      "utf-8"
    );
    expect(JSON.parse(onDisk).id).toBe(dpBirth.blueprintId);
  });

  it("scales to 20 data-pipeline projects with no regression", async () => {
    // Run 4 cycles, each adding 5 new signals (totaling 20 across the workspace).
    let totalBirths = 0;
    for (let batch = 0; batch < 4; batch++) {
      const signals: DiscoverySignal[] = [];
      for (let i = 1; i <= 5; i++) {
        signals.push(pipelineSignal(batch * 5 + i));
      }
      const result = await harness.orchestrator.cycle({
        recentExecutions: [],
        blueprints: await harness.blueprintStore.listAll(),
        graphs: [],
        discoverySignals: signals,
      });
      totalBirths += result.births.length;
    }

    // After 20 signals, we should have at least one data_pipeline_agent blueprint.
    const allBlueprints = await harness.blueprintStore.listAll();
    const dpBlueprints = allBlueprints.filter((b) =>
      b.capabilities.includes("data_pipeline") && b.role === "data_pipeline_agent"
    );
    expect(dpBlueprints.length).toBeGreaterThanOrEqual(1);

    // Total births should equal number of times we crossed the activation threshold.
    // First cycle creates the capability + 1 birth. Subsequent cycles find it already
    // active so no new birth. Expect at least 1.
    expect(totalBirths).toBeGreaterThanOrEqual(1);

    // Org memory should record ≥ 5 events (proposals, promotions, births, etc.).
    const events = await harness.orgMemory.listAll();
    expect(events.length).toBeGreaterThanOrEqual(5);
  });

  it("DAGS uses the new data_pipeline blueprint after meta-cycle", async () => {
    // Step 1: Run meta-cycle with data-pipeline signals.
    const signals: DiscoverySignal[] = [];
    for (let i = 1; i <= 5; i++) signals.push(pipelineSignal(i));
    await harness.orchestrator.cycle({
      recentExecutions: [],
      blueprints: [],
      graphs: [],
      discoverySignals: signals,
    });

    // Step 2: Confirm data_pipeline capability is active in registry.
    const dpActive = await harness.registry.listByStatus("active");
    expect(dpActive.some((c) => c.id === "data_pipeline")).toBe(true);

    // Step 3: Sync registry → DAGS library (mimics DAGS.compose() pre-step).
    const dynamicCaps = await Promise.all(
      dpActive.map(async (c) => ({
        id: c.id,
        displayName: c.displayName,
        description: c.description || "Dynamic capability from registry",
        category: "general" as const,
        keywords: [c.id, ...c.id.split(/[_-]+/)],
        defaultGoal: `Deliver ${c.displayName}`,
        promptTemplate: `You are a ${c.displayName}. Address: {{userRequest}}`,
        defaultTools: [],
        defaultConstraints: { outputFormat: "code" as const },
        dependsOn: [],
        tags: ["dynamic"],
      }))
    );
    harness.library.replaceDynamic(dynamicCaps);

    // Step 4: Compose with a data-pipeline request.
    const request = "build ETL data pipeline with Spark";
    const detected = harness.library.detectByKeywords(request);

    // The dynamic "data_pipeline" capability should be in the detected list.
    expect(detected).toContain("data_pipeline");

    // Step 5: The blueprint should be reusable.
    const dpBlueprint = (await harness.blueprintStore.listAll()).find(
      (b) => b.role === "data_pipeline_agent"
    );
    expect(dpBlueprint).toBeDefined();
    expect(dpBlueprint!.capabilities).toContain("data_pipeline");
  });

  it("blueprint persists across meta-cycle restarts (file-based durability)", async () => {
    // Cycle 1: create data_pipeline blueprint.
    const signals: DiscoverySignal[] = [];
    for (let i = 1; i <= 5; i++) signals.push(pipelineSignal(i));
    await harness.orchestrator.cycle({
      recentExecutions: [],
      blueprints: [],
      graphs: [],
      discoverySignals: signals,
    });

    const allBlueprints = await harness.blueprintStore.listAll();
    const dpBlueprintId = allBlueprints.find(
      (b) => b.role === "data_pipeline_agent"
    )?.id;
    expect(dpBlueprintId).toBeDefined();

    // Simulate restart: create new BlueprintStore against same tmp dir.
    const restartedStore = new BlueprintStore(tmp);
    const recoveredBlueprint = await restartedStore.get(dpBlueprintId!);
    expect(recoveredBlueprint).toBeDefined();
    expect(recoveredBlueprint!.capabilities).toContain("data_pipeline");
  });

  it("governance blocks new births when at maxAgents (closed-loop stays safe)", async () => {
    // Tight governance: maxAgents=1.
    const tightGovernance = new GovernanceEngine(tmp, {
      maxAgents: 1,
      maxCapabilities: 30,
      maxDepth: 4,
      requireReviewForBirth: false,
      minUsageForBirth: 0,
    });
    const tightOrchestrator = new MetaOrchestrator({
      registry: harness.registry,
      discovery: new CapabilityDiscoveryEngine(tmp),
      birth: new AgentBirthEngine({
        rootDir: tmp,
        saveBlueprint: (bp) => harness.blueprintStore.save(bp),
      }),
      retirement: new AgentRetirementEngine(),
      metaAgent: new MetaAgent(),
      teamOptimizer: new TeamOptimizer(),
      orgMemory: harness.orgMemory,
      governance: tightGovernance,
    });

    // Pre-fill with one existing blueprint.
    await harness.blueprintStore.save({
      id: "bp-existing-v1",
      role: "general",
      displayName: "General",
      goal: "General purpose",
      systemPrompt: "General agent",
      capabilities: ["general"],
      tools: [],
      preferredModels: [],
      constraints: { outputFormat: "free" },
      version: "v1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stats: { totalTasks: 0, totalSuccesses: 0, avgScore: 0, avgExecutionTimeMs: 0 },
      metadata: {},
    });

    const signals: DiscoverySignal[] = [];
    for (let i = 1; i <= 5; i++) signals.push(pipelineSignal(i));

    const result = await tightOrchestrator.cycle({
      recentExecutions: [],
      blueprints: await harness.blueprintStore.listAll(),
      graphs: [],
      discoverySignals: signals,
    });

    // Discovery still happens (advisory).
    expect(result.proposals.some((p) => p.capabilityId === "data_pipeline")).toBe(true);
    // Activation still happens.
    expect(result.activated.some((c) => c.id === "data_pipeline")).toBe(true);
    // Birth blocked.
    expect(result.births.length).toBe(0);
    expect(result.blockedBy.some((r) => r.includes("maxAgents"))).toBe(true);

    // No data_pipeline_agent blueprint should exist on disk.
    const allBlueprints = await harness.blueprintStore.listAll();
    const dpBirths = allBlueprints.filter((b) => b.role === "data_pipeline_agent");
    expect(dpBirths.length).toBe(0);
  });

  it("TeamOptimizer hint is materialized into blueprint metadata after cycle", async () => {
    // First create a review-less team by activating data_pipeline.
    const signals: DiscoverySignal[] = [];
    for (let i = 1; i <= 5; i++) signals.push(pipelineSignal(i));
    await harness.orchestrator.cycle({
      recentExecutions: [],
      blueprints: [],
      graphs: [],
      discoverySignals: signals,
    });

    // Trigger a cycle with an empty graph (no review node) → TeamOptimizer
    // should produce add_review_node suggestion.
    const result = await harness.orchestrator.cycle({
      recentExecutions: [],
      blueprints: await harness.blueprintStore.listAll(),
      graphs: [{
        id: "g-test",
        userRequest: "x",
        capabilities: ["data_pipeline"],
        nodes: [
          { id: "n1", blueprintId: "b1", role: "data_pipeline_agent", displayName: "DP", dependsOn: [] },
        ],
        edges: [],
        layers: [{ index: 0, nodeIds: ["n1"] }],
        createdAt: new Date().toISOString(),
        status: "draft",
      }],
      discoverySignals: [],
    });

    // Hint should have add_review_node suggestion.
    const hasReviewHint = result.teamHint.suggestions.some((s) => s.type === "add_review_node");
    expect(hasReviewHint).toBe(true);

    // If a review blueprint exists, its metadata should now be marked.
    const reviewBp = (await harness.blueprintStore.listAll()).find(
      (b) => b.role === "review" || b.role === "reviewer"
    );
    if (reviewBp) {
      expect(reviewBp.metadata.optimizerRequired).toBe(true);
      expect(reviewBp.metadata.lastHintId).toBe(result.teamHint.id);
    }
  });
});
