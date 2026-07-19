/**
 * Phase 8.2 — Digital Twin session manager (thin integration wrapper).
 *
 * Ties together:
 *   - A reference to the live `DigitalTwin` snapshot (from digital-twin.ts).
 *   - An `DigitalTwinUndoStack` for CRDT-style undo/redo.
 *   - An in-memory `state: Record<string, unknown>` that deltas mutate directly.
 *
 * `applyDelta` performs a REAL state mutation (not a no-op) and wires back into
 * the existing DigitalTwin proposal mechanism for node:add/remove so that the
 * snapshot and the undo stack stay in sync.
 */

import { DigitalTwin, type CaptureInput, type TwinProposal } from "./digital-twin.js";
import type { OrganizationSnapshot } from "./types.js";
import {
  DigitalTwinUndoStack,
  type TwinDelta,
  type UndoStackOptions,
} from "./digital-twin-undo.js";

// ============================================================================
// dot-path helpers for property:set
// ============================================================================

/** Read a value at a dot-path into a nested record (returns undefined if absent). */
function getPath(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = root;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Set a value at a dot-path into a nested record, mutating in place. */
function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const next = cur[p];
    if (next === undefined || next === null || typeof next !== "object") {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

/** Delete a value at a dot-path from a nested record, mutating in place. */
function deletePath(root: Record<string, unknown>, path: string): boolean {
  const parts = path.split(".");
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const next = cur[p];
    if (next === undefined || typeof next !== "object") return false;
    cur = next as Record<string, unknown>;
  }
  const leaf = parts[parts.length - 1]!;
  if (!Object.prototype.hasOwnProperty.call(cur, leaf)) return false;
  delete cur[leaf];
  return true;
}

// ============================================================================
// TwinDelta -> TwinProposal mapping (for DigitalTwin snapshot integration)
// ============================================================================

function deltaToProposal(delta: TwinDelta): TwinProposal | undefined {
  switch (delta.type) {
    case "node:add":
      return { kind: "birth", subject: delta.target };
    case "node:remove":
      return { kind: "retire", subject: delta.target };
    case "edge:add":
    case "edge:remove":
    case "property:set":
      // No direct proposal analog in DigitalTwin; these live only in `state`.
      return undefined;
  }
}

// ============================================================================
// DigitalTwinSession
// ============================================================================

export interface DigitalTwinSessionOptions extends UndoStackOptions {
  /** Initial snapshot to seed the session. */
  initialSnapshot?: OrganizationSnapshot;
}

export class DigitalTwinSession {
  private readonly undoStack: DigitalTwinUndoStack;
  private snapshot: OrganizationSnapshot;
  /** In-memory mutable state that deltas mutate directly. */
  private readonly state: Record<string, unknown>;

  constructor(input: CaptureInput, options: DigitalTwinSessionOptions = {}) {
    this.snapshot = options.initialSnapshot ?? DigitalTwin.capture(input);
    this.undoStack = new DigitalTwinUndoStack(options);
    this.state = {};
  }

  // -------------------------------------------------------------------------
  // Core delta application
  // -------------------------------------------------------------------------

  /**
   * Apply a twin delta:
   *   1. Mutate `state` in place (real mutation, not a no-op).
   *   2. Push the delta onto the undo stack.
   *   3. For node:add/remove, also advance the snapshot via DigitalTwin.apply
   *      so the snapshot and undo stack stay in sync.
   */
  async applyDelta(delta: TwinDelta): Promise<void> {
    this.mutateState(delta);
    this.undoStack.push(delta);

    // Wire back into DigitalTwin snapshot semantics for structural proposals.
    const proposal = deltaToProposal(delta);
    if (proposal) {
      this.snapshot = DigitalTwin.apply(this.snapshot, proposal);
    }
  }

  /** Mutate the in-memory state according to the delta type. */
  private mutateState(delta: TwinDelta): void {
    switch (delta.type) {
      case "node:add": {
        const node = delta.after;
        if (node !== undefined && node !== null) {
          this.state[delta.target] = node;
        }
        break;
      }
      case "node:remove": {
        delete this.state[delta.target];
        break;
      }
      case "edge:add": {
        const edge = delta.after;
        if (edge !== undefined && edge !== null) {
          this.state[delta.target] = edge;
        }
        break;
      }
      case "edge:remove": {
        delete this.state[delta.target];
        break;
      }
      case "property:set": {
        setPath(this.state, delta.target, delta.after);
        break;
      }
    }
  }

  /** Apply the inverse delta to `state` (shared by undo path). */
  private applyInverseToState(inverse: TwinDelta): void {
    switch (inverse.type) {
      // inverse of remove<->add flips before/after; here `after` holds the
      // value to restore to state for an "add", and undefined means drop.
      case "node:add":
      case "edge:add": {
        const value = inverse.after;
        if (value === undefined || value === null) {
          delete this.state[inverse.target];
        } else {
          this.state[inverse.target] = value;
        }
        break;
      }
      case "node:remove":
      case "edge:remove": {
        delete this.state[inverse.target];
        break;
      }
      case "property:set": {
        // inverse.after === original.before — restore the old value.
        const before = inverse.after;
        if (before === undefined) {
          deletePath(this.state, inverse.target);
        } else {
          setPath(this.state, inverse.target, before);
        }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Undo / redo
  // -------------------------------------------------------------------------

  /**
   * Pop the last delta from the undo stack and apply its inverse to state.
   * Returns the inverse delta applied, or undefined if nothing to undo.
   *
   * For the snapshot layer, the inverse delta's type already encodes the
   * structural reverse (a `node:add` birth undoes via a `node:remove` retire),
   * so we map the inverse delta straight to its proposal counterpart.
   */
  async undo(): Promise<TwinDelta | undefined> {
    const inverse = this.undoStack.undo();
    if (!inverse) return undefined;
    this.applyInverseToState(inverse);

    // Reverse the snapshot, if the inverse delta has a proposal counterpart.
    const proposal = deltaToProposal(inverse);
    if (proposal) {
      this.snapshot = DigitalTwin.apply(this.snapshot, proposal);
    }
    return inverse;
  }

  /** Re-apply the last undone delta. Returns the delta applied, or undefined. */
  async redo(): Promise<TwinDelta | undefined> {
    const delta = this.undoStack.redo();
    if (!delta) return undefined;
    this.mutateState(delta);
    const proposal = deltaToProposal(delta);
    if (proposal) {
      this.snapshot = DigitalTwin.apply(this.snapshot, proposal);
    }
    return delta;
  }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  canUndo(): boolean {
    return this.undoStack.canUndo();
  }

  canRedo(): boolean {
    return this.undoStack.canRedo();
  }

  getHistory(): ReadonlyArray<TwinDelta> {
    return this.undoStack.getHistory();
  }

  /** Read the in-memory mutable state (debug / integration). */
  getState(): Readonly<Record<string, unknown>> {
    return this.state;
  }

  /** Read the current DigitalTwin snapshot. */
  getSnapshot(): OrganizationSnapshot {
    return this.snapshot;
  }

  dispose(): void {
    this.undoStack.dispose();
  }

  clear(): void {
    this.undoStack.clear();
  }
}

// Re-export for convenience
export { getPath, setPath, deletePath };
