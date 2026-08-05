// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for OpencodeTeamBridge — Maximilian TeamOrchestrator → opencode
 * Agent.Service mirror.
 *
 * 借鉴 opencode: Agent shape from `packages/opencode/src/agent/agent.ts`;
 * HTTP routes mirror `docs/opencode-sdk-spec.md` §6.2.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentRegistry } from "../src/orchestration/agent-registry.js";
import { EventBus } from "../src/event-bus.js";
import {
  TeamOrchestrator,
  type Team,
  type TeamOrchestratorEvent,
} from "../src/team-orchestrator.js";
import {
  OpencodeTeamBridge,
  type AgentDeletePayload,
  type AgentMirror,
  type AgentUpdatePayload,
  type OpencodeBridgeEvent,
} from "../src/opencode-team-bridge.js";

function makeTeam(id: string, extra: Partial<Team> = {}): Team {
  return {
    id,
    name: `team-${id}`,
    leaderId: `leader-${id}`,
    specialistIds: [`specialist-${id}-1`, `specialist-${id}-2`],
    capabilities: [`cap-${id}`],
    memory: {
      facts: [],
      decisions: [],
      modifiedFiles: [],
      openQuestions: [],
      lastUpdated: new Date().toISOString(),
    },
    ...extra,
  };
}

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OpencodeTeamBridge", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let bridge: OpencodeTeamBridge;
  let bus: EventBus<OpencodeBridgeEvent>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(makeJsonResponse({}, 200));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    bus = new EventBus<OpencodeBridgeEvent>();
    bridge = new OpencodeTeamBridge({
      baseUrl: "http://opencode.test",
      fetch: fetchMock,
      eventBus: bus,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("mirrorTeam POSTs each member to /api/agent/<id> and stores mirrors", async () => {
    const team = makeTeam("a");
    const mirrors = await bridge.mirrorTeam(team);

    expect(mirrors).toHaveLength(3); // leader + 2 specialists
    expect(mirrors.map((m) => m.agentId).sort()).toEqual([
      "leader-a",
      "specialist-a-1",
      "specialist-a-2",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const url = String(call[0]);
      expect(url).toMatch(/^http:\/\/opencode\.test\/api\/agent\/(leader|specialist)-/);
      const init = call[1] as RequestInit;
      expect(init.method).toBe("POST");
      const body = JSON.parse(String(init.body));
      expect(body.teamId).toBe("a");
      expect(body.capabilities).toEqual(["cap-a"]);
    }

    expect(bridge.listMirrors()).toHaveLength(3);
    expect(bridge.size()).toBe(3);
  });

  it("applyLifecycle emits a PATCH that mirrors AgentService.update", async () => {
    const team = makeTeam("b");
    await bridge.mirrorTeam(team);
    fetchMock.mockClear();

    const payload = await bridge.applyLifecycle(
      team,
      "leader-b",
      "promote",
      "active",
      { reason: "promotion-round-1" },
    );

    expect(payload).toMatchObject({
      agentId: "leader-b",
      teamId: "b",
      status: "active",
      action: "promote",
      capabilities: ["cap-b"],
      metadata: { reason: "promotion-round-1" },
    });
    const url = String(fetchMock.mock.calls[0]?.[0]);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(url).toBe("http://opencode.test/api/agent/leader-b");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toMatchObject({
      agentId: "leader-b",
      status: "active",
      action: "promote",
    });
    expect(bridge.listUpdates()).toHaveLength(1);
  });

  it("applyLifecycle supports demote without metadata", async () => {
    const team = makeTeam("c");
    await bridge.mirrorTeam(team);
    fetchMock.mockClear();

    const payload = await bridge.applyLifecycle(team, "leader-c", "demote", "throttled");

    expect(payload.action).toBe("demote");
    expect(payload.status).toBe("throttled");
    expect(payload.metadata).toBeUndefined();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("PATCH");
  });

  it("applyRetire emits a DELETE and clears the local mirror", async () => {
    const team = makeTeam("d");
    await bridge.mirrorTeam(team);
    expect(bridge.size()).toBe(3);
    fetchMock.mockClear();

    const payload = await bridge.applyRetire(team, "leader-d", "end-of-life");

    expect(payload).toEqual({
      agentId: "leader-d",
      teamId: "d",
      reason: "end-of-life",
    });
    const url = String(fetchMock.mock.calls[0]?.[0]);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(url).toBe("http://opencode.test/api/agent/leader-d");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toEqual(payload);

    expect(bridge.listDeletes()).toHaveLength(1);
    expect(bridge.listMirrors().find((m) => m.agentId === "leader-d")).toBeUndefined();
    expect(bridge.size()).toBe(2);
  });

  it("dryRun mode skips fetch entirely but still records history", async () => {
    const dryBridge = new OpencodeTeamBridge({
      baseUrl: "http://opencode.test",
      fetch: fetchMock,
      dryRun: true,
    });
    const team = makeTeam("e");

    await dryBridge.mirrorTeam(team);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dryBridge.size()).toBe(3);

    await dryBridge.applyLifecycle(team, "leader-e", "promote", "active");
    await dryBridge.applyRetire(team, "leader-e");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dryBridge.listUpdates()).toHaveLength(1);
    expect(dryBridge.listDeletes()).toHaveLength(1);
  });

  it("publishes events on the bus for mirror / update / delete", async () => {
    const received: OpencodeBridgeEvent[] = [];
    bus.subscribe((e) => received.push(e));

    const team = makeTeam("f");
    await bridge.mirrorTeam(team);
    await bridge.applyLifecycle(team, "leader-f", "promote", "active");
    await bridge.applyRetire(team, "leader-f");

    expect(received.map((e) => e.type)).toEqual([
      "opencode-agent-mirror",
      "opencode-agent-mirror",
      "opencode-agent-mirror",
      "opencode-agent-update",
      "opencode-agent-delete",
    ]);
    expect(received[0]?.statusCode).toBe(200);
  });

  it("records statusCode=0 on network failure but keeps the mirror", async () => {
    const received: OpencodeBridgeEvent[] = [];
    bus.subscribe((e) => received.push(e));

    // Make every call fail so the demote below surfaces statusCode=0.
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const team = makeTeam("g");
    const mirrors = await bridge.mirrorTeam(team);

    expect(mirrors).toHaveLength(3);
    expect(bridge.size()).toBe(3);

    await bridge.applyLifecycle(team, "leader-g", "demote", "throttled");

    // Three mirror events from the initial mirror + one demote update.
    const updateEvents = received.filter((e) => e.type === "opencode-agent-update");
    expect(updateEvents).toHaveLength(1);
    expect(updateEvents[0]?.statusCode).toBe(0);
    // All mirror events also report 0 since fetch rejected.
    expect(received.every((e) => e.statusCode === 0)).toBe(true);
  });

  it("binds to a TeamOrchestrator and translates delegation events", async () => {
    // Wire up an orchestrator with two teams + a registry that knows the
    // leaders and emits delegation events we can subscribe to.
    const registry = new AgentRegistry();
    registry.register({
      id: "leader-x",
      type: "leader",
      receiver: async () => "handled-by-x",
    });
    registry.register({
      id: "leader-y",
      type: "leader",
      receiver: async () => "handled-by-y",
    });
    const orchBus = new EventBus<TeamOrchestratorEvent>();
    const teamX: Team = {
      id: "x",
      name: "team-x",
      leaderId: "leader-x",
      specialistIds: [],
      capabilities: ["cap-x"],
      memory: {
        facts: [],
        decisions: [],
        modifiedFiles: [],
        openQuestions: [],
        lastUpdated: new Date().toISOString(),
      },
    };
    const teamY: Team = {
      id: "y",
      name: "team-y",
      leaderId: "leader-y",
      specialistIds: [],
      capabilities: ["cap-y"],
      memory: {
        facts: [],
        decisions: [],
        modifiedFiles: [],
        openQuestions: [],
        lastUpdated: new Date().toISOString(),
      },
    };
    const teamsById = new Map<string, Team>([["x", teamX], ["y", teamY]]);

    const orch = new TeamOrchestrator(
      {
        teams: [teamX, teamY],
        emitEvents: true,
      },
      registry,
      orchBus,
    );
    bridge.bindToOrchestrator(orchBus, (id) => teamsById.get(id));

    // ── Successful delegation → promote leader-y
    await orch.delegate({
      id: "elegant-blue-tiger",
      fromTeamId: "x",
      toTeamId: "y",
      taskId: "t1",
      taskDescription: "do work",
      context: {},
      createdAt: new Date().toISOString(),
    });
    expect(bridge.listUpdates().map((u) => u.agentId)).toContain("leader-y");

    // ── Escalation → retire every attempted team leader
    const failingRegistry = new AgentRegistry();
    failingRegistry.register({ id: "leader-x", type: "leader", receiver: async () => {} });
    const orch2 = new TeamOrchestrator(
      {
        teams: [teamX, teamY],
        emitEvents: true,
      },
      failingRegistry,
      orchBus,
    );
    await orch2.delegate({
      id: "fail-1",
      fromTeamId: "x",
      toTeamId: "y",
      taskId: "t-fail",
      taskDescription: "fail",
      context: {},
      createdAt: new Date().toISOString(),
    });

    // Escalation should retire leader-y.
    expect(
      bridge.listDeletes().map((d: AgentDeletePayload) => d.agentId),
    ).toContain("leader-y");
  });

  it("resets state cleanly", async () => {
    const team = makeTeam("h");
    await bridge.mirrorTeam(team);
    await bridge.applyLifecycle(team, "leader-h", "promote", "active");
    expect(bridge.size()).toBe(3);
    expect(bridge.listUpdates().length).toBeGreaterThan(0);
    bridge.reset();
    expect(bridge.size()).toBe(0);
    expect(bridge.listUpdates()).toHaveLength(0);
    expect(bridge.listDeletes()).toHaveLength(0);
  });

  it("rejects empty baseUrl", () => {
    expect(
      () => new OpencodeTeamBridge({ baseUrl: "" }),
    ).toThrow(/baseUrl/);
  });

  it("preserves mirror metadata ordering and shape", async () => {
    const team = makeTeam("i", { capabilities: ["alpha", "beta"] });
    const mirrors = (await bridge.mirrorTeam(team)) as AgentMirror[];
    for (const m of mirrors) {
      expect(m.capabilities).toEqual(["alpha", "beta"]);
      expect(m.status).toBe("registered");
      expect(typeof m.registeredAt).toBe("string");
      expect(m.teamId).toBe("i");
    }
  });
});