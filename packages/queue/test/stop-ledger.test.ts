// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the durable workspace stop ledger and the waiting-job
 * cancellation helpers (MiniApps minimax-bot engine.mjs 0e8c24a borrowing:
 * a queued job must be stoppable before its run registers).
 *
 * Everything here is Redis-free: the ledger has an in-memory port and the
 * BullMQ helpers are exercised through structural fakes.
 */
import { describe, expect, it, vi } from "vitest"
import type { Redis } from "ioredis"
import {
  claimWorkspaceRecovery,
  InMemoryWorkspaceStopLedger,
  RECOVERY_CLAIM_KEY_PREFIX,
  releaseWorkspaceRecoveryClaim,
  RedisWorkspaceStopLedger,
  skipIfWorkspaceStopped,
  workspaceRecoveryClaimKey,
  workspaceStoppedKey,
  WORKSPACE_STOPPED_KEY_PREFIX as STOPPED_KEY_PREFIX,
} from "../src/stop-ledger.js"
import type { WorkspaceStopLedger } from "../src/stop-ledger.js"
import {
  cancelWaitingJob,
  cancelWaitingWorkspaceJobs,
  isCancellableWaitingState,
} from "../src/index.js"
import type { JobListingQueue, WaitingJobHandle } from "../src/index.js"

describe("workspace stop ledger", () => {
  it("key is namespaced and stable", () => {
    expect(STOPPED_KEY_PREFIX).toBe("maximilian:workspace:stopped:")
    expect(workspaceStoppedKey("ws-1")).toBe("maximilian:workspace:stopped:ws-1")
  })

  it("in-memory ledger marks, reads and clears", async () => {
    const ledger = new InMemoryWorkspaceStopLedger()
    expect(await ledger.isStopped("ws-1")).toBe(false)
    await ledger.markStopped("ws-1", "user stop")
    expect(await ledger.isStopped("ws-1")).toBe(true)
    expect(ledger.size).toBe(1)
    await ledger.clear("ws-1")
    expect(await ledger.isStopped("ws-1")).toBe(false)
  })

  it("redis ledger writes a TTL-stamped marker and closes its connection", async () => {
    const conn = {
      set: vi.fn(async () => "OK"),
      exists: vi.fn(async () => 1),
      del: vi.fn(async () => 1),
      disconnect: vi.fn(),
    } as unknown as Redis
    const ledger = new RedisWorkspaceStopLedger(conn, 2)
    await ledger.markStopped("ws-redis", "user stop")
    expect(conn.set).toHaveBeenCalledWith(
      workspaceStoppedKey("ws-redis"),
      expect.any(String),
      "PX",
      2_000,
    )
    expect(await ledger.isStopped("ws-redis")).toBe(true)
    await ledger.clear("ws-redis")
    expect(conn.del).toHaveBeenCalledWith(workspaceStoppedKey("ws-redis"))
    ledger.close()
    expect(conn.disconnect).toHaveBeenCalledTimes(1)
  })
})

// ── Crash-recovery enqueue claim ───────────────────────────────────────────

/** Minimal Redis fake with SET NX + PX and DEL semantics. */
function fakeNxRedis() {
  const keys = new Map<string, string>()
  return {
    keys,
    async set(key: string, value: string, ...args: string[]) {
      // Yield so two concurrent callers genuinely interleave at the await.
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (args.includes("NX") && keys.has(key)) return null
      keys.set(key, value)
      return "OK"
    },
    async del(key: string) {
      return keys.delete(key) ? 1 : 0
    },
  }
}

describe("crash-recovery enqueue claim", () => {
  it("namespaces the claim key per workspace", () => {
    expect(RECOVERY_CLAIM_KEY_PREFIX).toBe("maximilian:recovery-claim:")
    expect(workspaceRecoveryClaimKey("ws-1")).toBe("maximilian:recovery-claim:ws-1")
  })

  it("grants the claim to exactly one of two concurrent sweepers", async () => {
    const conn = fakeNxRedis()
    const results = await Promise.all([
      claimWorkspaceRecovery(conn as unknown as Redis, "ws-1"),
      claimWorkspaceRecovery(conn as unknown as Redis, "ws-1"),
    ])
    expect(results.filter((granted) => granted)).toHaveLength(1)
    expect(conn.keys.has(workspaceRecoveryClaimKey("ws-1"))).toBe(true)
  })

  it("lets a later sweeper claim after the winner releases", async () => {
    const conn = fakeNxRedis()
    expect(await claimWorkspaceRecovery(conn as unknown as Redis, "ws-1")).toBe(true)
    await releaseWorkspaceRecoveryClaim(conn as unknown as Redis, "ws-1")
    expect(conn.keys.has(workspaceRecoveryClaimKey("ws-1"))).toBe(false)
    expect(await claimWorkspaceRecovery(conn as unknown as Redis, "ws-1")).toBe(true)
  })

  it("fails open when Redis is unreachable (best-effort recovery)", async () => {
    const broken = {
      set: vi.fn(async () => {
        throw new Error("ECONNREFUSED")
      }),
    }
    expect(await claimWorkspaceRecovery(broken as unknown as Redis, "ws-1")).toBe(true)
  })

  it("refuses an empty workspace id", async () => {
    const conn = fakeNxRedis()
    expect(await claimWorkspaceRecovery(conn as unknown as Redis, "")).toBe(false)
  })
})

describe("skipIfWorkspaceStopped (dispatch guard)", () => {
  it("does nothing when no marker exists", async () => {
    const ledger = new InMemoryWorkspaceStopLedger()
    const discard = vi.fn()
    const skipped = await skipIfWorkspaceStopped(ledger, {
      data: { workspaceId: "ws-1" },
      discard,
    })
    expect(skipped).toBe(false)
    expect(discard).not.toHaveBeenCalled()
  })

  it("skips and discards a stopped workspace", async () => {
    const ledger = new InMemoryWorkspaceStopLedger()
    await ledger.markStopped("ws-1")
    const discard = vi.fn()
    const skipped = await skipIfWorkspaceStopped(ledger, {
      data: { workspaceId: "ws-1" },
      discard,
    })
    expect(skipped).toBe(true)
    expect(discard).toHaveBeenCalledTimes(1)
  })

  it("ignores payloads without a workspaceId", async () => {
    const ledger = new InMemoryWorkspaceStopLedger()
    await ledger.markStopped("")
    expect(await skipIfWorkspaceStopped(ledger, { data: {}, discard: vi.fn() })).toBe(false)
    expect(await skipIfWorkspaceStopped(ledger, { data: {} })).toBe(false)
  })

  it("fails open when the ledger errors (availability over false stops)", async () => {
    const ledger: WorkspaceStopLedger = {
      markStopped: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
      isStopped: vi.fn(async () => {
        throw new Error("ECONNRESET")
      }),
    }
    const skipped = await skipIfWorkspaceStopped(ledger, {
      data: { workspaceId: "ws-1" },
      discard: vi.fn(),
    })
    expect(skipped).toBe(false)
  })

  it("does not let a discard() failure turn into a crash", async () => {
    const ledger = new InMemoryWorkspaceStopLedger()
    await ledger.markStopped("ws-1")
    const skipped = await skipIfWorkspaceStopped(ledger, {
      data: { workspaceId: "ws-1" },
      discard: () => {
        throw new Error("missing lock")
      },
    })
    expect(skipped).toBe(true)
  })
})

// ── Waiting-job cancellation helpers ──────────────────────────────────────

interface FakeJob extends WaitingJobHandle {
  state: string
  removed: boolean
  failRemove: boolean
}

function fakeJob(id: string, state: string, workspaceId?: string): FakeJob {
  return {
    id,
    state,
    data: workspaceId === undefined ? {} : { workspaceId },
    removed: false,
    failRemove: false,
    async getState() {
      return this.state
    },
    async remove() {
      if (this.failRemove) throw new Error("EIO")
      this.removed = true
    },
  }
}

function fakeQueues(jobs: FakeJob[]): JobListingQueue {
  return {
    getJob: async (jobId: string) => jobs.find((j) => j.id === jobId),
    getJobs: async () => jobs,
  }
}

describe("isCancellableWaitingState", () => {
  it("accepts only waiting/delayed/paused", () => {
    expect(isCancellableWaitingState("waiting")).toBe(true)
    expect(isCancellableWaitingState("delayed")).toBe(true)
    expect(isCancellableWaitingState("paused")).toBe(true)
    expect(isCancellableWaitingState("active")).toBe(false)
    expect(isCancellableWaitingState("completed")).toBe(false)
    expect(isCancellableWaitingState("failed")).toBe(false)
  })
})

describe("cancelWaitingJob", () => {
  it("removes a waiting job", async () => {
    const job = fakeJob("j1", "waiting", "ws-1")
    const result = await cancelWaitingJob(fakeQueues([job]), "j1")
    expect(result).toEqual({ cancelled: true, jobId: "j1", state: "waiting" })
    expect(job.removed).toBe(true)
  })

  it("removes delayed and paused jobs too", async () => {
    const delayed = fakeJob("j2", "delayed", "ws-1")
    const paused = fakeJob("j3", "paused", "ws-1")
    const queue = fakeQueues([delayed, paused])
    expect((await cancelWaitingJob(queue, "j2")).cancelled).toBe(true)
    expect((await cancelWaitingJob(queue, "j3")).cancelled).toBe(true)
  })

  it("refuses an active job instead of removing it", async () => {
    const job = fakeJob("j4", "active", "ws-1")
    const result = await cancelWaitingJob(fakeQueues([job]), "j4")
    expect(result.cancelled).toBe(false)
    expect(result.reason).toContain("active")
    expect(job.removed).toBe(false)
  })

  it("reports a missing job honestly", async () => {
    const result = await cancelWaitingJob(fakeQueues([]), "ghost")
    expect(result.cancelled).toBe(false)
    expect(result.reason).toBe("job not found")
  })

  it("surfaces a remove failure instead of pretending success", async () => {
    const job = fakeJob("j5", "waiting", "ws-1")
    job.failRemove = true
    const result = await cancelWaitingJob(fakeQueues([job]), "j5")
    expect(result.cancelled).toBe(false)
    expect(result.reason).toContain("EIO")
    expect(job.removed).toBe(false)
  })
})

describe("cancelWaitingWorkspaceJobs", () => {
  it("removes only jobs targeting the workspace", async () => {
    const mine1 = fakeJob("w1", "waiting", "ws-target")
    const mine2 = fakeJob("w2", "delayed", "ws-target")
    const other = fakeJob("o1", "waiting", "ws-other")
    const summary = await cancelWaitingWorkspaceJobs(fakeQueues([mine1, mine2, other]), "ws-target")
    expect(summary.cancelledJobIds.sort()).toEqual(["w1", "w2"])
    expect(mine1.removed && mine2.removed).toBe(true)
    expect(other.removed).toBe(false)
    expect(summary.errors).toEqual([])
  })

  it("returns an empty sweep when nothing matches", async () => {
    const other = fakeJob("o1", "waiting", "ws-other")
    const summary = await cancelWaitingWorkspaceJobs(fakeQueues([other]), "ws-none")
    expect(summary.cancelledJobIds).toEqual([])
    expect(other.removed).toBe(false)
  })

  it("collects per-job failures and keeps sweeping", async () => {
    const bad = fakeJob("bad", "waiting", "ws-target")
    bad.failRemove = true
    const good = fakeJob("good", "waiting", "ws-target")
    const summary = await cancelWaitingWorkspaceJobs(fakeQueues([bad, good]), "ws-target")
    expect(summary.cancelledJobIds).toEqual(["good"])
    expect(summary.errors).toHaveLength(1)
    expect(good.removed).toBe(true)
  })

  it("reports a listing failure as an error, not a throw", async () => {
    const queue: JobListingQueue = {
      getJob: async () => undefined,
      getJobs: async () => {
        throw new Error("Redis down")
      },
    }
    const summary = await cancelWaitingWorkspaceJobs(queue, "ws-1")
    expect(summary.cancelledJobIds).toEqual([])
    expect(summary.errors[0]).toContain("Redis down")
  })
})
