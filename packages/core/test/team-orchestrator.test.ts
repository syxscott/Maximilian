/**
 * Tests for TeamOrchestrator — Teams-First delegation, memory, and lifecycle.
 *
 * Borrowed from `Yeachan-Heo/oh-my-claudecode` teams-first architecture.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { AgentRegistry } from "../src/orchestration/agent-registry.js";
import { EventBus } from "../src/event-bus.js";
import {
  TeamOrchestrator,
  generateReadableId,
  type Team,
  type TeamOrchestratorEvent,
} from "../src/team-orchestrator.js";

function makeTeam(id: string, extra: Partial<Team> = {}): Team {
  return {
    id,
    name: `team-${id}`,
    leaderId: `leader-${id}`,
    specialistIds: [`specialist-${id}`],
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

describe("TeamOrchestrator", () => {
  let registry: AgentRegistry;
  let bus: EventBus<TeamOrchestratorEvent>;
  let teamA: Team;
  let teamB: Team;
  let teamC: Team;

  beforeEach(() => {
    registry = new AgentRegistry();
    bus = new EventBus<TeamOrchestratorEvent>();

    // Distinct, non-overlapping capability tags so findCapableTeam tests
    // predictably map a task phrase to exactly one team.
    teamA = makeTeam("a", { capabilities: ["frontend", "ui"] });
    teamB = makeTeam("b", { capabilities: ["backend", "api"] });
    teamC = makeTeam("c", { capabilities: ["review", "qa"] });
    // Reset memory in case prior tests mutated the shared refs.
    for (const t of [teamA, teamB, teamC]) {
      t.memory = {
        facts: [],
        decisions: [],
        modifiedFiles: [],
        openQuestions: [],
        lastUpdated: new Date().toISOString(),
      };
    }

    registry.register({
      id: "leader-a",
      type: "leader",
      receiver: async () => { /* Ack */ },
    });
    registry.register({
      id: "specialist-b",
      type: "specialist",
      receiver: async () => "result-b",
    });
    registry.register({
      id: "leader-b",
      type: "leader",
      receiver: async () => "handled-by-b",
    });
    registry.register({
      id: "leader-c",
      type: "leader",
      receiver: async () => "handled-by-c",
    });
  });

  it("delegates task from team A to team B successfully", async () => {
    const orch = new TeamOrchestrator(
      { teams: [teamA, teamB], emitEvents: true },
      registry,
      bus,
    );
    const result = await orch.delegate({
      id: "elegant-blue-tiger",
      fromTeamId: "a",
      toTeamId: "b",
      taskId: "t1",
      taskDescription: "do work",
      context: {},
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ toTeamId: "b", leaderId: "leader-b" });
    expect(result.attempts).toBe(1);
    expect(result.attemptedTeams).toEqual(["b"]);
  });

  it("readable ID is generated in adjective-color-animal format", () => {
    for (let i = 0; i < 20; i++) {
      const id = generateReadableId();
      const parts = id.split("-");
      expect(parts).toHaveLength(3);
      expect(parts[0]!.length).toBeGreaterThan(0);
      expect(parts[1]!.length).toBeGreaterThan(0);
      expect(parts[2]!.length).toBeGreaterThan(0);
    }
  });

  it("updates source team memory after successful delegation", async () => {
    const orch = new TeamOrchestrator({ teams: [teamA, teamB] }, registry, bus);
    await orch.delegate({
      id: "test-delegation-1",
      fromTeamId: "a",
      toTeamId: "b",
      taskId: "t-memory",
      taskDescription: "do work",
      context: {},
      createdAt: new Date().toISOString(),
    });
    const ctx = orch.getTeamContext("a");
    expect(ctx).toContain("Decisions");
    expect(ctx).toContain("test-delegation-1");
    // Rationale references the target team by id ("to team \"b\"").
    expect(ctx).toContain("to team \"b\"");
  });

  it("falls back to secondary team when primary fails", async () => {
    // Target "b" has no leader registered → triggers fallback to "c".
    const registryNoB = new AgentRegistry();
    registryNoB.register({ id: "leader-a", type: "leader", receiver: async () => {} });
    registryNoB.register({ id: "leader-c", type: "leader", receiver: async () => "handled" });

    const orch = new TeamOrchestrator(
      { teams: [teamA, teamB, teamC] },
      registryNoB,
      bus,
    );
    const result = await orch.delegate({
      id: "fallback-test",
      fromTeamId: "a",
      toTeamId: "b",
      taskId: "fall",
      taskDescription: "attempt",
      context: {},
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
    expect(result.attemptedTeams[0]).toBe("b");
    expect(result.attemptedTeams).toContain("c");
    expect(result.result).toMatchObject({ toTeamId: "c" });
  });

  it("escalates when all teams exhausted", async () => {
    const events: TeamOrchestratorEvent[] = [];
    const trackingBus = new EventBus<TeamOrchestratorEvent>();
    trackingBus.subscribe((e) => events.push(e));

    // Register only the source leader; target teams' leaders are missing so
    // every delivery fails and we eventually emit team:escalation.
    const r = new AgentRegistry();
    r.register({ id: "leader-a", type: "leader", receiver: async () => {} });

    const orch = new TeamOrchestrator({ teams: [teamA, teamB] }, r, trackingBus);
    const result = await orch.delegate({
      id: "exhaust-test",
      fromTeamId: "a",
      toTeamId: "b",
      taskId: "doomed",
      taskDescription: "try",
      context: {},
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
    expect(result.attemptedTeams).toContain("b");
    const escalation = events.find((e) => e.type === "team:escalation");
    expect(escalation).toBeDefined();
    if (escalation && escalation.type === "team:escalation") {
      expect(escalation.attemptedTeams).toContain("b");
    }
  });

  it("max delegation depth prevents infinite recursion", async () => {
    const orch = new TeamOrchestrator(
      { teams: [teamA, teamB], maxDelegationDepth: 1 },
      registry,
      bus,
    );
    // depth 0 is OK, but a delegation already at the limit should be rejected
    // when received "later" with depth=1. We pass depth explicitly via a brand-new
    // request to exercise the boundary.
    const result = await orch.delegate({
      id: "depth-test",
      fromTeamId: "a",
      toTeamId: "b",
      taskId: "t",
      taskDescription: "d",
      context: {},
      createdAt: new Date().toISOString(),
      depth: 1,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("max delegation depth");
  });

  it("findCapableTeam matches task to team with matching capabilities", () => {
    const orch = new TeamOrchestrator(
      { teams: [teamA, teamB, teamC] },
      registry,
      bus,
    );
    const t = orch.findCapableTeam("need to build an api today");
    expect(t?.id).toBe("b");
    const t2 = orch.findCapableTeam("run qa pass");
    expect(t2?.id).toBe("c");
    const t3 = orchestrator_find_no_match(orch);
    expect(t3).toBeUndefined();
  });

  it("getTeamContext serializes memory into LLM-readable text", () => {
    teamA.memory.facts.push({
      id: "f1",
      content: "service uses postgres",
      observedAt: Date.now(),
    });
    teamA.memory.decisions.push({
      id: "d1",
      rationale: "use REST over GraphQL",
      decidedAt: new Date().toISOString(),
    });
    teamA.memory.modifiedFiles.push("src/api.ts");
    teamA.memory.openQuestions.push("auth strategy?");
    const orch = new TeamOrchestrator({ teams: [teamA] }, registry, bus);
    const ctx = orch.getTeamContext("a");
    expect(ctx).toContain("team-a");
    expect(ctx).toContain("postgres");
    expect(ctx).toContain("REST over GraphQL");
    expect(ctx).toContain("src/api.ts");
    expect(ctx).toContain("auth strategy?");
    expect(ctx).toContain("# Team:");
    expect(ctx).toContain("## Decisions");
    expect(ctx).toContain("## Facts");
  });

  it("compactMemory reduces older facts while keeping recent ones", async () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      teamA.memory.facts.push({
        id: `f-${i}`,
        content: `fact-${i}`,
        observedAt: now + i,
      });
    }
    const orch = new TeamOrchestrator(
      { teams: [teamA], compactKeepRecent: 3 },
      registry,
      bus,
    );
    const before = await orch.compactMemory("a");
    expect(before.facts).toHaveLength(10);
    const ctx = orch.getTeamContext("a");
    // 3 recent facts + 1 summary = 4 fact lines under "## Facts"
    const factLines = ctx
      .split("\n")
      .filter((l) => l.startsWith("- ") && l.includes("fact"))
      .length;
    expect(factLines).toBe(4); // 3 verbatim + 1 compacted digest
    expect(ctx).toContain("[compacted 7 older facts");
  });

  it("addFact and addDecision update lastUpdated timestamp", async () => {
    const orch = new TeamOrchestrator({ teams: [teamA] }, registry, bus);
    const before = teamA.memory.lastUpdated;
    // Force tick so ISO timestamps differ.
    await new Promise((r) => setTimeout(r, 5));
    orch.addFact("a", "newly observed constraint");
    expect(teamA.memory.facts.some((f) => f.content === "newly observed constraint")).toBe(true);
    expect(teamA.memory.lastUpdated).not.toBe(before);

    const afterFact = teamA.memory.lastUpdated;
    await new Promise((r) => setTimeout(r, 5));
    orch.addDecision("a", {
      id: "dec-1",
      rationale: "pick strategy X",
      decidedAt: new Date().toISOString(),
    });
    expect(teamA.memory.decisions.some((d) => d.rationale === "pick strategy X")).toBe(true);
    expect(teamA.memory.lastUpdated).not.toBe(afterFact);
  });

  it("concurrent delegation limit per team is enforced", async () => {
    teamA.maxConcurrentDelegations = 1;
    // Use a receiver that takes time, so a second in-flight delegation arrives
    // while the first is still being processed.
    let block: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { block = resolve; });

    const blockingRegistry = new AgentRegistry();
    blockingRegistry.register({
      id: "leader-a",
      type: "leader",
      receiver: async () => {},
    });
    blockingRegistry.register({
      id: "leader-b",
      type: "leader",
      receiver: async () => { await gate; },
    });
    blockingRegistry.register({
      id: "leader-c",
      type: "leader",
      receiver: async () => {},
    });

    const orch = new TeamOrchestrator(
      { teams: [teamA, teamB, teamC] },
      blockingRegistry,
      bus,
    );

    const first = orch.delegate({
      id: "cc-1",
      fromTeamId: "a",
      toTeamId: "b",
      taskId: "t1",
      taskDescription: "first",
      context: {},
      createdAt: new Date().toISOString(),
    });

    // Busy-loop briefly to let the first delegation enter its receiver.
    await new Promise((r) => setTimeout(r, 20));

    const second = await orch.delegate({
      id: "cc-2",
      fromTeamId: "a",
      toTeamId: "c",
      taskId: "t2",
      taskDescription: "second",
      context: {},
      createdAt: new Date().toISOString(),
    });
    expect(second.success).toBe(false);
    expect(second.error).toContain("maxConcurrentDelegations");

    block?.();
    await first;
  });

  it("emits events in correct order (created → complete | failed → escalation)", async () => {
    const events: TeamOrchestratorEvent[] = [];
    const trackingBus = new EventBus<TeamOrchestratorEvent>();
    trackingBus.subscribe((e) => events.push(e));

    const r = new AgentRegistry();
    r.register({ id: "leader-a", type: "leader", receiver: async () => {} });
    r.register({ id: "leader-c", type: "leader", receiver: async () => {} });

    const orch = new TeamOrchestrator(
      { teams: [teamA, teamB, teamC] },
      r,
      trackingBus,
    );
    const result = await orch.delegate({
      id: "evt-order",
      fromTeamId: "a",
      toTeamId: "b",
      taskId: "t-ev",
      taskDescription: "event check",
      context: {},
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);

    // First event must be delegation-created; last relevant must be delegation-complete.
    expect(events[0]?.type).toBe("team:delegation-created");
    const complete = events.find((e) => e.type === "team:delegation-complete");
    expect(complete).toBeDefined();

    // Now verify the failure path → escalation.
    const failEvents: TeamOrchestratorEvent[] = [];
    const failBus = new EventBus<TeamOrchestratorEvent>();
    failBus.subscribe((e) => failEvents.push(e));

    const rFail = new AgentRegistry();
    rFail.register({ id: "leader-a", type: "leader", receiver: async () => {} });

    const orchFail = new TeamOrchestrator({ teams: [teamA, teamB] }, rFail, failBus);
    await orchFail.delegate({
      id: "evt-fail",
      fromTeamId: "a",
      toTeamId: "b",
      taskId: "t-f",
      taskDescription: "fail case",
      context: {},
      createdAt: new Date().toISOString(),
    });
    expect(failEvents.some((e) => e.type === "team:delegation-created")).toBe(true);
    expect(failEvents.some((e) => e.type === "team:delegation-failed")).toBe(true);
    expect(failEvents.some((e) => e.type === "team:escalation")).toBe(true);
    // Ordering: created should precede escalation.
    const idxCreated = failEvents.findIndex((e) => e.type === "team:delegation-created");
    const idxEsc = failEvents.findIndex((e) => e.type === "team:escalation");
    expect(idxEsc).toBeGreaterThan(idxCreated);
  });
});

// Helper (kept local) — walks past the matcher intentionally to assert undefined.
function orchestrator_find_no_match(orch: TeamOrchestrator) {
  return orch.findCapableTeam("this string matches no capability tags at all");
}
