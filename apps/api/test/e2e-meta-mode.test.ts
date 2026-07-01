/**
 * Phase 6.10 — End-to-End test for META_AGENT_ENABLED routes.
 *
 * This E2E test:
 *   1. Boots a Hono app with the meta-system routes (mocked dependencies).
 *   2. Sends real HTTP requests via app.request().
 *   3. Verifies the full closed loop is observable through /meta/*.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { OpenAPIHono } from "@hono/zod-openapi";

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
} from "@max/meta-system";
import {
  metaRoutes,
  listCapabilitiesRoute,
  getCapabilityRoute,
  listProposalsRoute,
  runCycleRoute,
  listEventsRoute,
  countEventsRoute,
  checkGovernanceRoute,
  simulateRoute,
  compareSimulationsRoute,
  getGovernanceConfigRoute,
  putGovernanceConfigRoute,
} from "../src/routes/meta.js";

async function makeTmp(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "max-e2e-meta-"));
}

function makeHarness(tmp: string) {
  const registry = new CapabilityRegistry(tmp);
  const discovery = new CapabilityDiscoveryEngine(tmp);
  const birth = new AgentBirthEngine({ rootDir: tmp });
  const retirement = new AgentRetirementEngine();
  const metaAgent = new MetaAgent();
  const teamOptimizer = new TeamOptimizer();
  const orgMemory = new OrganizationMemory(tmp);
  const governance = new GovernanceEngine(tmp);
  const simulation = new SimulationEngine();
  const orchestrator = new MetaOrchestrator({
    registry, discovery, birth, retirement, metaAgent, teamOptimizer, orgMemory, governance,
  });
  return { orchestrator, governance, orgMemory, simulation, registry, discovery };
}

describe("E2E: META_AGENT_ENABLED /meta/* routes", () => {
  let tmp: string;
  let app: InstanceType<typeof OpenAPIHono>;

  beforeEach(async () => {
    tmp = await makeTmp();
    const h = makeHarness(tmp);
    const mr = metaRoutes({
      orchestrator: h.orchestrator,
      governance: h.governance,
      organizationMemory: h.orgMemory,
      simulation: h.simulation,
      registry: h.registry,
      discovery: h.discovery,
    });
    app = new OpenAPIHono();
    app.openapi(listCapabilitiesRoute, mr.listCapabilities);
    app.openapi(getCapabilityRoute, mr.getCapability);
    app.openapi(listProposalsRoute, mr.listProposals);
    app.openapi(runCycleRoute, mr.runCycle);
    app.openapi(listEventsRoute, mr.listEvents);
    app.openapi(countEventsRoute, mr.countEvents);
    app.openapi(checkGovernanceRoute, mr.checkGovernance);
    app.openapi(simulateRoute, mr.simulate);
    app.openapi(compareSimulationsRoute, mr.compareSimulations);
    app.openapi(getGovernanceConfigRoute, mr.getGovernanceConfig);
    app.openapi(putGovernanceConfigRoute, mr.putGovernanceConfig);
  });

  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it("POST /meta/cycle triggers discovery + birth + memory events", async () => {
    const res = await app.request("/meta/cycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recentExecutions: [],
        blueprints: [],
        graphs: [],
        discoverySignals: [
          { text: "Build iOS app", context: "user", source: "user_request_analysis" },
          { text: "Write Swift code", context: "user", source: "user_request_analysis" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      proposals: unknown[];
      activated: unknown[];
      births: unknown[];
      recorded: number;
    };
    expect(body.proposals.length).toBeGreaterThan(0);
    expect(body.activated.length).toBeGreaterThan(0);
    expect(body.births.length).toBeGreaterThan(0);
    expect(body.recorded).toBeGreaterThan(0);

    // GET /meta/capabilities reflects the new active capability.
    const capsRes = await app.request("/meta/capabilities");
    const caps = (await capsRes.json()) as { count: number; capabilities: Array<{ id: string; status: string }> };
    expect(caps.count).toBeGreaterThan(0);
    expect(caps.capabilities.some((c) => c.id === "mobile_app_development" && c.status === "active")).toBe(true);

    // GET /meta/events lists the timeline.
    const eventsRes = await app.request("/meta/events");
    const events = (await eventsRes.json()) as { count: number };
    expect(events.count).toBeGreaterThan(0);
  });

  it("GET /meta/events?subject=mobile_app_development filters timeline", async () => {
    // First trigger a cycle to generate events.
    await app.request("/meta/cycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recentExecutions: [],
        blueprints: [],
        graphs: [],
        discoverySignals: [
          { text: "Build iOS app", context: "user", source: "user_request_analysis" },
          { text: "Write Swift code", context: "user", source: "user_request_analysis" },
        ],
      }),
    });

    const res = await app.request("/meta/events?subject=mobile_app_development");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; events: Array<{ subject: string }> };
    expect(body.count).toBeGreaterThan(0);
    expect(body.events.every((e) => e.subject === "mobile_app_development")).toBe(true);
  });

  it("POST /meta/governance/check returns verdict", async () => {
    const res = await app.request("/meta/governance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        graphs: [],
        capabilities: [],
        blueprints: [],
      }),
    });
    expect(res.status).toBe(200);
    const verdict = (await res.json()) as { allowed: boolean; reason: string; currentCounts: unknown };
    expect(verdict.allowed).toBe(true);
    expect(verdict.currentCounts).toBeDefined();
  });

  it("POST /meta/simulate returns prediction", async () => {
    const res = await app.request("/meta/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgName: "OrgA",
        graph: {
          id: "g1",
          userRequest: "x",
          capabilities: ["frontend"],
          nodes: [
            { id: "n1", blueprintId: "b1", role: "frontend", displayName: "FE", dependsOn: [] },
          ],
          edges: [],
          layers: [{ index: 0, nodeIds: ["n1"] }],
          createdAt: new Date().toISOString(),
          status: "draft",
        },
        profiles: {
          frontend: { costPerCall: 1, latencyMs: 1000, qualityScore: 8 },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { teamSize: number; totalEstimatedCost: number };
    expect(body.teamSize).toBe(1);
    expect(body.totalEstimatedCost).toBe(1);
  });

  it("GET/PUT /meta/governance/config round-trip", async () => {
    const getRes = await app.request("/meta/governance/config");
    const initial = (await getRes.json()) as { maxAgents: number };
    expect(initial.maxAgents).toBe(20);

    const putRes = await app.request("/meta/governance/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maxAgents: 99,
        maxCapabilities: 50,
        maxDepth: 5,
        requireReviewForBirth: true,
        minUsageForBirth: 0,
      }),
    });
    expect(putRes.status).toBe(200);
    const after = (await putRes.json()) as { ok: boolean };
    expect(after.ok).toBe(true);

    const get2 = await app.request("/meta/governance/config");
    const cfg2 = (await get2.json()) as { maxAgents: number };
    expect(cfg2.maxAgents).toBe(99);
  });

  it("GET /meta/events/count returns event-type counts", async () => {
    await app.request("/meta/cycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recentExecutions: [],
        blueprints: [],
        graphs: [],
        discoverySignals: [
          { text: "Build Android app", context: "user", source: "user_request_analysis" },
          { text: "Write Kotlin code", context: "user", source: "user_request_analysis" },
        ],
      }),
    });
    const res = await app.request("/meta/events/count");
    const counts = (await res.json()) as { capability_proposed?: number; agent_born?: number };
    expect((counts.capability_proposed ?? 0) + (counts.agent_born ?? 0)).toBeGreaterThan(0);
  });

  it("POST /meta/cycle handles invalid body", async () => {
    const res = await app.request("/meta/cycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discoverySignals: [{ text: "", context: "x", source: "user_request_analysis" }] }),
    });
    expect(res.status).toBe(400);
  });
});