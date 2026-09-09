/**
 * Graph CRDT-style undo engine.
 *
 * Borrowed from voicetree/packages/libraries/graph-model/src/pure/graph/undo/undoStack.ts
 *   - CRDT-style inverse computation (swap before/after + map add<->remove)
 *   - reconnect semantics: node:remove preserves connected edges so that undo
 *     can restore the node AND its incident edges in one step
 *   - undo/redo stacks with redo-invalidates-on-new-action semantics
 *   - bounded MAX_UNDO_SIZE with oldest-drop eviction
 *   - pure-function `reverseDelta` (never mutates its input)
 */

// ============================================================================
// GraphOp / GraphDelta / GraphDeltaReverse
// ============================================================================

export type GraphOp =
  | "node:add"
  | "node:remove"
  | "node:move"
  | "edge:add"
  | "edge:remove"
  | "property:set";

/** A single reversible graph mutation. */
export interface GraphDelta {
  /** Unique delta id. */
  id: string;
  op: GraphOp;
  /** Node or edge id acted upon. */
  target: string;
  /** Value before the op (for rollback). */
  before: unknown;
  /** Value after the op. */
  after: unknown;
  /**
   * Associated edges captured at node:remove time so that undo (node:add) can
   * restore the dropped edges ("reconnect" semantics).
   */
  connectedEdges?: Array<{ id: string; source: string; target: string }>;
  /** ISO timestamp of when the delta was produced. */
  at: string;
  /** Optional trace id for debugging / audit. */
  traceId?: string;
}

/**
 * The inverse of a {@link GraphDelta}: applying this delta to a graph state
 * restores the state that existed *before* the original delta was applied.
 */
export interface GraphDeltaReverse extends GraphDelta {
  /** The op type of the delta that produced this reverse. */
  originalOp: GraphOp;
}

// ============================================================================
// Inverse-type mapping: add <-> remove; node:move / property:set are self-inverse
// ============================================================================

const INVERSE_OP: Readonly<Record<GraphOp, GraphOp>> = {
  "node:add": "node:remove",
  "node:remove": "node:add",
  "node:move": "node:move",
  "edge:add": "edge:remove",
  "edge:remove": "edge:add",
  "property:set": "property:set",
};

// ============================================================================
// reverseDelta — compute the exact inverse of a delta (pure function)
// ============================================================================

/**
 * Returns a new delta that, when applied, undoes the original.
 *
 * Semantics:
 *   - `op` is mapped through the inverse-type table (add<->remove, move self).
 *   - `before`/`after` are always swapped — so that applying the inverse
 *     restores the prior graph state.
 *   - For `node:remove` (original.before holds the removed payload +
 *     `connectedEdges` holds incident edges), the inverse is `node:add` with
 *     `after` = the removed payload and `connectedEdges` preserved — undo
 *     restores both the node AND its incident edges ("reconnect").
 *   - For `node:add`, the inverse is `node:remove` with `before` = the added
 *     payload — correct drop.
 *   - `connectedEdges` is copied verbatim to the reversed delta so a later
 *     re-remove (redo of the original remove) can again refer to them.
 *
 * This function is pure: it never mutates `delta`.
 */
export function reverseDelta(delta: GraphDelta): GraphDeltaReverse {
  const inverseOp = INVERSE_OP[delta.op];
  return {
    id: delta.id,
    op: inverseOp,
    target: delta.target,
    // swap before/after
    before: delta.after,
    after: delta.before,
    // shallow-copy the holder so the reversed delta has its own array reference
    // (the inner edge records are treated as immutable value objects)
    connectedEdges: delta.connectedEdges
      ? delta.connectedEdges.slice()
      : undefined,
    at: new Date().toISOString(),
    traceId: delta.traceId,
    originalOp: delta.op,
  };
}

// ============================================================================
// GraphUndoStack — CRDT undo/redo engine
// ============================================================================

export interface GraphUndoStackOptions {
  /** Beyond this, oldest entries are dropped. Defaults to 50. */
  maxSize?: number;
}

export const DEFAULT_MAX_UNDO_SIZE = 50;

/** Internal bookkeeping entry pairing a delta with its precomputed inverse. */
interface UndoEntry {
  delta: GraphDelta;
  inverse: GraphDeltaReverse;
}

export class GraphUndoStack {
  private readonly entries: UndoEntry[] = [];
  private readonly redoStack: UndoEntry[] = [];
  private readonly maxSize: number;

  constructor(options: GraphUndoStackOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_UNDO_SIZE;
  }

  /**
   * Compute the inverse of `delta`, push both onto the undo stack, and clear
   * the redo stack (new-action-invalidate-redo semantics).
   */
  push(delta: GraphDelta): void {
    const entry: UndoEntry = {
      delta,
      inverse: reverseDelta(delta),
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxSize) {
      this.entries.shift(); // drop oldest
    }
    this.redoStack.length = 0;
  }

  /**
   * Pop the last entry from the undo stack and move it to the redo stack.
   * Returns the inverse delta to apply so the change undoes — or undefined
   * when the undo stack is empty.
   */
  undo(): GraphDeltaReverse | undefined {
    const entry = this.entries.pop();
    if (!entry) return undefined;
    this.redoStack.push(entry);
    return entry.inverse;
  }

  /**
   * Pop the last undone entry from the redo stack and re-push it onto the
   * undo stack. Returns the forward delta to apply — or undefined when the
   * redo stack is empty.
   */
  redo(): GraphDelta | undefined {
    const entry = this.redoStack.pop();
    if (!entry) return undefined;
    this.entries.push(entry);
    return entry.delta;
  }

  canUndo(): boolean {
    return this.entries.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Forward-history of applied deltas (oldest first). */
  getHistory(): ReadonlyArray<GraphDelta> {
    return this.entries.map((e) => e.delta);
  }

  /** Clear both undo and redo stacks. */
  clear(): void {
    this.entries.length = 0;
    this.redoStack.length = 0;
  }

  /** Alias of {@link clear}; releases all internal state. */
  dispose(): void {
    this.clear();
  }

  /** Number of undoable entries. */
  get size(): number {
    return this.entries.length;
  }

  /** Number of redoable entries. */
  get redoSize(): number {
    return this.redoStack.length;
  }
}

// ============================================================================
// GraphController — high-level mutable graph + undo/redo
// ============================================================================

/**
 * Snapshot of the controlled graph. Two `Map`s keyed by node/edge id whose
 * values are the user-supplied payloads.
 */
export interface GraphSnapshot {
  nodes: Map<string, unknown>;
  edges: Map<string, unknown>;
}

/**
 * High-level API over a mutable graph state. Calling `apply` mutates the
 * graph *and* pushes the delta onto an internal undo stack. `undo`/`redo`
 * apply the corresponding inverse/forward delta to the graph state in place.
 *
 * The controller does NOT deep-clone the stored payloads: values placed into
 * `nodes`/`edges` are stored by reference and must be treated as immutable by
 * the caller for the CRDT inverse math to stay accurate.
 */
export class GraphController {
  private readonly undoStack: GraphUndoStack;
  private nodes: Map<string, unknown>;
  private edges: Map<string, unknown>;

  constructor(initial: GraphSnapshot, options: GraphUndoStackOptions = {}) {
    this.nodes = new Map(initial.nodes);
    this.edges = new Map(initial.edges);
    this.undoStack = new GraphUndoStack(options);
  }

  // -------------------------------------------------------------------------
  // Mutation helpers (used by apply / undo / redo)
  // -------------------------------------------------------------------------

  private writeNode(id: string, value: unknown): void {
    if (value === undefined || value === null) {
      this.nodes.delete(id);
    } else {
      this.nodes.set(id, value);
    }
  }

  private writeEdge(id: string, value: unknown): void {
    if (value === undefined || value === null) {
      this.edges.delete(id);
    } else {
      this.edges.set(id, value);
    }
  }

  /** Forward-apply a delta to the in-memory graph. */
  private applyForward(delta: GraphDelta): void {
    switch (delta.op) {
      case "node:add":
        this.writeNode(delta.target, delta.after);
        break;
      case "node:remove":
        this.nodes.delete(delta.target);
        break;
      case "node:move":
        // `after` is the new position/state; overwrite whatever is stored.
        this.writeNode(delta.target, delta.after);
        break;
      case "edge:add":
        this.writeEdge(delta.target, delta.after);
        break;
      case "edge:remove":
        this.edges.delete(delta.target);
        break;
      case "property:set":
        this.applyProperty(delta.target, delta.after);
        break;
    }
  }

  /**
   * Inverse-apply a reversed delta to the in-memory graph.
   *
   * Because {@link reverseDelta} swaps before/after, `reverse.after` is the
   * value that was present *before* the original delta applied — which is
   * what we want to restore. For node:add (inverse of a node:remove) we
   * also reconnect the incident edges listed in `connectedEdges`.
   */
  private applyInverse(reverse: GraphDeltaReverse): void {
    switch (reverse.op) {
      case "node:add": {
        // inverse of node:remove: restore the node payload and reconnect edges
        this.writeNode(reverse.target, reverse.after);
        if (reverse.connectedEdges) {
          for (const e of reverse.connectedEdges) {
            this.edges.set(e.id, { id: e.id, source: e.source, target: e.target });
          }
        }
        break;
      }
      case "node:remove":
        // inverse of node:add: drop the node
        this.nodes.delete(reverse.target);
        break;
      case "node:move":
        // symmetric: restore original.before position
        this.writeNode(reverse.target, reverse.after);
        break;
      case "edge:add":
        // inverse of edge:remove: restore the edge
        this.writeEdge(reverse.target, reverse.after);
        break;
      case "edge:remove":
        // inverse of edge:add: drop the edge
        this.edges.delete(reverse.target);
        break;
      case "property:set":
        this.applyProperty(reverse.target, reverse.after);
        break;
    }
  }

  /**
   * Apply a property set. `target` is a dotted path "<ownerId>.<rest>"
   * where ownerId resolves to either a node or an edge. Missing owners are
   * no-ops (matching delta semantics: the property:value write is stored on
   * the owner, not the graph).
   */
  private applyProperty(target: string, value: unknown): void {
    const dot = target.indexOf(".");
    if (dot < 0) {
      // No dot path — fall back to treating target as a node id.
      this.writeNode(target, value);
      return;
    }
    const ownerId = target.slice(0, dot);
    const prop = target.slice(dot + 1);
    const node = this.nodes.get(ownerId);
    if (node !== undefined && node !== null && typeof node === "object") {
      (node as Record<string, unknown>)[prop] = value;
      return;
    }
    const edge = this.edges.get(ownerId);
    if (edge !== undefined && edge !== null && typeof edge === "object") {
      (edge as Record<string, unknown>)[prop] = value;
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Apply `delta` to the graph and push it onto the undo stack (clearing redo).
   */
  apply(delta: GraphDelta): void {
    this.applyForward(delta);
    this.undoStack.push(delta);
  }

  /**
   * Undo the most recent delta, mutating the graph state. Returns the inverse
   * delta applied, or undefined when there is nothing to undo.
   */
  undo(): GraphDeltaReverse | undefined {
    const reverse = this.undoStack.undo();
    if (!reverse) return undefined;
    this.applyInverse(reverse);
    return reverse;
  }

  /**
   * Redo the most recently undone delta, mutating the graph state. Returns the
   * forward delta applied, or undefined when there is nothing to redo.
   */
  redo(): GraphDelta | undefined {
    const delta = this.undoStack.redo();
    if (!delta) return undefined;
    this.applyForward(delta);
    return delta;
  }

  canUndo(): boolean {
    return this.undoStack.canUndo();
  }

  canRedo(): boolean {
    return this.undoStack.canRedo();
  }

  getHistory(): ReadonlyArray<GraphDelta> {
    return this.undoStack.getHistory();
  }

  /**
   * Returns a shallow copy of the current graph state. Node/edge payloads
   * are NOT cloned; consumers must treat them as immutable for the CRDT
   * inverse math to remain sound.
   */
  get graph(): GraphSnapshot {
    return {
      nodes: new Map(this.nodes),
      edges: new Map(this.edges),
    };
  }

  clear(): void {
    this.undoStack.clear();
  }

  dispose(): void {
    this.undoStack.dispose();
    this.nodes.clear();
    this.edges.clear();
  }
}
