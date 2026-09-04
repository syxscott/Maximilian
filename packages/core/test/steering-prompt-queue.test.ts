// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Steering/followup queues (pi borrowing) + chat prompt queue with merge
 * rules (grok-build borrowing).
 */

import { describe, it, expect } from "vitest"
import { SteeringQueue, SteeringCoordinator } from "../src/steering.js"
import { ChatPromptQueue } from "../src/prompt-queue.js"

describe("SteeringQueue", () => {
  it("steer drains in arrival order at the safe point", () => {
    const q = new SteeringQueue()
    q.steer("also add tests")
    q.steer("use pnpm not npm")
    expect(q.peekSteering()).toBe(2)
    const drained = q.drainSteering()
    expect(drained.map((m) => m.text)).toEqual(["also add tests", "use pnpm not npm"])
    expect(q.peekSteering()).toBe(0)
  })

  it("mode 'one' releases a single message per safe point", () => {
    const q = new SteeringQueue({ mode: "one" })
    q.steer("first")
    q.steer("second")
    expect(q.drainSteering()).toHaveLength(1)
    expect(q.drainSteering()).toHaveLength(1)
    expect(q.drainSteering()).toHaveLength(0)
  })

  it("followup drains separately from steering", () => {
    const q = new SteeringQueue()
    q.steer("mid-flight")
    q.followup("after you finish")
    expect(q.peekSteering()).toBe(1)
    expect(q.peekFollowup()).toBe(1)
    expect(q.drainFollowup()[0]?.text).toBe("after you finish")
    expect(q.drainSteering()[0]?.text).toBe("mid-flight")
  })

  it("rejects empty text and enforces the queue cap", () => {
    const q = new SteeringQueue({ maxQueue: 2 })
    expect(q.steer("  ")).toBe(false)
    expect(q.steer("a")).toBe(true)
    expect(q.steer("b")).toBe(true)
    expect(q.steer("c")).toBe(false)
    q.clear()
    expect(q.peekSteering()).toBe(0)
  })
})

describe("SteeringCoordinator", () => {
  it("keeps per-workspace queues isolated", () => {
    const c = new SteeringCoordinator()
    c.steer("ws-1", "for one")
    c.steer("ws-2", "for two")
    expect(c.forWorkspace("ws-1").drainSteering()[0]?.text).toBe("for one")
    expect(c.forWorkspace("ws-2").peekSteering()).toBe(1)
    expect(c.hasPending("ws-2")).toBe(true)
    c.cleanup("ws-2")
    expect(c.hasPending("ws-2")).toBe(false)
  })
})

describe("ChatPromptQueue", () => {
  function makeQueue(
    overrides: Partial<Parameters<(typeof ChatPromptQueue.prototype)["enqueue"]>[0]> = {},
  ) {
    const runs: Array<{ texts: string[]; merged: boolean; version: number }> = []
    const queue = new ChatPromptQueue({
      onRun: async (input) => {
        runs.push(input)
      },
      ...overrides,
    })
    return { queue, runs }
  }

  it("runs immediately when idle", async () => {
    const { queue, runs } = makeQueue()
    const res = queue.enqueue("build the login page")
    expect(res.queued).toBe(false)
    await queue.idle()
    expect(runs).toEqual([{ texts: ["build the login page"], merged: false, version: res.version }])
  })

  it("merges short consecutive follow-ups while busy", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const runs: Array<{ texts: string[]; merged: boolean }> = []
    const queue = new ChatPromptQueue({
      onRun: async (input) => {
        runs.push(input)
        await gate
      },
      maxMergeChars: 200,
      mergeWindowMs: 5_000,
      now: () => 1_000, // frozen clock → always inside the merge window
    })

    queue.enqueue("first task") // runs, holds the queue busy on the gate
    const m1 = queue.enqueue("make it blue") // becomes the queued head
    const m2 = queue.enqueue("and fast") // folds into the head entry
    expect(m1.merged).toBe(false) // nothing queued yet to merge with
    expect(m2.merged).toBe(true)
    expect(m2.version).toBe(m1.version) // folded into the same entry

    release()
    await queue.idle()
    expect(runs).toHaveLength(2)
    expect(runs[1]).toEqual({
      texts: ["make it blue", "and fast"],
      merged: true,
      version: m1.version,
    })
  })

  it("does not merge past the char budget or the time window", () => {
    let clock = 1_000
    const runs: unknown[] = []
    const queue = new ChatPromptQueue({
      onRun: async (input) => {
        runs.push(input)
      },
      maxMergeChars: 20,
      mergeWindowMs: 100,
      now: () => clock,
    })
    queue.enqueue("head")
    const overBudget = queue.enqueue("this message is far over the merge budget")
    const tail = queue.enqueue("tail")
    expect(overBudget.merged).toBe(false) // 43+4 chars > 20 budget
    expect(tail.merged).toBe(false)

    clock = 5_000 // window expired — even a short message stays separate
    const afterWindow = queue.enqueue("after window")
    expect(afterWindow.merged).toBe(false)
    expect(queue.pending()).toHaveLength(3)
  })

  it("edit() applies only to the latest queued version; stale edits are no-ops", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const runs: Array<{ texts: string[] }> = []
    const queue = new ChatPromptQueue({
      onRun: async (input) => {
        runs.push(input)
        await gate
      },
    })
    queue.enqueue("running now")
    const a = queue.enqueue("draft one")
    const edited = queue.edit(a.version, "draft two")
    expect(edited).toBe(true)
    const stale = queue.edit(9999, "stale")
    expect(stale).toBe(false)

    release()
    await queue.idle()
    expect(runs[1]?.texts).toEqual(["draft two"])
  })

  it("a throwing onRun is contained: no rejection, queue keeps draining", async () => {
    const errors: Error[] = []
    const ran: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const queue = new ChatPromptQueue({
      onRun: async (input) => {
        ran.push(input.texts[0])
        if (ran.length === 1) {
          await gate
          throw new Error("handler exploded")
        }
      },
      onError: (err) => errors.push(err),
      maxMergeChars: 0,
    })
    const p = queue.enqueue("one") // will throw inside onRun
    queue.enqueue("two")
    release()
    await queue.idle()
    // The scheduler promise never rejects even though the first run threw
    // (vitest fails the run on unhandled rejections, so reaching this line
    // cleanly is the assertion).
    expect(p.version).toBe(1)
    expect(ran).toEqual(["one", "two"])
    expect(errors).toHaveLength(1)
    expect(queue.busy).toBe(false)
  })

  it("serializes everything through one runner and signals idle", async () => {
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const queue = new ChatPromptQueue({
      onRun: async (input) => {
        order.push(input.texts[0])
        if (order.length === 1) await gate
      },
      maxMergeChars: 0, // disable merging — one run per message
    })
    queue.enqueue("one")
    queue.enqueue("two")
    queue.enqueue("three")
    release()
    await queue.idle()
    expect(order).toEqual(["one", "two", "three"])
    expect(queue.busy).toBe(false)
  })
})
