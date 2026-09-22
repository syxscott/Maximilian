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
