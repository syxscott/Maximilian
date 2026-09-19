// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the M-next self-contained modules (hermes/deepseek borrowings):
 * RemoteError vocabulary, ActivationPool, image eviction policy, credential
 * vault core, and cron pending-slot exactly-once.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"
import { RemoteError, declareRemoteCode, isRemoteError } from "../src/remote-error.js"
import { ActivationPool, ActivationLimitReachedError } from "../src/activation-pool.js"
import { planImageEviction } from "../src/image-eviction.js"
import { Vault } from "../src/vault.js"
import { PendingSlotManager } from "../src/cron-slot.js"

describe("RemoteError vocabulary", () => {
  it("declares codes once; duplicates throw", () => {
    declareRemoteCode("test/unique-ok", "test")
    expect(() => declareRemoteCode("test/unique-ok", "test-again")).toThrow(/already declared/)
  })

  it("discriminates by code, not instanceof subclass", () => {
    const err = new RemoteError("session/writer-held", "writer held", { sessionId: "s1" })
    expect(isRemoteError(err)).toBe(true)
    expect(isRemoteError(err, "session/writer-held")).toBe(true)
    expect(isRemoteError(err, "gateway/cancelled")).toBe(false)
    expect(isRemoteError(new Error("plain"))).toBe(false)
    expect(err.details).toEqual({ sessionId: "s1" })
  })
})

describe("ActivationPool", () => {
  it("refuses a full pool with the structured code (no queuing)", () => {
    const pool = new ActivationPool(2)
    const a = pool.reserve()
    const b = pool.reserve()
    expect(pool.activeCount).toBe(2)
    expect(() => pool.reserve()).toThrow(ActivationLimitReachedError)
    try {
      pool.reserve()
    } catch (err) {
      expect((err as ActivationLimitReachedError).code).toBe("subagent/activation-limit")
    }
    pool.release(a)
    expect(pool.activeCount).toBe(1)
    pool.release(a) // idempotent
    expect(pool.activeCount).toBe(1)
    void b
  })

  it("withSlot releases on both success and failure", async () => {
    const pool = new ActivationPool(1)
    await pool.withSlot(async () => 1)
    expect(pool.activeCount).toBe(0)
    await expect(
      pool.withSlot(async () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    expect(pool.activeCount).toBe(0)
  })
})

describe("planImageEviction", () => {
  const imgs = (sizes: number[]) =>
    sizes.map((sizeBytes, index) => ({ index, sizeBytes, seq: index }))

  it("noops when under both constraints", () => {
    const plan = planImageEviction(imgs([100, 100, 100]), { maxCount: 20, maxTotalBytes: 1000 })
    expect(plan.noop).toBe(true)
    expect(plan.evict).toHaveLength(0)
  })

  it("batch-evicts oldest-first over the count cap, keeping the newest", () => {
    const plan = planImageEviction(imgs([10, 10, 10, 10, 10]), { maxCount: 3, maxTotalBytes: 1000 })
    expect(plan.noop).toBe(false)
    expect(plan.evict.sort()).toEqual([0, 1])
    expect(plan.keep.sort()).toEqual([2, 3, 4])
  })

  it("batch-evicts over the byte budget", () => {
    const plan = planImageEviction(imgs([800, 800, 100]), { maxCount: 20, maxTotalBytes: 1000 })
    expect(plan.evict).toEqual([0])
    expect(plan.keep).toEqual([1, 2])
  })
})

describe("Vault core", () => {
  let dir: string
  let file: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-"))
    file = path.join(dir, "vault.json")
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("save/resolve round-trips through encryption at rest", async () => {
    const vault = new Vault(file, "master-pass")
    const meta = await vault.save({
      title: "Example login",
      secret: "s3cret-value",
      username: "me",
      origin: "https://example.com",
    })
    await vault.load()

    const raw = await fs.readFile(file, "utf8")
    expect(raw).not.toContain("s3cret-value")
    expect(raw).toContain("Example login") // metadata is visible
    expect(vault.resolve(meta.handle)).toBe("s3cret-value")
  })

  it("redacts resolved secrets out of arbitrary text", async () => {
    const vault = new Vault(file, "pw")
    const meta = await vault.save({ title: "t", secret: "super-secret-1" })
    vault.resolve(meta.handle)
    const out = vault.redact("output: super-secret-1 and more")
    expect(out).toBe("output: [redacted] and more")
  })

  it("remove deletes the entry and its redaction", async () => {
    const vault = new Vault(file, "pw")
    const meta = await vault.save({ title: "t", secret: "v1" })
    vault.resolve(meta.handle)
    expect(await vault.remove(meta.handle)).toBe(true)
    expect(vault.list()).toHaveLength(0)
    expect(() => vault.resolve(meta.handle)).toThrow(/unknown handle/)
  })
})

describe("PendingSlotManager (cron exactly-once)", () => {
  function makeStore() {
    const map = new Map<string, unknown>()
    return {
      async get(key: string) {
        return map.get(`slot:${key}`) as undefined
      },
      getPending: (key: string) => map.get(`slot:${key}`),
      async set(key: string, v: unknown) {
        map.set(`slot:${key}`, v)
      },
      async clear(key: string) {
        map.delete(`slot:${key}`)
      },
      map,
    }
  }
  const iso = (ms: number) => new Date(ms).toISOString()

  it("mark → recover-own → clear is exactly-once", async () => {
    const store = makeStore()
    const mgr = new PendingSlotManager(store as never, { machineId: "m1", now: () => 1_000 })
    await mgr.markPending("job-1", iso(900))

    const rec = await mgr.recoverOnce("job-1")
    expect(rec.shouldDispatch).toBe(true)
    expect(rec.reason).toContain("own stale slot")
    await mgr.clear("job-1")
    const again = await mgr.recoverOnce("job-1")
    expect(again.shouldDispatch).toBe(false)
  })

  it("unreachable ladder: zero-side-effect retries, then exhausts; side effects never retry", () => {
    const mgr = new PendingSlotManager({} as never, { machineId: "m" })
    expect(mgr.unreachableRetryDecision(1, 0, 0).retry).toBe(true)
    expect(mgr.unreachableRetryDecision(2, 0, 0).retry).toBe(true)
    expect(mgr.unreachableRetryDecision(3, 0, 0).retry).toBe(true)
    const exhausted = mgr.unreachableRetryDecision(4, 0, 0)
    expect(exhausted.retry).toBe(false)
    const withEffects = mgr.unreachableRetryDecision(1, 2, 0)
    expect(withEffects.retry).toBe(false)
    expect(withEffects.reason).toContain("no auto-retry")
  })
})
