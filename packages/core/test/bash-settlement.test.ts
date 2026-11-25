// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Bash task settlement — settle rules (exit known vs unknown), the ledger's
 * one-record-per-execution guarantee, and the runtime wiring through the
 * tool-loop event path and abort().
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { AgentRuntime } from "../src/runtime.js"
import {
  BashSettlementLedger,
  extractOutputSnapshot,
  settleBashExecution,
} from "../src/bash-settlement.js"
import { Vault } from "../src/vault.js"

// ── Settle rules ────────────────────────────────────────────────────────────

describe("settleBashExecution", () => {
  it("exit code 0 → completed with a known exit", () => {
    const record = settleBashExecution({
      settlementId: "bash-1",
      workspaceId: "ws",
      taskId: "t1",
      exitCode: 0,
      startedAtMs: 1_000,
      endedAtMs: 1_500,
    })
    expect(record.status).toBe("completed")
    expect(record.exitStatus).toBe("known")
    expect(record.exitCode).toBe(0)
    expect(record.durationMs).toBe(500)
    expect(record.outputTruncated).toBe(false)
    expect(record.outputSnapshot).toBeUndefined()
  })

  it("non-zero exit → failed with the code attached", () => {
    const record = settleBashExecution({
      settlementId: "bash-2",
      workspaceId: "ws",
      taskId: "t1",
      exitCode: 2,
      startedAtMs: 1_000,
      endedAtMs: 1_250,
      outputSnapshot: "traceback",
    })
    expect(record.status).toBe("failed")
    expect(record.exitCode).toBe(2)
    expect(record.outputSnapshot).toBe("traceback")
  })

  it("interruption wins over everything: cancelled, exit unknown", () => {
    const record = settleBashExecution({
      settlementId: "bash-3",
      workspaceId: "ws",
      taskId: "t1",
      interrupted: true,
      exitCode: 0, // meaningless — the process never reported it
      startedAtMs: 1_000,
      endedAtMs: 1_100,
      reason: "cascade stop: user stop",
    })
    expect(record.status).toBe("cancelled")
    expect(record.exitStatus).toBe("unknown")
    expect(record.exitCode).toBeUndefined()
    expect(record.reason).toBe("cascade stop: user stop")
  })

  it("an execution that vanished without reporting is a cancellation too", () => {
    const record = settleBashExecution({
      settlementId: "bash-4",
      workspaceId: "ws",
      taskId: "t1",
      endedAtMs: 9_000,
    })
    expect(record.status).toBe("cancelled")
    expect(record.exitStatus).toBe("unknown")
  })

  it("tool outcome proxies the exit code when no real one exists", () => {
    const ok = settleBashExecution({
      settlementId: "bash-5",
      workspaceId: "ws",
      taskId: "t1",
      outcome: "succeeded",
      startedAtMs: 10,
      endedAtMs: 60,
    })
    const bad = settleBashExecution({
      settlementId: "bash-6",
      workspaceId: "ws",
      taskId: "t1",
      outcome: "failed",
      reason: "exit 1",
      startedAtMs: 10,
      endedAtMs: 60,
    })
    expect(ok.status).toBe("completed")
    expect(ok.exitStatus).toBe("known")
    expect(ok.exitCode).toBe(0)
    expect(bad.status).toBe("failed")
    expect(bad.exitCode).toBe(1)
  })

  it("clock anomalies and missing starts collapse to 0 duration; snapshots truncate", () => {
    const anomaly = settleBashExecution({
      settlementId: "bash-7",
      workspaceId: "ws",
      taskId: "t1",
      exitCode: 0,
      startedAtMs: 2_000,
      endedAtMs: 1_000,
    })
    expect(anomaly.durationMs).toBe(0)

    const long = "x".repeat(50)
    const truncated = settleBashExecution(
      {
        settlementId: "bash-8",
        workspaceId: "ws",
        taskId: "t1",
        exitCode: 0,
        endedAtMs: 1,
        outputSnapshot: long,
      },
      { maxSnapshotChars: 10 },
    )
    expect(truncated.outputSnapshot).toBe("x".repeat(10))
    expect(truncated.outputTruncated).toBe(true)
  })
})

describe("extractOutputSnapshot", () => {
  it("reads known shapes and falls back to JSON", () => {
    expect(extractOutputSnapshot("raw", 100)).toEqual({ text: "raw", truncated: false })
    expect(extractOutputSnapshot({ output: "out" }, 100)).toEqual({ text: "out", truncated: false })
    expect(extractOutputSnapshot({ content: "cnt" }, 100)).toEqual({
      text: "cnt",
      truncated: false,
    })
    expect(extractOutputSnapshot({ text: "txt" }, 100)).toEqual({ text: "txt", truncated: false })
    expect(extractOutputSnapshot({ nested: { a: 1 } }, 100)).toEqual({
      text: '{"nested":{"a":1}}',
      truncated: false,
    })
    expect(extractOutputSnapshot("abcdefghij", 3)).toEqual({ text: "abc", truncated: true })
  })
})

// ── Scrub before truncate ───────────────────────────────────────────────────

describe("scrub before truncate", () => {
  const SECRET = "Zq7Xv2Lm9Pd4Rt6Yw1Ub3Ce5Fg8Hj0Ka2Nm4Pz6Xs9Qd1Wv3Ty5Uo7Ir9El2Ao4Gs6"
  const PREFIX = "A".repeat(10)
  const SUFFIX = "B".repeat(100)
  let dir: string
  let vault: Vault

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bash-scrub-"))
    vault = new Vault(path.join(dir, "vault.json"), "test-passphrase")
    await vault.load()
    await vault.save({ title: "provider:test", secret: SECRET })
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("settleBashExecution scrubs the whole snapshot before cutting", () => {
    // Cut window starts at index 10, inside the secret: naive truncation
    // would strand SECRET.slice(0, 10).
    const text = `${PREFIX}${SECRET}${SUFFIX}`
    const record = settleBashExecution(
      {
        settlementId: "bash-scrub-1",
        workspaceId: "ws",
        taskId: "t1",
        exitCode: 0,
        endedAtMs: 1,
        outputSnapshot: text,
      },
      { maxSnapshotChars: 20, vault },
    )
    expect(record.outputTruncated).toBe(true)
    expect(record.outputSnapshot).toBe(`${PREFIX}[redacted]`)
    expect(record.outputSnapshot).not.toContain(SECRET.slice(0, 10))
  })

  it("extractOutputSnapshot scrubs known shapes before cutting", () => {
    const text = `${PREFIX}${SECRET}${SUFFIX}`
    expect(extractOutputSnapshot({ output: text }, 20, vault)).toEqual({
      text: `${PREFIX}[redacted]`,
      truncated: true,
    })
  })

  it("extractOutputSnapshot scrubs the JSON fallback before cutting", () => {
    // '{"data":"' is 9 chars, so a 19-char cut starts inside the secret.
    const result = { data: `${SECRET}${SUFFIX}` }
    const snapshot = extractOutputSnapshot(result, 19, vault)
    expect(snapshot.text).toBe('{"data":"[redacted]')
    expect(snapshot.text).not.toContain(SECRET.slice(0, 10))
  })

  it("the ledger scrubs noted output on its way into a settlement", () => {
    const ledger = new BashSettlementLedger({ maxSnapshotChars: 20, vault })
    ledger.observeStart("ws", "t1", 0)
    ledger.noteOutput("ws", "t1", `${PREFIX}${SECRET}${SUFFIX}`)
    const record = ledger.observeEnd("ws", "t1", { ok: true, durationMs: 1, endedAtMs: 1 })
    expect(record?.outputSnapshot).toBe(`${PREFIX}[redacted]`)
    // The cut already happened (scrubbed) in noteOutput; settling re-scrubs
    // and finds the snapshot within budget.
    expect(record?.outputTruncated).toBe(false)
  })

  it("leaves snapshots without secrets unchanged", () => {
    const record = settleBashExecution(
      {
        settlementId: "bash-scrub-plain",
        workspaceId: "ws",
        taskId: "t1",
        exitCode: 0,
        endedAtMs: 1,
        outputSnapshot: "all output here",
      },
      { maxSnapshotChars: 100, vault },
    )
    expect(record.outputSnapshot).toBe("all output here")
    expect(record.outputTruncated).toBe(false)
  })
})

// ── Ledger ──────────────────────────────────────────────────────────────────

describe("BashSettlementLedger", () => {
  it("settles a start/end pair with the noted partial output", () => {
    const ledger = new BashSettlementLedger({ maxSnapshotChars: 100 })
    ledger.observeStart("ws", "t1", 1_000)
    ledger.noteOutput("ws", "t1", "partial so far")
    const record = ledger.observeEnd("ws", "t1", { ok: true, durationMs: 400, endedAtMs: 1_400 })
    expect(record).toMatchObject({
      status: "completed",
      exitStatus: "known",
      durationMs: 400,
      outputSnapshot: "partial so far",
    })
    expect(ledger.records("ws")).toHaveLength(1)
    expect(ledger.latest("ws", "t1")).toBe(record)
    expect(ledger.pendingCount("ws")).toBe(0)
  })

  it("duplicate tool-ends do not mint a second settlement", () => {
    const ledger = new BashSettlementLedger()
    ledger.observeStart("ws", "t1", 0)
    expect(ledger.observeEnd("ws", "t1", { ok: true, durationMs: 1 })).toBeDefined()
    expect(ledger.observeEnd("ws", "t1", { ok: true, durationMs: 1 })).toBeUndefined()
    expect(ledger.records("ws")).toHaveLength(1)
  })

  it("a tool-end without any bash activity is ignored", () => {
    const ledger = new BashSettlementLedger()
    expect(ledger.observeEnd("ws", "ghost", { ok: true, durationMs: 1 })).toBeUndefined()
    expect(ledger.records("ws")).toEqual([])
  })

  it("settleInterrupted cancels every in-flight execution with the stop reason", () => {
    const ledger = new BashSettlementLedger()
    ledger.observeStart("ws", "t1", 1_000)
    ledger.observeStart("ws", "t2", 1_100)
    ledger.noteOutput("ws", "t2", "build output…")
    const cancelled = ledger.settleInterrupted("ws", "user stop", 1_200)
    expect(cancelled.map((r) => r.taskId).sort()).toEqual(["t1", "t2"])
    expect(cancelled.every((r) => r.status === "cancelled" && r.exitStatus === "unknown")).toBe(
      true,
    )
    expect(cancelled.every((r) => r.reason === "user stop")).toBe(true)
    const t2 = cancelled.find((r) => r.taskId === "t2")!
    expect(t2.outputSnapshot).toBe("build output…")
    // Nothing left pending; a second interrupt settles nothing new.
    expect(ledger.pendingCount("ws")).toBe(0)
    expect(ledger.settleInterrupted("ws", "again", 1_300)).toEqual([])
  })

  it("settleInterrupted is scoped to its workspace", () => {
    const ledger = new BashSettlementLedger()
    ledger.observeStart("ws-a", "t1", 0)
    ledger.observeStart("ws-b", "t2", 0)
    expect(ledger.settleInterrupted("ws-a", "stop")).toHaveLength(1)
    expect(ledger.pendingCount("ws-b")).toBe(1)
  })

  it("workspaces are isolated in the record list", () => {
    const ledger = new BashSettlementLedger()
    ledger.observeStart("ws-a", "t1", 0)
    ledger.observeEnd("ws-a", "t1", { ok: true, durationMs: 5 })
    expect(ledger.records("ws-b")).toEqual([])
  })
})

// ── Runtime wiring ──────────────────────────────────────────────────────────

describe("AgentRuntime bash observation", () => {
  it("settles bash tool events flowing through the event stream", () => {
    vi.useFakeTimers()
    try {
      const runtime = new AgentRuntime(() => undefined as never, {
        async saveWorkspace() {},
        async loadWorkspace() {
          return undefined
        },
      })
      runtime.emitEvent({
        type: "tool-start",
        workspaceId: "ws",
        taskId: "t1",
        toolName: "bash",
      })
      vi.advanceTimersByTime(250)
      runtime.emitEvent({
        type: "tool-end",
        workspaceId: "ws",
        taskId: "t1",
        toolName: "bash",
        ok: true,
        durationMs: 250,
      })
      expect(runtime.bashSettlements("ws")).toHaveLength(1)
      expect(runtime.bashSettlements("ws")[0]).toMatchObject({
        status: "completed",
        exitStatus: "known",
        durationMs: 250,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("abort settles in-flight bash executions as cancelled", () => {
    const runtime = new AgentRuntime(() => undefined as never, {
      async saveWorkspace() {},
      async loadWorkspace() {
        return undefined
      },
    })
    runtime.emitEvent({
      type: "tool-start",
      workspaceId: "ws",
      taskId: "t1",
      toolName: "bash",
    })
    runtime.abort("ws", "user stop")
    const records = runtime.bashSettlements("ws")
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      status: "cancelled",
      exitStatus: "unknown",
      reason: "user stop",
    })
  })
})
