// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest"
import {
  RecoveryBookkeepingIndex,
  recoverStalledJobsFromIndex,
  crashCategoryOfClassification,
  type StalledJobPort,
} from "../src/index.js"

function countingPort() {
  const calls = { reset: 0, hold: 0 }
  const port: StalledJobPort = {
    listStalledRunning: () => [],
    resetToRetryable: () => {
      calls.reset += 1
    },
    holdWithReason: () => {
      calls.hold += 1
    },
  }
  return { port, calls }
}

const alwaysTransient = () => "transient"

describe("RecoveryBookkeepingIndex — candidate set is live work only", () => {
  it("candidates are exactly the running tasks, with attempts and lastError", () => {
    const index = new RecoveryBookkeepingIndex()
    index.upsert({ id: "t1", state: "running", attempts: 2, lastError: { code: "E1" } })
    index.upsert({ id: "t2", state: "running" })
    index.upsert({ id: "t3", state: "completed" })
    index.upsert({ id: "t4", state: "failed" })
    const candidates = index.candidatesForSweep()
    expect(candidates.map((c) => c.id).sort()).toEqual(["t1", "t2"])
    expect(candidates.find((c) => c.id === "t1")?.attempts).toBe(2)
    expect(candidates.find((c) => c.id === "t1")?.lastError).toEqual({ code: "E1" })
    expect(index.runningCount).toBe(2)
  })

  it("a running task that ends leaves the candidate set", () => {
    const index = new RecoveryBookkeepingIndex()
    index.upsert({ id: "t1", state: "running" })
    expect(index.runningCount).toBe(1)
    index.upsert({ id: "t1", state: "completed" })
    expect(index.runningCount).toBe(0)
    expect(index.candidatesForSweep()).toEqual([])
  })

  it("a terminal task that comes back (retry) rejoins the candidates", () => {
    const index = new RecoveryBookkeepingIndex()
    index.upsert({ id: "t1", state: "running" })
    index.upsert({ id: "t1", state: "failed" })
    index.upsert({ id: "t1", state: "running", attempts: 2 })
    expect(index.runningCount).toBe(1)
  })
})

describe("RecoveryBookkeepingIndex — bounded terminal ownership", () => {
  it("keeps the chain above live work WHOLE (walks pass through ended tasks)", () => {
    const index = new RecoveryBookkeepingIndex()
    index.upsert({ id: "root", state: "completed", owner: undefined })
    index.upsert({ id: "mid", state: "failed", owner: "root" })
    index.upsert({ id: "leaf", state: "running", owner: "mid" })
    expect(index.ownersAbove("leaf")).toEqual(["mid", "root"])
    index.sweepPending()
    expect(index.ownersAbove("leaf")).toEqual(["mid", "root"]) // still whole
  })

  it("drops terminal entries once nothing live is reached through them", () => {
    const index = new RecoveryBookkeepingIndex()
    index.upsert({ id: "root", state: "completed" })
    index.upsert({ id: "child", state: "failed", owner: "root" })
    index.upsert({ id: "live", state: "running", owner: undefined })
    index.sweepPending()
    expect(index.size).toBe(1) // only the live task remains
    expect(index.ownersAbove("live")).toEqual([])
  })

  it("ending the last live task queues the whole stale chain for removal", () => {
    const index = new RecoveryBookkeepingIndex()
    index.upsert({ id: "root", state: "running" })
    index.upsert({ id: "mid", state: "running", owner: "root" })
    index.upsert({ id: "leaf", state: "running", owner: "mid" })
    expect(index.size).toBe(3)

    // End the chain root-first: each end decrements EVERY ancestor's
    // counter, so root only hits zero when the LAST leaf ends.
    index.upsert({ id: "root", state: "completed" })
    expect(index.pendingRemovals).toBe(0) // live work still hangs below root
    index.upsert({ id: "mid", state: "completed" })
    expect(index.pendingRemovals).toBe(0) // leaf still live through root
    index.upsert({ id: "leaf", state: "completed" })
    expect(index.pendingRemovals).toBe(3) // the whole chain became stale at once
    index.sweepPending()
    expect(index.size).toBe(0)
  })

  it("records arriving child-first keep ancestors alive (any upsert order)", () => {
    const index = new RecoveryBookkeepingIndex()
    // Live child first, its terminal ancestors afterwards.
    index.upsert({ id: "leaf", state: "running", owner: "mid" })
    index.upsert({ id: "mid", state: "failed", owner: "root" })
    index.upsert({ id: "root", state: "completed" })
    index.sweepPending()
    expect(index.ownersAbove("leaf")).toEqual(["mid", "root"])
  })

  it("sweepPending re-checks queued nodes: a retried terminal task survives", () => {
    const index = new RecoveryBookkeepingIndex()
    index.upsert({ id: "t", state: "running" })
    index.upsert({ id: "t", state: "failed" }) // queued for removal
    index.upsert({ id: "t", state: "running" }) // retry before the sweep
    expect(index.sweepPending()).toBe(0)
    expect(index.size).toBe(1)
    expect(index.runningCount).toBe(1)
  })

  it("a 500-chain of ended history costs nothing per scan and collapses on sweep", () => {
    const index = new RecoveryBookkeepingIndex()
    // A live root with a 500-deep ENDED chain (each node owner of the next,
    // every one terminal) plus its own live leaf.
    index.upsert({ id: "live-root", state: "running" })
    let prev = "live-root"
    for (let i = 0; i < 500; i += 1) {
      const id = `ended-${i}`
      index.upsert({ id, state: "failed", owner: prev })
      prev = id
    }
    index.upsert({ id: "live-leaf", state: "running", owner: prev })
    index.sweepPending()

    // The whole chain is above live work: retained, and the walk is whole.
    expect(index.ownersAbove("live-leaf")).toHaveLength(501)
    expect(index.runningCount).toBe(2)

    // The candidate set NEVER included the 500 terminal tasks.
    expect(
      index
        .candidatesForSweep()
        .map((c) => c.id)
        .sort(),
    ).toEqual(["live-leaf", "live-root"])
  })

  it("fully ended history is dropped without touching live work", () => {
    const index = new RecoveryBookkeepingIndex()
    index.upsert({ id: "live", state: "running" })
    let prev = "live"
    for (let i = 0; i < 500; i += 1) {
      const id = `done-${i}`
      index.upsert({ id, state: "completed", owner: prev })
      prev = id
    }
    index.sweepPending()
    expect(index.size).toBe(1)
    expect(index.ownersAbove("live")).toEqual([])
  })
})

describe("recoverStalledJobsFromIndex — same decisions, bounded pass", () => {
  it("resets transient candidates and holds permanent ones, exactly like the port sweep", async () => {
    const index = new RecoveryBookkeepingIndex()
    index.upsert({ id: "a", state: "running", lastError: { category: "transient" } })
    index.upsert({ id: "b", state: "running", lastError: { category: "permanent" } })
    index.upsert({ id: "dead", state: "completed", lastError: { category: "transient" } })
    const { port, calls } = countingPort()

    const report = await recoverStalledJobsFromIndex(index, port, crashCategoryOfClassification)
    expect(report.scanned).toBe(2) // terminal history never scanned
    expect(report.reset).toBe(1)
    expect(report.held).toBe(1)
    expect(calls.reset).toBe(1)
    expect(calls.hold).toBe(1)
  })

  it("countOnly runs classification with ZERO port verbs", async () => {
    const index = new RecoveryBookkeepingIndex()
    index.upsert({ id: "a", state: "running", lastError: { category: "rate_limit" } })
    index.upsert({ id: "b", state: "running", lastError: { category: "unknown" } })
    const { port, calls } = countingPort()

    const report = await recoverStalledJobsFromIndex(index, port, crashCategoryOfClassification, {
      countOnly: true,
    })
    expect(report.scanned).toBe(2)
    expect(report.byCategory.rate_limit).toBe(1)
    expect(report.byCategory.unknown).toBe(1)
    expect(report.unknownLeft).toBe(1)
    expect(calls.reset).toBe(0)
    expect(calls.hold).toBe(0)
  })

  it("respects maxResets: over-budget tasks are held, not reset", async () => {
    const index = new RecoveryBookkeepingIndex()
    for (let i = 0; i < 5; i += 1) {
      index.upsert({ id: `t${i}`, state: "running", lastError: { category: "transient" } })
    }
    const { port, calls } = countingPort()
    const report = await recoverStalledJobsFromIndex(index, port, crashCategoryOfClassification, {
      maxResets: 2,
    })
    expect(report.reset).toBe(2)
    expect(report.held).toBe(3)
    expect(calls.hold).toBe(3)
  })

  it("scale invariance: port touches stay CONSTANT as history grows 500 -> 5000", async () => {
    const classify = crashCategoryOfClassification
    async function sweepWith(historySize: number): Promise<{ touches: number; scanned: number }> {
      const index = new RecoveryBookkeepingIndex()
      // A fully ended chain: 500..5000 completed tasks hanging below an
      // ended root, with ONE stalled running task at the far end.
      index.upsert({ id: "ended-root", state: "completed" })
      let prev = "ended-root"
      for (let i = 0; i < historySize; i += 1) {
        const id = `done-${i}`
        index.upsert({ id, state: "completed", owner: prev })
        prev = id
      }
      index.upsert({
        id: "stalled",
        state: "running",
        owner: prev,
        lastError: { category: "transient" },
      })
      index.sweepPending()

      let touches = 0
      const port: StalledJobPort = {
        listStalledRunning: () => [],
        resetToRetryable: () => {
          touches += 1
        },
        holdWithReason: () => {
          touches += 1
        },
      }
      const report = await recoverStalledJobsFromIndex(index, port, classify)
      return { touches, scanned: report.scanned }
    }

    const small = await sweepWith(500)
    const large = await sweepWith(5000)
    expect(small.scanned).toBe(1) // exactly the one stalled task
    expect(small.touches).toBe(1) // exactly one reset verb
    expect(large.scanned).toBe(small.scanned) // 10x history, same constant work
    expect(large.touches).toBe(small.touches)
  })

  it("drains the removal worklist at the end of the sweep", async () => {
    const index = new RecoveryBookkeepingIndex()
    index.upsert({ id: "t", state: "running" })
    index.upsert({ id: "t", state: "failed" })
    expect(index.pendingRemovals).toBe(1)
    const { port } = countingPort()
    await recoverStalledJobsFromIndex(index, port, () => null)
    expect(index.pendingRemovals).toBe(0)
    expect(index.size).toBe(0)
  })

  it("unknown candidates are counted but never touch a port verb", async () => {
    const index = new RecoveryBookkeepingIndex()
    index.upsert({ id: "mystery", state: "running", lastError: "garbage" })
    const spy = vi.fn()
    const port: StalledJobPort = {
      listStalledRunning: () => [],
      resetToRetryable: spy,
      holdWithReason: spy,
    }
    const report = await recoverStalledJobsFromIndex(index, port, () => null)
    expect(report.unknownLeft).toBe(1)
    expect(spy).not.toHaveBeenCalled()
  })
})
