/**
 * Phase 8.2 — Digital Twin CRDT-style undo engine.
 *
 * Every twin mutation produces a `TwinDelta`; `reverseDelta(delta)` produces a
 * new delta that exactly undoes it. The undo stack pushes/pops deltas and
 * applies their inverses — no state snapshots needed (unlike the
 * snapshot-based DigitalTwin.apply(), which this complements, not replaces).
 *
 * Borrowed from: VoiceTree graph-model undoStack (pure-graph/undo/undoStack.ts)
 *   - CRDT-style inverse computation (swap before/after + map add<->remove)
 *   - undo/redo stacks with redo-invalidates-on-new-action semantics
 *   - bounded MAX_UNDO_SIZE with oldest-drop eviction
 */

import { z } from "zod";

// ============================================================================
// TwinDelta — a single reversible mutation to the twin's in-memory state
// ============================================================================

export const TwinDeltaTypeSchema = z.enum([
  "node:add",
  "node:remove",
  "edge:add",
  "edge:remove",
  "property:set",
]);
export type TwinDeltaType = z.infer<typeof TwinDeltaTypeSchema>;

export const TwinDeltaSchema = z.object({
  type: TwinDeltaTypeSchema,
  target: z.string(),
  before: z.unknown(),
  after: z.unknown(),
  at: z.string(),
  traceId: z.string().optional(),
});
export type TwinDelta = z.infer<typeof TwinDeltaSchema>;

// ============================================================================
// Inverse-type mapping: add <-> remove; property:set is self-inverse
// ============================================================================

const INVERSE_TYPE: Readonly<Record<TwinDeltaType, TwinDeltaType>> = {
  "node:add": "node:remove",
  "node:remove": "node:add",
  "edge:add": "edge:remove",
  "edge:remove": "edge:add",
  "property:set": "property:set",
};

// ============================================================================
// UndoEntry / UndoStackOptions
// ============================================================================

export interface UndoEntry {
  delta: TwinDelta;
  inverse: TwinDelta;
  appliedAt: string;
}

export interface UndoStackOptions {
  /** Beyond this, oldest entries are dropped. */
  maxSize?: number;
}

export const DEFAULT_MAX_UNDO_SIZE = 50;

// ============================================================================
// reverseDelta — compute the exact inverse of a delta
// ============================================================================

/**
 * Returns a new delta that, when applied, undoes the original.
 *
 * Semantics:
 *   - `type` is mapped through the inverse-type table (add<->remove).
 *   - `before`/`after` are the add's payload: removing needs to *not* know
 *     the old value, while adding back a removed node needs the stored value.
 *     So: inverse.before = original.after, inverse.after = original.before.
 *   - For `node:remove` (original.before holds the removed payload),
 *     inverse is `node:add` with after = the removed payload — correct restore.
 *   - For `node:add` (original.after holds the added payload),
 *     inverse is `node:remove` with before = the added payload — correct drop.
 */
export function reverseDelta(delta: TwinDelta): TwinDelta {
  const inverseType = INVERSE_TYPE[delta.type];
  return {
    type: inverseType,
    target: delta.target,
    before: delta.after,
    after: delta.before,
    at: new Date().toISOString(),
    traceId: delta.traceId,
  };
}

// ============================================================================
// DigitalTwinUndoStack — CRDT undo/redo engine
// ============================================================================

export class DigitalTwinUndoStack {
  private readonly entries: UndoEntry[] = [];
  private readonly redoStack: UndoEntry[] = [];
  private readonly maxSize: number;

  constructor(options: UndoStackOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_UNDO_SIZE;
  }

  /** Compute the inverse and push. Clears the redo stack (new action branch). */
  push(delta: TwinDelta): void {
    const entry: UndoEntry = {
      delta,
      inverse: reverseDelta(delta),
      appliedAt: delta.at,
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxSize) {
      this.entries.shift(); // drop oldest
    }
    this.redoStack.length = 0; // new action invalidates redo history
  }

  /** Pop the last entry, return the INVERSE delta to apply so the change undoes. */
  undo(): TwinDelta | undefined {
    const entry = this.entries.pop();
    if (!entry) return undefined;
    this.redoStack.push(entry);
    return entry.inverse;
  }

  /** Re-apply the last undone delta (forward again). */
  redo(): TwinDelta | undefined {
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

  /** Forward-history of applied deltas (oldest first) — for debug/display. */
  getHistory(): ReadonlyArray<TwinDelta> {
    return this.entries.map((e) => e.delta);
  }

  /** Clear the redo branch only (keeps undo history intact). */
  clearRedo(): void {
    this.redoStack.length = 0;
  }

  /** Clear all entries and the redo stack. */
  clear(): void {
    this.entries.length = 0;
    this.redoStack.length = 0;
  }

  /** Clear all entries (alias of clear() for trait-style symmetry). */
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
