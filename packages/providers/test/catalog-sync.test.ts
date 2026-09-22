// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for RemoteCatalogSynchronizer (ZCode provider-node borrowing):
 * lease-based sync, https-only boundary, budget, failure backoff.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"
import { RemoteCatalogSynchronizer } from "../src/catalog-sync.js"

function makeSync(opts: {
  remoteUrl?: string
  controlDir?: string
  respond: () => { ok: boolean; json?: unknown } | "throw"
  now?: () => number
}): {
  sync: RemoteCatalogSynchronizer
  controlPath: string
  readControl: () => Promise<Record<string, unknown> | undefined>
} {
  const controlDir = opts.controlDir ?? os.tmpdir()
  const sync = new RemoteCatalogSynchronizer({
    controlDir,
    remoteUrl: opts.remoteUrl ?? "https://models.dev/api.json",
    now: opts.now,
    fetchImpl: (async () => {
      const r = opts.respond()
      if (r === "throw") throw new Error("network down")
      return { ok: r.ok, json: async () => r.json } as Response
    }) as typeof fetch,
  })
  const controlPath = path.join(controlDir, "catalog-sync-control.json")
  const readControl = async () => {
    try {
      return JSON.parse(await fs.readFile(controlPath, "utf8"))
    } catch {
      return undefined
    }
  }
  return { sync, controlPath, readControl }
}

describe("RemoteCatalogSynchronizer", () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "catalogsync-"))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("rejects non-https remote URLs at construction", () => {
    expect(
      () =>
        new RemoteCatalogSynchronizer({
          controlDir: dir,
          remoteUrl: "http://models.dev/api.json",
        }),
    ).toThrow(/https/)
  })

  it("returns the JSON body on success and records lastSuccessAt", async () => {
    const { sync, readControl } = makeSync({
      controlDir: dir,
      respond: () => ({ ok: true, json: { models: [] } }),
    })
    const body = await sync.syncOnce()
    expect(body).toEqual({ models: [] })
    const control = await readControl()
    expect(control?.lastSuccessAt).toBeDefined()
    expect(control?.failureCount).toBe(0)
  })

  it("backoffs after a failure and records the failure count", async () => {
    let t = 1_000_000
    const { sync, readControl } = makeSync({
      controlDir: dir,
      respond: () => "throw",
      now: () => t,
    })
    const first = await sync.syncOnce()
    expect(first).toBeNull()
    const control = await readControl()
    expect(control?.failureCount).toBe(1)

    // Backoff window: the immediate second attempt is skipped (null), and
    // the failure count is preserved.
    const second = await sync.syncOnce()
    expect(second).toBeNull()
    const control2 = await readControl()
    expect(control2?.failureCount).toBe(1)
    void t
  })
})

describe("RemoteCatalogSynchronizer backoff + interval semantics", () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "catalogsync2-"))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("skipped backoff polls do NOT slide the backoff window forward", async () => {
    // Failure at t=0 → failureCount=1 → backoff 2^1*30s = 60s. A poller
    // knocking every 30s must not reset the clock (regression: the lease
    // used to be rewritten on every skipped poll, so the backoff never
    // elapsed under a steady poller).
    let t = 0
    let fetches = 0
    const sync = new RemoteCatalogSynchronizer({
      controlDir: dir,
      remoteUrl: "https://models.dev/api.json",
      now: () => t,
      fetchImpl: (async () => {
        fetches += 1
        throw new Error("network down")
      }) as typeof fetch,
    })
    expect(await sync.syncOnce()).toBeNull() // failure #1 at t=0
    expect(fetches).toBe(1)

    t = 60_000 // backoff elapsed → retry happens, fails again
    expect(await sync.syncOnce()).toBeNull() // failure #2 → failureCount=2
    expect(fetches).toBe(2)

    // Now failureCount=2 → backoff 120s but the lease only covers 60s, so
    // polls between t=120s and t=180s reach the backoff branch. They must
    // skip WITHOUT rewriting the lease (the regression slid `lastAttempt`
    // to "now" here, so the backoff never elapsed under a steady poller).
    t = 150_000
    expect(await sync.syncOnce()).toBeNull()
    expect(fetches).toBe(2)

    t = 180_000 // 120s since the failure at t=60s → retry happens
    expect(await sync.syncOnce()).toBeNull() // fetch runs, fails again
    expect(fetches).toBe(3)
  })

  it("skips the download while the last success is fresher than intervalMs", async () => {
    let t = 1_000_000
    let fetches = 0
    const sync = new RemoteCatalogSynchronizer({
      controlDir: dir,
      remoteUrl: "https://models.dev/api.json",
      intervalMs: 60 * 60_000,
      now: () => t,
      fetchImpl: (async () => {
        fetches += 1
        return {
          ok: true,
          json: async () => ({ ok: true }),
        } as unknown as Response
      }) as typeof fetch,
    })
    const first = await sync.syncOnce()
    expect(first).toEqual({ ok: true })
    expect(fetches).toBe(1)

    t += 10 * 60_000 // 10 min later — inside the 1h interval
    expect(await sync.syncOnce()).toBeNull()
    expect(fetches).toBe(1)

    t += 51 * 60_000 // past the interval → refetch
    expect(await sync.syncOnce()).toEqual({ ok: true })
    expect(fetches).toBe(2)
  })
})
