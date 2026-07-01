/**
 * Phase 11 — HITL Governance API integration tests.
 *
 * Tests the full flow: proposal → HITL gate → pending store → human approval → rollout.
 * Uses real implementations against temp filesystem (no mocks).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  ProposalPipeline,
  SafeRollout,
  PendingProposalStore,
  DigitalTwin,
  createProposal,
  type MetaOrchestratorDeps,
} from "@max/meta-system";

// ── Helpers ─────────────────────────────────────────────────────────────────

async function buildOrchestrator(rootDir: string, opts?: { hitlRiskThreshold?: number; rolloutMode?: string }) {
  const registry = new CapabilityRegistry(rootDir);
  const discovery = new CapabilityDiscoveryEngine(rootDir);
  const birth = new AgentBirthEngine({ rootDir });
  const retirement = new AgentRetirementEngine();
  const metaAgent = new MetaAgent();
  const teamOptimizer = new TeamOptimizer();
  const orgMemory = new OrganizationMemory(rootDir);
  const governance = new GovernanceEngine(rootDir);
  const simulation = new SimulationEngine();

  // Configure HITL if requested.
  if (opts?.hitlRiskThreshold !== undefined) {
    await governance.saveConfig({
      ...governance.getConfig(),
      hitlRiskThreshold: opts.hitlRiskThreshold,
    });
  }

  const pipeline = new ProposalPipeline({
    simulation,
    captureSnapshot: async () =>
      DigitalTwin.capture({
        capabilities: await registry.listAll(),
        blueprints: [],
        graphs: [],
      }),
  });
  const rollout = new SafeRollout(opts?.rolloutMode as "shadow" | "canary" | "full" ?? "full");
  const pendingStore = new PendingProposalStore(rootDir);

  let savedBlueprints: Array<{ id: string; role: string }> = [];
  let retiredIds: string[] = [];

  const deps: MetaOrchestratorDeps = {
    registry,
    discovery,
    birth,
    retirement,
    metaAgent,
    teamOptimizer,
    orgMemory,
    governance,
    pipeline,
    rollout,
    pendingStore,
    manualSaveBlueprint: async (bp) => { savedBlueprints.push({ id: bp.id, role: bp.role }); },
    manualRetireBlueprint: async (id) => { retiredIds.push(id); },
  };

  const orchestrator = new MetaOrchestrator(deps);

  return {
    orchestrator,
    registry,
    orgMemory,
    governance,
    rollout,
    pendingStore,
    getSavedBlueprints: () => savedBlueprints,
    getRetiredIds: () => retiredIds,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Phase 11 — HITL Governance API", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "phase11-api-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("retire proposal is paused by HITL and appears in pendingStore", async () => {
    const { orchestrator, pendingStore } = await buildOrchestrator(tmp);

    // Create a retire proposal.
    const retireProposal = createProposal({
      action: "retire",
      subject: "slow_agent",
      rationale: "too slow",
      source: "meta_agent",
    });

    // Run through the pipeline + HITL gate.
    // We can't call runProposal directly (private), but we can test
    // the pipeline + governance + store integration directly.
    const { governance } = await buildOrchestrator(join(tmp, "sub1"));
    const simulation = new SimulationEngine();
    const registry = new CapabilityRegistry(join(tmp, "sub1"));
    const pipeline = new ProposalPipeline({
      simulation,
      captureSnapshot: async () =>
        DigitalTwin.capture({
          capabilities: await registry.listAll(),
          blueprints: [],
          graphs: [],
        }),
    });

    const result = await pipeline.run(retireProposal);
    const hitlVerdict = governance.checkProposal({
      proposal: result.proposal,
      score: result.score,
    });

    expect(hitlVerdict.status).toBe("pending_human");

    // Save to pending store.
    const pending = await pendingStore.save({
      proposal: result.proposal,
      simulation: result.simulation,
      score: result.score,
    });
    expect(pending.status).toBe("pending_human");

    // List pending.
    const list = await pendingStore.listPending();
    expect(list).toHaveLength(1);
    expect(list[0].proposalId).toBe(retireProposal.id);
  });

  it("human approval resolves pending proposal", async () => {
    const { pendingStore } = await buildOrchestrator(tmp);

    // Create and save a pending proposal.
    const proposal = createProposal({
      action: "retire",
      subject: "old_agent",
      rationale: "retiring",
      source: "meta_agent",
    });
    const simulation = { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0, riskDelta: 0.5, simulatedAt: new Date().toISOString() };
    const score = {
      proposalId: proposal.id,
      qualityGain: 0,
      latencyPenalty: 0,
      costPenalty: 0,
      riskPenalty: 0.5,
      utility: -0.5,
      approved: false,
      reason: "high risk",
    };

    await pendingStore.save({ proposal, simulation, score });

    // Approve it.
    const resolved = await pendingStore.resolve(proposal.id, "approved", "admin", "reviewed and approved");
    expect(resolved.status).toBe("approved");
    expect(resolved.resolvedBy).toBe("admin");
    expect(resolved.resolutionReason).toBe("reviewed and approved");
    expect(resolved.resolvedAt).toBeTruthy();

    // Pending list should be empty.
    const list = await pendingStore.listPending();
    expect(list).toHaveLength(0);
  });

  it("human rejection resolves pending proposal", async () => {
    const { pendingStore } = await buildOrchestrator(tmp);

    const proposal = createProposal({
      action: "retire",
      subject: "important_agent",
      rationale: "mistake",
      source: "meta_agent",
    });
    const simulation = { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0, riskDelta: 0.6, simulatedAt: new Date().toISOString() };
    const score = {
      proposalId: proposal.id,
      qualityGain: 0,
      latencyPenalty: 0,
      costPenalty: 0,
      riskPenalty: 0.6,
      utility: -0.6,
      approved: false,
      reason: "high risk",
    };

    await pendingStore.save({ proposal, simulation, score });

    // Reject it.
    const resolved = await pendingStore.resolve(proposal.id, "rejected", "bob", "too risky");
    expect(resolved.status).toBe("rejected");
    expect(resolved.resolvedBy).toBe("bob");
  });

  it("low-risk birth proposal bypasses HITL entirely", async () => {
    const governance = new GovernanceEngine(tmp);

    const birthProposal = createProposal({
      action: "birth",
      subject: "new_agent",
      rationale: "need it",
      source: "meta_agent",
    });
    const score = {
      proposalId: birthProposal.id,
      qualityGain: 1,
      latencyPenalty: 0,
      costPenalty: 0,
      riskPenalty: 0.1,
      utility: 0.9,
      approved: true,
      reason: "good",
    };

    const verdict = governance.checkProposal({ proposal: birthProposal, score });
    expect(verdict.status).toBe("approved");
  });

  it("custom hitlRiskThreshold gates birth proposals", async () => {
    const governance = new GovernanceEngine(tmp);
    await governance.saveConfig({ ...governance.getConfig(), hitlRiskThreshold: 0.05 });

    const birthProposal = createProposal({
      action: "birth",
      subject: "risky_agent",
      rationale: "risky",
      source: "meta_agent",
    });
    const score = {
      proposalId: birthProposal.id,
      qualityGain: 0.5,
      latencyPenalty: 0,
      costPenalty: 0,
      riskPenalty: 0.1,
      utility: 0.4,
      approved: true,
      reason: "ok",
    };

    const verdict = governance.checkProposal({ proposal: birthProposal, score });
    expect(verdict.status).toBe("pending_human");
  });

  it("resolve() throws on nonexistent proposal", async () => {
    const { pendingStore } = await buildOrchestrator(tmp);
    await expect(
      pendingStore.resolve("nonexistent", "approved", "admin", "nope")
    ).rejects.toThrow("not found");
  });

  it("resolve() throws on already-resolved proposal", async () => {
    const { pendingStore } = await buildOrchestrator(tmp);

    const proposal = createProposal({
      action: "retire",
      subject: "agent",
      rationale: "test",
      source: "meta_agent",
    });
    await pendingStore.save({
      proposal,
      simulation: { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0, riskDelta: 0.5, simulatedAt: new Date().toISOString() },
      score: { proposalId: proposal.id, qualityGain: 0, latencyPenalty: 0, costPenalty: 0, riskPenalty: 0.5, utility: -0.5, approved: false, reason: "risk" },
    });

    await pendingStore.resolve(proposal.id, "rejected", "bob", "nope");
    await expect(
      pendingStore.resolve(proposal.id, "approved", "alice", "changed mind")
    ).rejects.toThrow("already resolved");
  });

  it("full cycle: HITL pause → human approve → rollout applies", async () => {
    const { pendingStore, rollout, getRetiredIds } = await buildOrchestrator(tmp);

    // Create a retire proposal with high risk.
    const proposal = createProposal({
      action: "retire",
      subject: "old_agent",
      rationale: "retiring",
      source: "meta_agent",
    });
    const simulation = { costDelta: 0, latencyDeltaMs: 0, qualityDelta: 0, riskDelta: 0.6, simulatedAt: new Date().toISOString() };
    const score = {
      proposalId: proposal.id,
      qualityGain: 0,
      latencyPenalty: 0,
      costPenalty: 0,
      riskPenalty: 0.6,
      utility: -0.6,
      approved: false,
      reason: "high risk",
    };

    // 1. HITL gate saves to pending store.
    await pendingStore.save({ proposal, simulation, score });
    expect(await pendingStore.listPending()).toHaveLength(1);

    // 2. Human approves.
    const resolved = await pendingStore.resolve(proposal.id, "approved", "admin", "ok");
    expect(resolved.status).toBe("approved");

    // 3. Rollout applies the mutation.
    let mutationApplied = false;
    const rolloutResult = await rollout.apply({
      proposal: { ...proposal, status: "approved" },
      applyMutation: async () => { mutationApplied = true; },
      record: async () => {},
      canaryKey: proposal.subject,
    });

    expect(rolloutResult.applied).toBe(true);
    expect(mutationApplied).toBe(true);
    expect(rolloutResult.proposal.status).toBe("applied");
  });
});
