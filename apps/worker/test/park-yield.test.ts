// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Park-yield tests (borrowing; OpenAgentCore
 * services/core/internal/execution/worker.go:277 + delivery.go:349).
 *
 * Verifies the worker-side starvation fix with a mock runtime:
 *   - two runs parked on a human decision do NOT occupy execution slots —
 *     a third job starts immediately under the same concurrency budget;
 *   - a resumed park continues the SAME turn (no second execute call, no
 *     re-run) and its outcome still flows through the detached handlers;
 *   - a detached run that fails after its slot was released still
 *     reaches the failure handler (failed-state persistence parity);
 *   - the DetachedRunRegistry exposes parked workspaces for the duplicate
 *     dispatch guard and cleans up when the run settles.
 */
import { describe, it, expect, vi } from "vitest"
import {
  DetachedRunRegistry,
  ParkSignal,
  executeUntilPark,
  type ParkStateInfo,
} from "../src/park-yield.js"
import type { Workspace } from "@max/core"

/** Flush microtasks + zero-delay timers so parked edges have landed. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

async function waitUntil(pred: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2000
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

/**
 * Mock runtime whose execute() parks on a human decision for the
 * workspaces in `parkingIds` (turn recorded as start → parked → resumed),
 * and completes immediately otherwise. Resuming via `answer` settles the
 * SAME execute promise — exactly the runtime's in-process wake channel.
 */
class MockRuntime {
  /** The runtime's global onParkStateChange dispatch target. */
  readonly onParkStateChange = (info: ParkStateInfo): void => {
    this.parkTransitions.push(info)
    this.listeners.get(info.workspaceId)?.(info)
  }
  readonly executeCalls: string[] = []
  /** Per-workspace turn markers — proves the resumed turn never re-runs. */
  readonly turns = new Map<string, string[]>()
  readonly parkTransitions: ParkStateInfo[] = []
  private readonly parkingIds: Set<string>
  private readonly listeners = new Map<string, (info: ParkStateInfo) => void>()
  private readonly resolvers = new Map<string, () => void>()
  private readonly failures = new Set<string>()

  constructor(parkingIds: string[]) {
    this.parkingIds = new Set(parkingIds)
  }

  /** Make the run throw when its parked ask resolves (post-park failure). */
  failAfterResume(workspaceId: string): void {
    this.failures.add(workspaceId)
  }

  /** The parked run's wake channel (resolvePermission analogue). */
  answer(workspaceId: string): void {
    const resolve = this.resolvers.get(workspaceId)
    if (!resolve) throw new Error(`no parked run for ${workspaceId}`)
    this.resolvers.delete(workspaceId)
    resolve()
  }

  execute(workspace: Workspace): Promise<Workspace> {
    this.executeCalls.push(workspace.id)
    const turn = this.turns.get(workspace.id) ?? []
    turn.push("start")
    this.turns.set(workspace.id, turn)
    if (!this.parkingIds.has(workspace.id)) {
      turn.push("resumed")
      return Promise.resolve({ ...workspace, status: "completed" })
    }
    return new Promise<Workspace>((resolve, reject) => {
      // Mimic the runtime: park a tick after execute begins, then resume
      // the SAME promise when the human decision arrives. Park edges flow
      // through the runtime's global hook (which the processor's
      // per-workspace listener routes into the ParkSignal).
      setTimeout(() => {
        turn.push("parked")
        this.onParkStateChange({ workspaceId: workspace.id, parked: true })
        this.resolvers.set(workspace.id, () => {
          turn.push("resumed")
          this.onParkStateChange({ workspaceId: workspace.id, parked: false })
          if (this.failures.has(workspace.id)) {
            reject(new Error("resumed turn exploded"))
            return
          }
          resolve({ ...workspace, status: "completed" })
        })
      }, 2)
    })
  }

  /** Processor-side park hook wiring (mirrors apps/worker/src/index.ts). */
  wire(workspaceId: string, signal: ParkSignal): void {
    this.listeners.set(workspaceId, signal.observe)
  }
  unwire(workspaceId: string): void {
    this.listeners.delete(workspaceId)
  }
}

function makeWorkspace(id: string): Workspace {
  return {
    id,
    userRequest: "build feature",
    status: "planning",
    results: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
  }
}

/** The processor's park-yield section, extracted verbatim in mock form. */
function processJob(
  runtime: MockRuntime,
  registry: DetachedRunRegistry,
  completed: string[],
  failures: string[],
): (ws: Workspace) => Promise<"completed" | "parked" | "skipped-duplicate"> {
  return async (ws) => {
    // Duplicate-dispatch guard (parked workspace is status "executing").
    if (registry.has(ws.id)) return "skipped-duplicate"
    const signal = new ParkSignal()
    runtime.wire(ws.id, signal)
    let raced: Awaited<ReturnType<typeof executeUntilPark>>
    try {
      raced = await executeUntilPark({
        workspaceId: ws.id,
        execute: () => runtime.execute(ws),
        signal,
        onDetachedComplete: async (final) => {
          completed.push(final.id)
        },
        onDetachedFailure: async () => {
          failures.push(ws.id)
        },
      })
    } finally {
      runtime.unwire(ws.id)
    }
    if (raced.outcome === "parked") {
      registry.track(ws.id, raced.detached)
      return "parked"
    }
    completed.push(raced.result.id)
    return "completed"
  }
}

/** Fixed-concurrency runner — stands in for BullMQ's slot semantics. */
async function runQueue(
  jobs: Workspace[],
  concurrency: number,
  process: (ws: Workspace) => Promise<unknown>,
): Promise<void> {
  const queue = [...jobs]
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const next = queue.shift()
      if (!next) break
      await process(next)
    }
  })
  await Promise.all(workers)
}

describe("park-yield (borrowing; OAC worker.go:277)", () => {
  it("a third job starts immediately while two runs are parked on approvals", async () => {
    const runtime = new MockRuntime(["ws-1", "ws-2"])
    const registry = new DetachedRunRegistry()
    const completed: string[] = []
    const failures: string[] = []
    const process = processJob(runtime, registry, completed, failures)

    const drained = runQueue(
      [makeWorkspace("ws-1"), makeWorkspace("ws-2"), makeWorkspace("ws-3")],
      2,
      process,
    )

    // ws-3 must execute while ws-1/ws-2 are still parked — under the old
    // blocking behaviour the concurrency-2 runner would wait for their
    // 600s permission timeouts before starting it.
    await waitUntil(() => runtime.executeCalls.includes("ws-3"), "ws-3 to start")
    expect(runtime.executeCalls).toEqual(["ws-1", "ws-2", "ws-3"])
    expect(completed).toEqual(["ws-3"])
    expect(registry.list()).toEqual(expect.arrayContaining(["ws-1", "ws-2"]))
    expect(registry.has("ws-3")).toBe(false)

    // Approvals arrive: the parked runs resume and complete detached.
    runtime.answer("ws-1")
    runtime.answer("ws-2")
    await drained
    await settle()
    expect(completed.sort()).toEqual(["ws-1", "ws-2", "ws-3"])
    expect(registry.list()).toEqual([])
  })

  it("resume continues the SAME turn — no second execute call", async () => {
    const runtime = new MockRuntime(["ws-1"])
    const registry = new DetachedRunRegistry()
    const completed: string[] = []
    const failures: string[] = []
    const process = processJob(runtime, registry, completed, failures)

    const drained = runQueue([makeWorkspace("ws-1")], 2, process)
    await waitUntil(() => registry.has("ws-1"), "ws-1 to park")

    runtime.answer("ws-1")
    await drained
    await settle()

    expect(runtime.executeCalls).toEqual(["ws-1"])
    expect(runtime.turns.get("ws-1")).toEqual(["start", "parked", "resumed"])
    expect(completed).toEqual(["ws-1"])
  })

  it("a detached run that fails after parking still reaches the failure handler", async () => {
    const runtime = new MockRuntime(["ws-1"])
    runtime.failAfterResume("ws-1")
    const registry = new DetachedRunRegistry()
    const completed: string[] = []
    const failures: string[] = []
    const process = processJob(runtime, registry, completed, failures)

    const drained = runQueue([makeWorkspace("ws-1")], 2, process)
    await waitUntil(() => registry.has("ws-1"), "ws-1 to park")

    runtime.answer("ws-1")
    await drained
    await settle()

    expect(failures).toEqual(["ws-1"])
    expect(completed).toEqual([])
    expect(registry.list()).toEqual([])
  })

  it("skips duplicate dispatch for a workspace with a detached run", async () => {
    const runtime = new MockRuntime(["ws-1"])
    const registry = new DetachedRunRegistry()
    const completed: string[] = []
    const failures: string[] = []
    const process = processJob(runtime, registry, completed, failures)

    const drained = runQueue([makeWorkspace("ws-1")], 2, process)
    await waitUntil(() => registry.has("ws-1"), "ws-1 to park")

    // A retry/duplicate job for the parked workspace must NOT start a
    // second execute (it would double-run the workspace).
    const second = await process(makeWorkspace("ws-1"))
    expect(second).toBe("skipped-duplicate")
    expect(runtime.executeCalls).toEqual(["ws-1"])

    runtime.answer("ws-1")
    await drained
    await settle()
    expect(completed).toEqual(["ws-1"])
    // After the run settles, dispatch is allowed again.
    expect(registry.has("ws-1")).toBe(false)
  })

  it("a run that fails BEFORE parking propagates the rejection (blocking parity)", async () => {
    const runtime = new MockRuntime([])
    const registry = new DetachedRunRegistry()
    const completed: string[] = []
    const failures: string[] = []
    const process = processJob(runtime, registry, completed, failures)

    const exploding = makeWorkspace("ws-x")
    vi.spyOn(runtime, "execute").mockImplementationOnce(() => {
      return Promise.reject(new Error("pre-park crash"))
    })

    await expect(process(exploding)).rejects.toThrow("pre-park crash")
    expect(failures).toEqual([])
    expect(completed).toEqual([])
    expect(registry.list()).toEqual([])
  })
})
