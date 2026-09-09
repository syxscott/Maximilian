/**
 * Graph CRDT undo engine tests.
 *
 * Covers:
 *   - reverseDelta: op-type flip (add<->remove), before/after swap,
 *     connectedEdges preservation, originalOp field, node:move self-inverse
 *   - GraphUndoStack: push/undo/redo, maxSize eviction, redo invalidation
 *   - GraphController: apply + undo produces consistent graph state,
 *     connected-edge reconnect on undo, dispose clears all state
 */

import { describe, it, expect } from "vitest";

import {
  GraphUndoStack,
  GraphController,
  reverseGraphDelta as reverseDelta,
  DEFAULT_GRAPH_MAX_UNDO_SIZE as DEFAULT_MAX_UNDO_SIZE,
  type GraphOp,
  type GraphDelta,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function delta(
  id: string,
  op: GraphOp,
  target: string,
  before: unknown,
  after: unknown,
  extras: Partial<Pick<GraphDelta, "connectedEdges" | "traceId">> = {}
): GraphDelta {
  return {
    id,
    op,
    target,
    before,
    after,
    at: new Date().toISOString(),
    ...extras,
  };
}

function initGraph() {
  return { nodes: new Map<string, unknown>(), edges: new Map<string, unknown>() };
}

// ---------------------------------------------------------------------------
// reverseDelta
// ---------------------------------------------------------------------------

describe("reverseDelta", () => {
  it("reverse flips add→remove for nodes", () => {
    const d = delta("d1", "node:add", "n1", null, { id: "n1", role: "a" });
    const inv = reverseDelta(d);
    expect(inv.op).toBe("node:remove");
    expect(inv.originalOp).toBe("node:add");
    expect(inv.target).toBe("n1");
    // before/after swapped
    expect(inv.before).toEqual({ id: "n1", role: "a" });
    expect(inv.after).toBeNull();
  });

  it("reverse flips remove→add for nodes with reconnect edges", () => {
    const d = delta("d2", "node:remove", "n1", { id: "n1", role: "a" }, undefined, {
      connectedEdges: [
        { id: "e1", source: "n1", target: "n2" },
        { id: "e2", source: "n0", target: "n1" },
      ],
    });
    const inv = reverseDelta(d);
    expect(inv.op).toBe("node:add");
    expect(inv.originalOp).toBe("node:remove");
    expect(inv.after).toEqual({ id: "n1", role: "a" });
    expect(inv.before).toBeUndefined();
    expect(inv.connectedEdges).toHaveLength(2);
    expect(inv.connectedEdges!.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("reverse edge:add → edge:remove", () => {
    const d = delta("d3", "edge:add", "e1", null, { from: "a", to: "b" });
    const inv = reverseDelta(d);
    expect(inv.op).toBe("edge:remove");
    expect(inv.originalOp).toBe("edge:add");
    expect(inv.before).toEqual({ from: "a", to: "b" });
    expect(inv.after).toBeNull();
  });

  it("reverse edge:remove → edge:add", () => {
    const d = delta("d4", "edge:remove", "e1", { from: "a", to: "b" }, undefined);
    const inv = reverseDelta(d);
    expect(inv.op).toBe("edge:add");
    expect(inv.originalOp).toBe("edge:remove");
    expect(inv.after).toEqual({ from: "a", to: "b" });
    expect(inv.before).toBeUndefined();
  });

  it("reverse property:set flips before/after", () => {
    const d = delta("d5", "property:set", "cfg.maxRetries", 3, 5);
    const inv = reverseDelta(d);
    expect(inv.op).toBe("property:set");
    expect(inv.originalOp).toBe("property:set");
    expect(inv.before).toBe(5);
    expect(inv.after).toBe(3);
  });

  it("reverse node:move flips before/after (self-inverse op)", () => {
    const d = delta("d6", "node:move", "n1", { x: 0, y: 0 }, { x: 10, y: 20 });
    const inv = reverseDelta(d);
    expect(inv.op).toBe("node:move");
    expect(inv.originalOp).toBe("node:move");
    expect(inv.before).toEqual({ x: 10, y: 20 });
    expect(inv.after).toEqual({ x: 0, y: 0 });
  });

  it("does not mutate the original delta (purity)", () => {
    const d = delta("d7", "node:add", "n1", null, { id: "n1" }, {
      traceId: "t1",
    });
    const snapshot = structuredClone(d);
    reverseDelta(d);
    expect(d).toEqual(snapshot);
    expect(d.at).toBe(snapshot.at);
    expect(d.id).toBe(snapshot.id);
  });
});

// ---------------------------------------------------------------------------
// GraphUndoStack
// ---------------------------------------------------------------------------

describe("GraphUndoStack", () => {
  it("push then undo then redo round-trips", () => {
    const stack = new GraphUndoStack();
    const d = delta("d1", "node:add", "n1", null, { id: "n1" });
    stack.push(d);

    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
    expect(stack.size).toBe(1);

    const inv = stack.undo();
    expect(inv).toBeDefined();
    expect(inv!.op).toBe("node:remove");
    expect(inv!.originalOp).toBe("node:add");
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(true);

    const reapplied = stack.redo();
    expect(reapplied).toBeDefined();
    expect(reapplied!.op).toBe("node:add");
    expect(reapplied!.target).toBe("n1");
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
  });

  it("connectedEdges preserved on node:remove → node:add", () => {
    const stack = new GraphUndoStack();
    const edges = [
      { id: "e1", source: "n1", target: "n2" },
      { id: "e2", source: "n2", target: "n1" },
    ];
    const d = delta("d1", "node:remove", "n1", { id: "n1" }, null, {
      connectedEdges: edges,
    });
    stack.push(d);

    const inv = stack.undo();
    expect(inv).toBeDefined();
    expect(inv!.op).toBe("node:add");
    expect(inv!.connectedEdges).toEqual(edges);
    // reversed delta must have its own copy (safety contract)
    expect(inv!.connectedEdges).not.toBe(edges);
  });

  it("maxSize drops oldest entries", () => {
    const stack = new GraphUndoStack({ maxSize: 3 });
    stack.push(delta("a", "node:add", "a", null, { id: "a" }));
    stack.push(delta("b", "node:add", "b", null, { id: "b" }));
    stack.push(delta("c", "node:add", "c", null, { id: "c" }));
    stack.push(delta("d", "node:add", "d", null, { id: "d" }));
    expect(stack.size).toBe(3);
    const ids = stack.getHistory().map((d) => d.target);
    expect(ids).toEqual(["b", "c", "d"]);
  });

  it("uses DEFAULT_MAX_UNDO_SIZE when no maxSize given", () => {
    expect(DEFAULT_MAX_UNDO_SIZE).toBe(50);
    const stack = new GraphUndoStack();
    for (let i = 0; i < DEFAULT_MAX_UNDO_SIZE + 10; i++) {
      stack.push(delta(`id-${i}`, "node:add", `n${i}`, null, { id: `n${i}` }));
    }
    expect(stack.size).toBe(DEFAULT_MAX_UNDO_SIZE);
  });

  it("new push after undo clears redo stack", () => {
    const stack = new GraphUndoStack();
    stack.push(delta("a", "node:add", "a", null, { id: "a" }));
    stack.push(delta("b", "node:add", "b", null, { id: "b" }));
    stack.undo();
    expect(stack.canRedo()).toBe(true);
    stack.push(delta("c", "node:add", "c", null, { id: "c" }));
    expect(stack.canRedo()).toBe(false);
  });

  it("canUndo/canRedo after various operations", () => {
    const stack = new GraphUndoStack();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);

    stack.push(delta("a", "node:add", "a", null, { id: "a" }));
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);

    stack.undo();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(true);

    stack.redo();
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
  });

  it("undo on empty stack returns undefined", () => {
    const stack = new GraphUndoStack();
    expect(stack.undo()).toBeUndefined();
    expect(stack.redo()).toBeUndefined();
  });

  it("dispose clears all state", () => {
    const stack = new GraphUndoStack();
    stack.push(delta("a", "node:add", "a", null, { id: "a" }));
    stack.push(delta("b", "node:add", "b", null, { id: "b" }));
    stack.undo();
    stack.dispose();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    expect(stack.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GraphController (integration)
// ---------------------------------------------------------------------------

describe("GraphController.apply + undo", () => {
  it("GraphController.apply + undo produces consistent graph state", () => {
    const c = new GraphController(initGraph());
    c.apply(delta("d1", "node:add", "n1", null, { id: "n1", role: "a" }));
    c.apply(delta("d2", "edge:add", "e1", null, { from: "n1", to: "n2" }));

    const g1 = c.graph;
    expect(g1.nodes.has("n1")).toBe(true);
    expect(g1.edges.has("e1")).toBe(true);

    // undo edge:add
    c.undo();
    const g2 = c.graph;
    expect(g2.edges.has("e1")).toBe(false);
    expect(g2.nodes.has("n1")).toBe(true);

    // undo node:add
    c.undo();
    const g3 = c.graph;
    expect(g3.nodes.has("n1")).toBe(false);
    expect(g3.edges.has("e1")).toBe(false);

    // redo both
    c.redo();
    c.redo();
    const g4 = c.graph;
    expect(g4.nodes.has("n1")).toBe(true);
    expect(g4.edges.has("e1")).toBe(true);
  });

  it("node:remove undo reconnects captured edges", () => {
    const c = new GraphController(initGraph());
    c.apply(delta("d1", "node:add", "n1", null, { id: "n1" }));
    c.apply(delta("d2", "node:add", "n2", null, { id: "n2" }));
    c.apply(delta("d3", "edge:add", "e1", null, { id: "e1", source: "n1", target: "n2" }));
    c.apply(delta("d4", "edge:add", "e2", null, { id: "e2", source: "n2", target: "n1" }));

    // now remove n1; capture incident edges e1 & e2
    c.apply(
      delta("d5", "node:remove", "n1", { id: "n1" }, null, {
        connectedEdges: [
          { id: "e1", source: "n1", target: "n2" },
          { id: "e2", source: "n2", target: "n1" },
        ],
      })
    );

    const g1 = c.graph;
    expect(g1.nodes.has("n1")).toBe(false);
    // edges survived in state (forward path doesn't prune them; only undo reconnects them back)

    c.undo();
    const g2 = c.graph;
    expect(g2.nodes.has("n1")).toBe(true);
    expect(g2.edges.has("e1")).toBe(true);
    expect(g2.edges.has("e2")).toBe(true);
  });

  it("dispose clears all state", () => {
    const c = new GraphController(initGraph());
    c.apply(delta("d1", "node:add", "n1", null, { id: "n1" }));
    c.apply(delta("d2", "edge:add", "e1", null, { from: "n1", to: "n2" }));
    expect(c.canUndo()).toBe(true);

    c.dispose();
    expect(c.canUndo()).toBe(false);
    expect(c.canRedo()).toBe(false);
    expect(c.graph.nodes.size).toBe(0);
    expect(c.graph.edges.size).toBe(0);
  });

  it("redo invalidation on new apply", () => {
    const c = new GraphController(initGraph());
    c.apply(delta("d1", "node:add", "n1", null, { id: "n1" }));
    c.undo();
    expect(c.canRedo()).toBe(true);
    c.apply(delta("d2", "node:add", "n2", null, { id: "n2" }));
    expect(c.canRedo()).toBe(false);
  });
});
