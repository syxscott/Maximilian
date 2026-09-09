/**
 * Phase 8.2 — Digital Twin CRDT undo engine tests.
 *
 * Covers:
 *   - push + inverse computation
 *   - undo returns the inverse delta
 *   - redo re-applies the delta
 *   - maxSize drops oldest entries
 *   - reverseDelta emits correct inverse types (add<->remove)
 *   - applyDelta mutates state correctly (integration)
 *   - undo after applyDelta restores previous state (integration)
 */

import { describe, it, expect } from "vitest";

import {
  DigitalTwinUndoStack,
  DigitalTwinSession,
  reverseDelta,
  DEFAULT_MAX_UNDO_SIZE,
  type TwinDelta,
  type TwinDeltaType,
} from "../src/index.js";

function delta(
  type: TwinDeltaType,
  target: string,
  before: unknown,
  after: unknown
): TwinDelta {
  return {
    type,
    target,
    before,
    after,
    at: new Date().toISOString(),
  };
}

// ── reverseDelta ──────────────────────────────────────────────────────────

describe("reverseDelta", () => {
  it("maps node:add → node:remove and flips before/after", () => {
    const d = delta("node:add", "n1", undefined, { id: "n1", role: "a" });
    const inv = reverseDelta(d);
    expect(inv.type).toBe("node:remove");
    expect(inv.target).toBe("n1");
    expect(inv.before).toEqual({ id: "n1", role: "a" }); // was after
    expect(inv.after).toBeUndefined(); // was before
  });

  it("maps node:remove → node:add, restoring the dropped value", () => {
    const d = delta("node:remove", "n1", { id: "n1", role: "a" }, undefined);
    const inv = reverseDelta(d);
    expect(inv.type).toBe("node:add");
    expect(inv.after).toEqual({ id: "n1", role: "a" }); // restore
  });

  it("maps edge:add <-> edge:remove", () => {
    const add = delta("edge:add", "e1", undefined, { from: "a", to: "b" });
    expect(reverseDelta(add).type).toBe("edge:remove");
    const rem = delta("edge:remove", "e1", { from: "a", to: "b" }, undefined);
    expect(reverseDelta(rem).type).toBe("edge:add");
  });

  it("property:set is self-inverse with swapped before/after", () => {
    const d = delta("property:set", "config.maxRetries", 3, 5);
    const inv = reverseDelta(d);
    expect(inv.type).toBe("property:set");
    expect(inv.before).toBe(5);
    expect(inv.after).toBe(3);
  });

  it("preserves traceId across the inverse", () => {
    const d = delta("node:add", "n1", undefined, { id: "n1" });
    d.traceId = "trace-abc";
    expect(reverseDelta(d).traceId).toBe("trace-abc");
  });
});

// ── DigitalTwinUndoStack (pure engine) ───────────────────────────────────

describe("DigitalTwinUndoStack", () => {
  it("pushes deltas and records a computed inverse", () => {
    const stack = new DigitalTwinUndoStack();
    const d = delta("node:add", "n1", undefined, { id: "n1" });
    stack.push(d);
    expect(stack.canUndo()).toBe(true);
    expect(stack.getHistory()).toHaveLength(1);
    expect(stack.getHistory()[0]!.type).toBe("node:add");
    expect(stack.size).toBe(1);
  });

  it("undo returns the inverse delta", () => {
    const stack = new DigitalTwinUndoStack();
    const d = delta("node:add", "n1", undefined, { id: "n1" });
    stack.push(d);
    const inv = stack.undo();
    expect(inv).toBeDefined();
    expect(inv!.type).toBe("node:remove");
    expect(inv!.target).toBe("n1");
    expect(inv!.before).toEqual({ id: "n1" });
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(true);
  });

  it("redo re-applies the delta", () => {
    const stack = new DigitalTwinUndoStack();
    const d = delta("property:set", "config.x", 1, 2);
    stack.push(d);
    stack.undo();
    const reapplied = stack.redo();
    expect(reapplied).toBeDefined();
    expect(reapplied!.type).toBe("property:set");
    expect(reapplied!.after).toBe(2);
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
  });

  it("undo on empty stack returns undefined", () => {
    const stack = new DigitalTwinUndoStack();
    expect(stack.undo()).toBeUndefined();
    expect(stack.redo()).toBeUndefined();
  });

  it("redo on fresh stack (no undo yet) returns undefined", () => {
    const stack = new DigitalTwinUndoStack();
    stack.push(delta("node:add", "n1", undefined, { id: "n1" }));
    expect(stack.redo()).toBeUndefined();
  });

  it("a new push clears the redo stack (invalidates redo history)", () => {
    const stack = new DigitalTwinUndoStack();
    stack.push(delta("node:add", "n1", undefined, { id: "n1" }));
    stack.push(delta("node:add", "n2", undefined, { id: "n2" }));
    stack.undo(); // now redoable
    expect(stack.canRedo()).toBe(true);
    stack.push(delta("node:add", "n3", undefined, { id: "n3" })); // new action
    expect(stack.canRedo()).toBe(false);
  });

  it("maxSize drops oldest entries", () => {
    const stack = new DigitalTwinUndoStack({ maxSize: 3 });
    stack.push(delta("node:add", "a", undefined, { id: "a" }));
    stack.push(delta("node:add", "b", undefined, { id: "b" }));
    stack.push(delta("node:add", "c", undefined, { id: "c" }));
    stack.push(delta("node:add", "d", undefined, { id: "d" }));
    expect(stack.size).toBe(3);
    // Oldest "a" must be dropped; remaining are b, c, d (order-preserving).
    const history = stack.getHistory().map((d) => d.target);
    expect(history).toEqual(["b", "c", "d"]);
  });

  it("respects DEFAULT_MAX_UNDO_SIZE constant", () => {
    expect(DEFAULT_MAX_UNDO_SIZE).toBeGreaterThan(0);
    const stack = new DigitalTwinUndoStack();
    expect((stack as unknown as { maxSize: number }).maxSize).toBe(DEFAULT_MAX_UNDO_SIZE);
  });

  it("clear() resets both undo and redo", () => {
    const stack = new DigitalTwinUndoStack();
    stack.push(delta("node:add", "a", undefined, { id: "a" }));
    stack.undo();
    stack.clear();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    expect(stack.size).toBe(0);
  });
});

// ── DigitalTwinSession (integration) ─────────────────────────────────────

describe("DigitalTwinSession.applyDelta", () => {
  function makeSession(): DigitalTwinSession {
    return new DigitalTwinSession({
      capabilities: [],
      blueprints: [],
      graphs: [],
    });
  }

  it("node:add stores the node payload in state", async () => {
    const s = makeSession();
    await s.applyDelta(delta("node:add", "n1", undefined, { id: "n1", role: "agent" }));
    expect(s.getState()).toHaveProperty("n1");
    expect(s.getState()["n1"]).toEqual({ id: "n1", role: "agent" });
  });

  it("edge:add stores the edge payload in state", async () => {
    const s = makeSession();
    await s.applyDelta(delta("edge:add", "e1", undefined, { from: "a", to: "b" }));
    expect(s.getState()["e1"]).toEqual({ from: "a", to: "b" });
  });

  it("property:set writes into a nested dot-path", async () => {
    const s = makeSession();
    await s.applyDelta(delta("property:set", "config.maxRetries", undefined, 3));
    const state = s.getState() as { config: { maxRetries: number } };
    expect(state.config.maxRetries).toBe(3);
  });

  it("property:set overwrites an existing value", async () => {
    const s = makeSession();
    await s.applyDelta(delta("property:set", "config.maxRetries", undefined, 3));
    await s.applyDelta(delta("property:set", "config.maxRetries", 3, 7));
    const state = s.getState() as { config: { maxRetries: number } };
    expect(state.config.maxRetries).toBe(7);
  });

  it("node:remove deletes the node from state", async () => {
    const s = makeSession();
    await s.applyDelta(delta("node:add", "n1", undefined, { id: "n1" }));
    await s.applyDelta(delta("node:remove", "n1", { id: "n1" }, undefined));
    expect(s.getState()).not.toHaveProperty("n1");
  });

  it("keeps an undo history of applied deltas", async () => {
    const s = makeSession();
    await s.applyDelta(delta("node:add", "n1", undefined, { id: "n1" }));
    await s.applyDelta(delta("property:set", "config.x", 0, 1));
    expect(s.getHistory()).toHaveLength(2);
    expect(s.canUndo()).toBe(true);
    expect(s.canRedo()).toBe(false);
  });

  it("integrates with DigitalTwin snapshot for node:add (birth proposal)", async () => {
    const s = makeSession();
    await s.applyDelta(delta("node:add", "frontend_agent", undefined, { id: "frontend_agent" }));
    const snap = s.getSnapshot();
    const ids = snap.capabilities.map((c) => c.id);
    expect(ids).toContain("frontend_agent");
  });
});

describe("DigitalTwinSession.undo (integration)", () => {
  function makeSession(): DigitalTwinSession {
    return new DigitalTwinSession({
      capabilities: [],
      blueprints: [],
      graphs: [],
    });
  }

  it("undo after node:add restores state to absent", async () => {
    const s = makeSession();
    await s.applyDelta(delta("node:add", "n1", undefined, { id: "n1" }));
    expect(s.getState()).toHaveProperty("n1");
    await s.undo();
    expect(s.getState()).not.toHaveProperty("n1");
    expect(s.canRedo()).toBe(true);
  });

  it("undo after property:set restores the previous value", async () => {
    const s = makeSession();
    await s.applyDelta(delta("property:set", "config.maxRetries", undefined, 3));
    await s.applyDelta(delta("property:set", "config.maxRetries", 3, 9));
    const before = (s.getState() as { config: { maxRetries: number } }).config.maxRetries;
    expect(before).toBe(9);
    await s.undo();
    const restored = (s.getState() as { config: { maxRetries: number } }).config.maxRetries;
    expect(restored).toBe(3);
  });

  it("undo after node:remove restores the removed payload", async () => {
    const s = makeSession();
    await s.applyDelta(delta("node:add", "n1", undefined, { id: "n1", role: "x" }));
    await s.applyDelta(delta("node:remove", "n1", { id: "n1", role: "x" }, undefined));
    expect(s.getState()).not.toHaveProperty("n1");
    await s.undo();
    expect(s.getState()["n1"]).toEqual({ id: "n1", role: "x" });
  });

  it("multi-step undo returns state to start", async () => {
    const s = makeSession();
    await s.applyDelta(delta("node:add", "a", undefined, { id: "a" }));
    await s.applyDelta(delta("node:add", "b", undefined, { id: "b" }));
    await s.applyDelta(delta("edge:add", "e1", undefined, { from: "a", to: "b" }));
    await s.undo();
    await s.undo();
    await s.undo();
    expect(s.getState()).toEqual({});
    expect(s.canUndo()).toBe(false);
  });

  it("redo reverses an undo", async () => {
    const s = makeSession();
    await s.applyDelta(delta("node:add", "n1", undefined, { id: "n1" }));
    await s.undo();
    expect(s.getState()).not.toHaveProperty("n1");
    await s.redo();
    expect(s.getState()).toHaveProperty("n1");
  });

  it("undo with no history returns undefined", async () => {
    const s = makeSession();
    expect(await s.undo()).toBeUndefined();
  });

  it("reverts snapshot state on node:add undo (birth -> retire)", async () => {
    const s = makeSession();
    await s.applyDelta(delta("node:add", "qa_agent", undefined, { id: "qa_agent" }));
    const snapAfterAdd = s.getSnapshot();
    expect(snapAfterAdd.capabilities.map((c) => c.id)).toContain("qa_agent");
    await s.undo();
    const snapAfterUndo = s.getSnapshot();
    // subject should no longer be active after the undo
    const qa = snapAfterUndo.capabilities.find((c) => c.id === "qa_agent");
    expect(qa === undefined || qa!.status === "retired").toBe(true);
  });
});
