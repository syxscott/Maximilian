/**
 * saveState / loadState (借鉴 openclaw sessions store).
 *
 * The AgentRuntime exposes saveState() and loadState() for capturing
 * and restoring the runtime's per-workspace in-memory state (ledger).
 *
 * Verifies:
 *   - saveState returns a snapshot with ledger
 *   - loadState restores the ledger from a snapshot
 *   - loadState returns false for invalid state
 *   - saveState before any execution returns undefined for empty workspace
 */
import { describe, it, expect } from "vitest"
import { AgentRuntime } from "../src/runtime.js"
import type { Workspace, Plan } from "../src/types.js"

function makeSink() {
  const workspaces = new Map<string, Workspace>()
  return {
    workspaces,
    async saveWorkspace(w: Workspace) { workspaces.set(w.id, w) },
    async loadWorkspace(id: string) { return workspaces.get(id) },
  }
}

describe("saveState / loadState (借鉴 openclaw)", () => {
  it("saveState returns a snapshot (empty ledger for unknown workspace)", () => {
    const rt = new AgentRuntime(() => undefined as never, makeSink())
    const state = rt.saveState("non-existent")
    // Returns { ledger: undefined, savedAt: ... } for unknown workspaces.
    expect(state).toBeDefined()
    expect(state!.savedAt).toBeDefined()
    expect(state!.ledger).toBeUndefined()
  })

  it("loadState restores the ledger from a valid snapshot", () => {
    const rt = new AgentRuntime(() => undefined as never, makeSink())
    const state = {
      ledger: {
        id: "ws-test",
        entries: [
          { kind: "plan", round: 0, summary: "test", at: new Date().toISOString() },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      savedAt: new Date().toISOString(),
    }
    const loaded = rt.loadState("ws-test", state)
    expect(loaded).toBe(true)
    const ledger = rt.getLedger("ws-test")
    expect(ledger).toBeDefined()
    expect(ledger!.entries).toHaveLength(1)
    expect(ledger!.entries[0]!.kind).toBe("plan")
  })

  it("loadState returns false for invalid state", () => {
    const rt = new AgentRuntime(() => undefined as never, makeSink())
    expect(rt.loadState("ws-test", {})).toBe(false)
    expect(rt.loadState("ws-test", { ledger: { id: "x" } })).toBe(false)
    expect(rt.loadState("ws-test", { ledger: { id: "x", entries: "not-an-array" } })).toBe(false)
  })
})