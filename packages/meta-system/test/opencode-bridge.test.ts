/**
 * Phase 3a — MetaSystemOpencodeBridge tests.
 *
 * Wires a real EventBridge (backed by a no-op mock SDK) into the
 * MetaSystemOpencodeBridge, then feeds mapped events through the SDK
 * to verify the per-team state table and the onReplan hook behave as
 * expected.
 *
 * Coverage:
 *   - start/stop lifecycle
 *   - session.created registers a team and seeds capabilities
 *   - session.compacted updates TruthAudit window
 *   - session.error flips status to degraded and triggers replan at
 *     the error threshold
 *   - session.idle marks the task as completed
 *   - plugin.added registers a new capability across all known teams
 *   - getTeamState / getAllTeamStates reflect the latest state
 *   - existing teams are pre-seeded on construction
 *
 * The OpencodeDigitalTwin is covered with separate `describe` blocks at
 * the bottom — it has no EventBridge dependency, so we exercise it
 * directly with a mock executor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventStore, type Team } from "@max/core";
import {
  EventBridge,
  type EventBridgeSdk,
  type OpencodeEvent,
  type MappedEventInfo,
} from "@max/core-thin-sdk";

import {
  MetaSystemOpencodeBridge,
  OpencodeDigitalTwin,
  type BridgeTeamStatus,
  type SimulationOutcome,
  type OpencodeExecutorLike,
} from "../src/index.js";

// ── Event pump helper ──────────────────────────────────────────────────────

interface EventPump {
  iterable: AsyncIterable<OpencodeEvent>;
  push: (e: OpencodeEvent) => void;
  end: () => void;
}

function makeEventPump(signal?: AbortSignal): EventPump {
  const queue: OpencodeEvent[] = [];
  let resolver: ((v: IteratorResult<OpencodeEvent>) => void) | null = null;
  let ended = signal?.aborted ?? false;
  signal?.addEventListener("abort", () => { ended = true; }, { once: true });

  const iterable: AsyncIterable<OpencodeEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next: (): Promise<IteratorResult<OpencodeEvent>> => {
          if (ended) {
            return Promise.resolve({ value: undefined as unknown as OpencodeEvent, done: true });
          }
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          return new Promise<IteratorResult<OpencodeEvent>>((resolve) => {
            resolver = resolve;
          });
        },
      };
    },
  };

  return {
    iterable,
    push: (e) => {
      if (ended) return;
      if (resolver) {
        const r = resolver;
        resolver = null;
        r({ value: e, done: false });
        return;
      }
      queue.push(e);
    },
    end: () => {
      ended = true;
      if (resolver) {
        const r = resolver;
        resolver = null;
        r({ value: undefined as unknown as OpencodeEvent, done: true });
      }
    },
  };
}

function makeSdk(): { sdk: EventBridgeSdk; pumps: EventPump[] } {
  const pumps: EventPump[] = [];
  const sdk: EventBridgeSdk = {
    subscribeEvents(_q, signal) {
      const pump = makeEventPump(signal);
      pumps.push(pump);
      return pump.iterable;
    },
  };
  return { sdk, pumps };
}

const tick = (ms = 20): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  pred: () => boolean,
  timeoutMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await tick();
  }
  throw new Error(`waitFor: predicate did not become true within ${timeoutMs}ms`);
}

function opencodeEvent(type: string, data: Record<string, unknown> = {}): OpencodeEvent {
  return { id: `evt-${Math.random().toString(36).slice(2, 8)}`, type, data };
}

// ── Test setup ─────────────────────────────────────────────────────────────

describe("MetaSystemOpencodeBridge", () => {
  let store: EventStore;
  let eventBridge: EventBridge;
  let pumps: EventPump[];
  let existingTeams: Map<string, Team>;
  let bridge: MetaSystemOpencodeBridge;
  const bridges: EventBridge[] = [];

  beforeEach(() => {
    store = new EventStore();
    const { sdk, pumps: p } = makeSdk();
    pumps = p;
    eventBridge = new EventBridge({
      sdk,
      eventStore: store,
      workspaceId: "ws-test",
    });
    bridges.push(eventBridge);
    existingTeams = new Map<string, Team>([
      [
        "team-seeded",
        {
          id: "team-seeded",
          name: "seeded",
          leaderId: "lead-seeded",
          specialistIds: ["spec-seeded"],
          capabilities: ["seeded-cap"],
          memory: {
            facts: [],
            decisions: [],
            modifiedFiles: [],
            openQuestions: [],
            lastUpdated: new Date().toISOString(),
          },
        },
      ],
    ]);
  });

  afterEach(async () => {
    if (bridge) bridge.stop();
    for (const b of bridges) {
      if (b.getState() !== "stopped") {
        await b.stop().catch(() => {
          /* swallow */
        });
      }
    }
  });

  // ── Lifecycle ───────────────────────────────────────────────────────

  it("start() subscribes and stop() unsubscribes", async () => {
    bridge = new MetaSystemOpencodeBridge({
      eventBridge,
      eventStore: store,
      existingTeams,
    });

    expect(bridge.isRunning()).toBe(false);
    bridge.start();
    expect(bridge.isRunning()).toBe(true);

    bridge.stop();
    expect(bridge.isRunning()).toBe(false);
  });

  it("start() is idempotent", () => {
    bridge = new MetaSystemOpencodeBridge({
      eventBridge,
      eventStore: store,
      existingTeams,
    });
    bridge.start();
    bridge.start(); // no-op
    expect(bridge.isRunning()).toBe(true);
    bridge.stop();
  });

  it("constructor seeds existingTeams into the state table", () => {
    bridge = new MetaSystemOpencodeBridge({
      eventBridge,
      eventStore: store,
      existingTeams,
    });
    const state = bridge.getTeamState("team-seeded");
    expect(state).toBeDefined();
    expect(state?.status).toBe("active");
    expect(state?.capabilities).toContain("seeded-cap");
    expect(state?.team?.id).toBe("team-seeded");
  });

  // ── session.created ─────────────────────────────────────────────────

  it("registers a new team on session.created", async () => {
    bridge = new MetaSystemOpencodeBridge({
      eventBridge,
      eventStore: store,
      existingTeams,
    });
    bridge.start();
    await eventBridge.start();
    // The pump is now active; push a session.created event.
    const pump = pumps[pumps.length - 1]!;
    pump.push(
      opencodeEvent("session.created", {
        sessionID: "ses_new",
        agent: "review",
        capabilities: ["review", "qa"],
      }),
    );

    await waitFor(() => bridge.getTeamState("ses_new") !== undefined);
    const state = bridge.getTeamState("ses_new")!;
    expect(state.status).toBe("active");
    expect(state.capabilities).toEqual(expect.arrayContaining(["review", "qa"]));
    expect(state.lastSessionId).toBe("ses_new");

    // A derived event is appended to the EventStore.
    const events = store.getEvents("ses_new");
    expect(events.some((e) => e.type === "team:session-created")).toBe(true);

    pump.end();
  });

  // ── session.compacted ──────────────────────────────────────────────

  it("records a truth-audit window shift on session.compacted", async () => {
    bridge = new MetaSystemOpencodeBridge({
      eventBridge,
      eventStore: store,
      existingTeams,
    });
    bridge.start();
    await eventBridge.start();
    const pump = pumps[pumps.length - 1]!;

    pump.push(opencodeEvent("session.compacted", { sessionID: "ses_c1" }));
    await waitFor(() => bridge.getTeamState("ses_c1")?.compactionCount === 1);
    pump.push(opencodeEvent("session.compacted", { sessionID: "ses_c1" }));
    await waitFor(() => bridge.getTeamState("ses_c1")?.compactionCount === 2);

    const state = bridge.getTeamState("ses_c1")!;
    expect(state.compactionCount).toBe(2);

    const events = store.getEvents("ses_c1");
    expect(events.filter((e) => e.type === "truth-audit:window-shifted").length).toBe(2);

    pump.end();
  });

  // ── session.error ──────────────────────────────────────────────────

  it("flips team to degraded and triggers replan at threshold", async () => {
    const onReplan = vi.fn();
    bridge = new MetaSystemOpencodeBridge({
      eventBridge,
      eventStore: store,
      existingTeams,
      onReplan,
      errorThreshold: 2,
    });
    bridge.start();
    await eventBridge.start();
    const pump = pumps[pumps.length - 1]!;

    pump.push(opencodeEvent("session.error", { sessionID: "ses_e1", error: "boom" }));
    await waitFor(() => bridge.getTeamState("ses_e1")?.errorCount === 1);
    expect(onReplan).not.toHaveBeenCalled();
    expect(bridge.getTeamState("ses_e1")?.status).toBe("degraded");

    pump.push(opencodeEvent("session.error", { sessionID: "ses_e1", error: "boom2" }));
    await waitFor(() => onReplan.mock.calls.length === 1);
    expect(onReplan).toHaveBeenCalledWith({
      teamId: "ses_e1",
      reason: expect.stringContaining("errorCount 2 >= threshold 2"),
    });
    expect(bridge.getTeamState("ses_e1")?.errorCount).toBe(2);
    expect(bridge.getTeamState("ses_e1")?.lastError).toBe("boom2");

    pump.end();
  });

  it("does not throw when onReplan callback itself throws", async () => {
    const onReplan = vi.fn(() => {
      throw new Error("replan-hook-broken");
    });
    // Suppress the warning so the test output stays clean.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    bridge = new MetaSystemOpencodeBridge({
      eventBridge,
      eventStore: store,
      existingTeams,
      onReplan,
      errorThreshold: 1,
    });
    bridge.start();
    await eventBridge.start();
    const pump = pumps[pumps.length - 1]!;
    pump.push(opencodeEvent("session.error", { sessionID: "ses_x", error: "fail" }));
    await waitFor(() => onReplan.mock.calls.length === 1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    pump.end();
  });

  // ── session.idle ───────────────────────────────────────────────────

  it("marks task complete on session.idle", async () => {
    bridge = new MetaSystemOpencodeBridge({
      eventBridge,
      eventStore: store,
      existingTeams,
    });
    bridge.start();
    await eventBridge.start();
    const pump = pumps[pumps.length - 1]!;

    pump.push(opencodeEvent("session.idle", { sessionID: "ses_i1" }));
    await waitFor(() => bridge.getTeamState("ses_i1")?.status === "completed");
    const state = bridge.getTeamState("ses_i1")!;
    expect(state.completionCount).toBe(1);
    const events = store.getEvents("ses_i1");
    expect(events.some((e) => e.type === "team:task-completed")).toBe(true);

    pump.end();
  });

  // ── plugin.added ───────────────────────────────────────────────────

  it("registers a plugin capability across all known teams", async () => {
    bridge = new MetaSystemOpencodeBridge({
      eventBridge,
      eventStore: store,
      existingTeams,
    });
    bridge.start();
    await eventBridge.start();
    const pump = pumps[pumps.length - 1]!;

    // Add a fresh team first via session.created.
    pump.push(opencodeEvent("session.created", { sessionID: "ses_p1", agent: "frontend" }));
    await waitFor(() => bridge.getTeamState("ses_p1") !== undefined);

    // Now register a plugin.
    pump.push(opencodeEvent("plugin.added", { name: "lint-bot", role: "lint" }));
    await waitFor(() => {
      const s = bridge.getTeamState("team-seeded");
      return s?.pluginCapabilities.includes("lint") ?? false;
    });

    const seeded = bridge.getTeamState("team-seeded");
    const fresh = bridge.getTeamState("ses_p1");
    expect(seeded?.pluginCapabilities).toContain("lint");
    expect(fresh?.pluginCapabilities).toContain("lint");

    pump.end();
  });

  // ── Queries ───────────────────────────────────────────────────────

  it("getAllTeamStates returns a snapshot of all known teams", async () => {
    bridge = new MetaSystemOpencodeBridge({
      eventBridge,
      eventStore: store,
      existingTeams,
    });
    bridge.start();
    await eventBridge.start();
    const pump = pumps[pumps.length - 1]!;

    pump.push(opencodeEvent("session.created", { sessionID: "ses_a" }));
    pump.push(opencodeEvent("session.created", { sessionID: "ses_b" }));
    await waitFor(() => bridge.size() === 3);
    const all = bridge.getAllTeamStates();
    const ids = all.map((s) => s.teamId).sort();
    expect(ids).toEqual(["ses_a", "ses_b", "team-seeded"]);

    pump.end();
  });

  // ── Filtering of unmapped events ───────────────────────────────────

  it("ignores event types outside the handled set", async () => {
    bridge = new MetaSystemOpencodeBridge({
      eventBridge,
      eventStore: store,
      existingTeams,
    });
    bridge.start();
    await eventBridge.start();
    const pump = pumps[pumps.length - 1]!;

    // This event type isn't in HANDLED_OPENCODE_TYPES, so the bridge
    // should ignore it (state unchanged).
    pump.push(opencodeEvent("message.updated", { sessionID: "ses_ignore" }));
    await tick(50);
    expect(bridge.getTeamState("ses_ignore")).toBeUndefined();
    expect(bridge.size()).toBe(1); // only the seeded team

    pump.end();
  });

  // ── Bridge <-> EventBridge interaction ─────────────────────────────

  it("forwards the MappedEventInfo callback to subscribers", () => {
    // Direct unit test: verify the EventBridge.subscribe() returns a
    // working unsubscribe handle and the callback receives the right
    // payload shape. This is the contract MetaSystemOpencodeBridge
    // depends on.
    const received: MappedEventInfo[] = [];
    const unsubscribe = eventBridge.subscribe((info) => received.push(info));
    expect(typeof unsubscribe).toBe("function");

    // Emit by hand via the underlying EventEmitter (the bridge inherits
    // from EventEmitter in event-bridge.ts).
    const draft = { type: "session:idle", aggregateId: "ses_x", data: {} };
    const sourceEvent: OpencodeEvent = { type: "session.idle", data: { sessionID: "ses_x" } };
    eventBridge.emit("mapped", {
      opencodeType: "session.idle",
      sourceEvent,
      draft,
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.opencodeType).toBe("session.idle");
    expect(received[0]?.draft.aggregateId).toBe("ses_x");
    unsubscribe();
    eventBridge.emit("mapped", { opencodeType: "x", sourceEvent, draft });
    expect(received).toHaveLength(1); // not called again
  });
});

// ── OpencodeDigitalTwin tests ──────────────────────────────────────────────

describe("OpencodeDigitalTwin", () => {
  it("simulate returns a successful outcome with the mock executor", async () => {
    const twin = new OpencodeDigitalTwin({
      tokensPerStep: 100,
      now: () => new Date("2026-08-06T00:00:00Z"),
      idGenerator: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
    });
    const out = await twin.simulate({
      teamId: "team-x",
      scenario: "add a planner agent",
      maxSteps: 3,
    });
    expect(out.teamId).toBe("team-x");
    expect(out.scenario).toBe("add a planner agent");
    expect(out.success).toBe(true);
    expect(out.estimatedTokenCost).toBe(300); // 3 * 100
    expect(out.steps).toBe(3);
    expect(out.startedAt).toBe("2026-08-06T00:00:00.000Z");
    expect(out.completedAt).toBe("2026-08-06T00:00:00.000Z");
    expect(out.mocked).toBe(true);
    expect(out.failure).toBeUndefined();
  });

  it("simulate flags failure when failureProbability triggers", async () => {
    let calls = 0;
    const twin = new OpencodeDigitalTwin({
      tokensPerStep: 50,
      failureProbability: 1, // always fail at first step
      rng: () => {
        calls += 1;
        return 0; // < 1 → trigger
      },
      idGenerator: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
    });
    const out = await twin.simulate({
      teamId: "team-y",
      scenario: "risky change",
      maxSteps: 5,
    });
    expect(out.success).toBe(false);
    expect(out.failure).toBeDefined();
    expect(out.failure?.atStep).toBe(1);
    expect(out.failure?.reason).toMatch(/random failure at step 1/);
    expect(out.steps).toBe(1);
  });

  it("simulate caps maxSteps to a sane upper bound", async () => {
    const twin = new OpencodeDigitalTwin({
      tokensPerStep: 1,
      now: () => new Date("2026-08-06T00:00:00Z"),
      idGenerator: () => "id",
    });
    const out = await twin.simulate({
      teamId: "team-z",
      scenario: "huge",
      maxSteps: 999_999,
    });
    // Capped at 1000.
    expect(out.steps).toBe(1000);
  });

  it("simulate rejects empty teamId / scenario", async () => {
    const twin = new OpencodeDigitalTwin({ idGenerator: () => "id" });
    await expect(
      twin.simulate({ teamId: "", scenario: "x", maxSteps: 1 }),
    ).rejects.toThrow(/teamId/);
    await expect(
      twin.simulate({ teamId: "t", scenario: "", maxSteps: 1 }),
    ).rejects.toThrow(/scenario/);
  });

  it("simulate uses the injected executor when provided", async () => {
    let called = 0;
    const exec: OpencodeExecutorLike = {
      async executeTask(task, workspaceId) {
        called += 1;
        return {
          result: {
            id: `r-${task.id}`,
            taskId: task.id,
            agentRole: "general",
            agentId: "test-executor",
            output: `real ${task.description}`,
            metadata: { workspaceId },
            createdAt: new Date().toISOString(),
            durationMs: 0,
          },
          sessionId: `real-${workspaceId}`,
          durationMs: 0,
        };
      },
    };
    const twin = new OpencodeDigitalTwin({
      executor: exec,
      idGenerator: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
    });
    const out = await twin.simulate({
      teamId: "ws-real",
      scenario: "use the real executor",
      maxSteps: 2,
    });
    expect(called).toBe(1);
    expect(out.mocked).toBe(false);
    expect(out.artifacts[0]).toBe("session:real-ws-real");
  });

  it("simulateWithTrace produces a per-step trace with the right length", async () => {
    const twin = new OpencodeDigitalTwin({
      tokensPerStep: 25,
      idGenerator: () => "id",
    });
    const { outcome, trace } = await twin.simulateWithTrace({
      teamId: "t",
      scenario: "trace",
      maxSteps: 4,
    });
    expect(trace).toHaveLength(4);
    expect(trace[0]?.index).toBe(0);
    expect(trace[3]?.index).toBe(3);
    expect(trace[0]?.tokens).toBe(25);
    expect(outcome.success).toBe(true);
  });

  it("propagates executor failure as a step-0 failure", async () => {
    const exec: OpencodeExecutorLike = {
      async executeTask() {
        throw new Error("executor is down");
      },
    };
    const twin = new OpencodeDigitalTwin({ executor: exec, idGenerator: () => "id" });
    const out: SimulationOutcome = await twin.simulate({
      teamId: "t",
      scenario: "broken",
      maxSteps: 5,
    });
    expect(out.success).toBe(false);
    expect(out.failure?.atStep).toBe(0);
    expect(out.failure?.reason).toBe("executor is down");
    expect(out.steps).toBe(0);
  });
});
