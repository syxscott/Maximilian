import { describe, it, expect } from "vitest"
import {
  appendLedger,
  extendLedger,
  filterLedger,
  freshLedger,
  renderLedger,
  type Ledger,
  type LedgerEntry,
} from "../src/ledger.js"

describe("Ledger", () => {
  it("freshLedger starts empty", () => {
    const l = freshLedger("ws-1")
    expect(l.workspaceId).toBe("ws-1")
    expect(l.entries).toEqual([])
  })

  it("appendLedger adds a single entry immutably", () => {
    const a = freshLedger("ws-1")
    const b = appendLedger(a, { kind: "fact", round: 0, subject: "s", content: "c", at: "t" })
    expect(a.entries).toHaveLength(0)
    expect(b.entries).toHaveLength(1)
  })

  it("extendLedger appends many entries atomically", () => {
    const l = freshLedger("ws")
    const entries: LedgerEntry[] = [
      { kind: "plan", round: 0, summary: "do x", at: "t" },
      { kind: "action", round: 1, agent: "frontend", at: "t" },
      { kind: "observation", round: 1, agent: "frontend", ok: true, at: "t" },
      { kind: "answer", round: 2, content: "done", at: "t" },
    ]
    const l2 = extendLedger(l, entries)
    expect(l2.entries).toHaveLength(4)
  })

  it("filterLedger narrows by kind", () => {
    const l = extendLedger(freshLedger("ws"), [
      { kind: "plan", round: 0, summary: "p", at: "t" },
      { kind: "action", round: 1, agent: "frontend", at: "t" },
      { kind: "action", round: 2, agent: "backend", at: "t" },
    ])
    const actions = filterLedger(l, "action")
    expect(actions).toHaveLength(2)
    expect(actions.every((a) => a.kind === "action")).toBe(true)
  })

  it("renderLedger produces a compact, multi-line preview", () => {
    const l: Ledger = {
      workspaceId: "ws",
      entries: [
        { kind: "plan", round: 0, summary: "do x", selectedAgent: "frontend", at: "t" },
        { kind: "action", round: 1, agent: "frontend", tool: "ripgrep", at: "t" },
        { kind: "observation", round: 1, agent: "frontend", ok: true, at: "t" },
        { kind: "observation", round: 2, agent: "backend", ok: false, error: "boom", at: "t" },
      ],
    }
    const text = renderLedger(l)
    expect(text).toContain("[plan r0] do x → frontend")
    expect(text).toContain("[action r1] frontend :: ripgrep")
    expect(text).toContain("[obs r1] frontend ok")
    expect(text).toContain("[obs r2] backend failed: boom")
  })

  it("renderLedger truncates to maxEntries", () => {
    const entries: LedgerEntry[] = []
    for (let i = 0; i < 50; i++) {
      entries.push({ kind: "fact", round: i, subject: `s${i}`, content: `c${i}`, at: "t" })
    }
    const l: Ledger = { workspaceId: "ws", entries }
    const text = renderLedger(l, 3)
    const lines = text.split("\n")
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain("s47")
  })
})