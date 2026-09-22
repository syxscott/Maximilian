// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Model catalog tests — three-tier loading, cost semantics (null ≠ 0),
 * cross-process lock behavior and tier inference.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"

import {
  ModelCatalog,
  parseModelsDevCatalog,
  normalizeModelId,
  inferTierFromPrice,
} from "../src/model-catalog.js"

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-providers-catalog-"))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

const REMOTE_BODY = {
  anthropic: {
    models: {
      "claude-test-model": {
        name: "Claude Test",
        cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
        limit: { context: 200_000, output: 64_000 },
        modalities: ["text", "image"],
        reasoning: true,
      },
      "claude-sunset": {
        name: "Claude Sunset",
        cost: { input: 1, output: 2 },
        limit: { context: 100_000 },
        status: "deprecated",
      },
    },
  },
  openai: {
    models: {
      "gpt-test": {
        name: "GPT Test",
        cost: { input: 0.1, output: 0.2 },
        limit: { context: 300_000 },
      },
    },
  },
  broken: { models: "not-an-object" },
}

function okFetch(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(REMOTE_BODY), { status: 200 })) as unknown as typeof fetch
}
function failFetch(): typeof fetch {
  return (async () => {
    throw new Error("offline")
  }) as unknown as typeof fetch
}

describe("parseModelsDevCatalog", () => {
  it("parses the models.dev shape and skips malformed providers", () => {
    const entries = parseModelsDevCatalog(REMOTE_BODY)
    expect(entries).toHaveLength(3)
    const claude = entries.find((e) => e.modelId === "claude-test-model")
    expect(claude).toMatchObject({
      providerId: "anthropic",
      tier: "frontier",
      reasoning: true,
      status: "stable",
    })
    expect(claude?.cost).toEqual({
      inputPerMTok: 3,
      outputPerMTok: 15,
      cacheReadPerMTok: 0.3,
      cacheWritePerMTok: 3.75,
    })
    const sunset = entries.find((e) => e.modelId === "claude-sunset")
    expect(sunset?.status).toBe("deprecated")
  })

  it("models without cost parse with cost=null (unknown ≠ 0)", () => {
    const entries = parseModelsDevCatalog({
      p: { models: { m: { name: "M", limit: { context: 8_192 } } } },
    })
    expect(entries[0]?.cost).toBeNull()
    expect(entries[0]?.tier).toBe("standard")
  })

  it("returns empty for garbage input", () => {
    expect(parseModelsDevCatalog("nope")).toEqual([])
    expect(parseModelsDevCatalog(null)).toEqual([])
  })
})

describe("ModelCatalog three-tier loading", () => {
  it("falls back to the embedded snapshot when offline and cache is cold", async () => {
    const catalog = new ModelCatalog({
      cacheDir: tmp,
      fetchImpl: failFetch(),
      backgroundRefresh: false,
    })
    await catalog.init()
    expect(catalog.info.source).toBe("embedded")
    expect(catalog.info.count).toBeGreaterThan(10)
    expect(catalog.get("anthropic", "claude-sonnet-4-5")).toBeDefined()
  })

  it("loads from the remote and warms the disk cache", async () => {
    const catalog = new ModelCatalog({
      cacheDir: tmp,
      fetchImpl: okFetch(),
      backgroundRefresh: false,
    })
    await catalog.init()
    expect(catalog.info.source).toBe("remote")
    expect(catalog.get("anthropic", "claude-test-model")?.cost?.inputPerMTok).toBe(3)
    const cached = JSON.parse(await fs.readFile(path.join(tmp, "catalog.json"), "utf-8"))
    expect(cached.version).toBe(1)
    expect(cached.entries).toHaveLength(3)
  })

  it("a fresh cache is used without contacting the remote", async () => {
    // Seed the cache.
    const warm = new ModelCatalog({
      cacheDir: tmp,
      fetchImpl: okFetch(),
      backgroundRefresh: false,
    })
    await warm.init()

    let fetchCalls = 0
    const countingFetch: typeof fetch = (async (...args) => {
      fetchCalls += 1
      return (okFetch() as (...a: unknown[]) => Promise<Response>)(...args)
    }) as unknown as typeof fetch

    const coldStart = new ModelCatalog({
      cacheDir: tmp,
      fetchImpl: countingFetch,
      backgroundRefresh: false,
    })
    await coldStart.init()
    expect(coldStart.info.source).toBe("cache")
    expect(fetchCalls).toBe(0)
    expect(coldStart.get("anthropic", "claude-test-model")).toBeDefined()
  })

  it("a stale cache triggers a remote refresh under lock", async () => {
    const warm = new ModelCatalog({
      cacheDir: tmp,
      fetchImpl: okFetch(),
      backgroundRefresh: false,
    })
    await warm.init()

    // Backdate fetchedAt beyond the fresh TTL.
    const cachePath = path.join(tmp, "catalog.json")
    const parsed = JSON.parse(await fs.readFile(cachePath, "utf-8"))
    parsed.fetchedAt = Date.now() - 10 * 60_000
    await fs.writeFile(cachePath, JSON.stringify(parsed))

    let refreshed = false
    const stale = new ModelCatalog({
      cacheDir: tmp,
      fetchImpl: okFetch(),
      backgroundRefresh: false,
    })
    stale.onRefreshed(() => {
      refreshed = true
    })
    await stale.init()
    expect(stale.info.source).toBe("remote")
    expect(refreshed).toBe(true)
  })

  it("a fresh remote lock held elsewhere falls back to stale cache, not embedded", async () => {
    const warm = new ModelCatalog({
      cacheDir: tmp,
      fetchImpl: okFetch(),
      backgroundRefresh: false,
    })
    await warm.init()

    // Backdate past fresh TTL, then place a *fresh* foreign lock.
    const cachePath = path.join(tmp, "catalog.json")
    const parsed = JSON.parse(await fs.readFile(cachePath, "utf-8"))
    parsed.fetchedAt = Date.now() - 10 * 60_000
    await fs.writeFile(cachePath, JSON.stringify(parsed))
    await fs.writeFile(path.join(tmp, "catalog.lock"), `${process.pid} ${Date.now()}`)

    let fetchCalls = 0
    const countingFetch: typeof fetch = (async (...args) => {
      fetchCalls += 1
      return (okFetch() as (...a: unknown[]) => Promise<Response>)(...args)
    }) as unknown as typeof fetch

    const other = new ModelCatalog({
      cacheDir: tmp,
      fetchImpl: countingFetch,
      backgroundRefresh: false,
    })
    await other.init()
    expect(fetchCalls).toBe(0) // lock held by someone fresh → no stampede
    expect(other.info.source).toBe("cache")
  })

  it("a stale lock left by a crashed process is taken over", async () => {
    await fs.writeFile(path.join(tmp, "catalog.lock"), `${process.pid} ${Date.now() - 60_000}`)
    const catalog = new ModelCatalog({
      cacheDir: tmp,
      fetchImpl: okFetch(),
      backgroundRefresh: false,
    })
    await catalog.init()
    expect(catalog.info.source).toBe("remote")
    await expect(fs.access(path.join(tmp, "catalog.lock"))).rejects.toThrow()
  })

  it("concurrent init() calls share one load", async () => {
    let fetchCalls = 0
    const countingFetch: typeof fetch = (async () => {
      fetchCalls += 1
      return new Response(JSON.stringify(REMOTE_BODY), { status: 200 })
    }) as unknown as typeof fetch
    const catalog = new ModelCatalog({
      cacheDir: tmp,
      fetchImpl: countingFetch,
      backgroundRefresh: false,
    })
    await Promise.all([catalog.init(), catalog.init(), catalog.init()])
    expect(fetchCalls).toBe(1)
  })
})

describe("lookups and cost semantics", () => {
  function catalog(): ModelCatalog {
    return new ModelCatalog({
      cacheDir: tmp,
      fetchImpl: okFetch(),
      backgroundRefresh: false,
    })
  }

  it("costOf returns null for unknown models — never 0", async () => {
    // Offline → embedded snapshot, which carries sonnet pricing.
    const offline = new ModelCatalog({
      cacheDir: tmp,
      fetchImpl: failFetch(),
      backgroundRefresh: false,
    })
    await offline.init()
    expect(offline.costOf("unknown-provider", "nope")).toBeNull()
    expect(offline.costOf("anthropic", "claude-sonnet-4-5")?.inputPerMTok).toBe(3)
    // Remote entries without cost stay null too.
    const c = catalog()
    await c.init()
    expect(c.get("openai", "gpt-test")?.cost?.inputPerMTok).toBe(0.1)
  })

  it("find() matches date-stamped aliases by suffix", async () => {
    const offline = new ModelCatalog({
      cacheDir: tmp,
      fetchImpl: failFetch(),
      backgroundRefresh: false,
    })
    await offline.init()
    expect(offline.find("anthropic", "claude-sonnet-4-5")?.modelId).toBe("claude-sonnet-4-5")
    // normalizeModelId strips date stamps, so a dated alias collapses.
    expect(offline.find("anthropic", "claude-sonnet-4-5-20260101")?.modelId).toBe(
      "claude-sonnet-4-5",
    )
  })

  it("list() filters by provider", async () => {
    const c = catalog()
    await c.init()
    expect(c.list("openai")).toHaveLength(1)
    expect(c.list().length).toBe(3)
  })

  it("refresh() returns false and keeps data when the remote is down", async () => {
    const c = catalog()
    await c.init()
    const before = c.info.count
    c.dispose()
    const offline = new ModelCatalog({
      cacheDir: tmp,
      fetchImpl: failFetch(),
      backgroundRefresh: false,
    })
    await offline.init()
    expect(await offline.refresh()).toBe(false)
    expect(offline.info.count).toBe(before)
  })
})

describe("normalizeModelId + tiers", () => {
  it("normalizes case, separators and date stamps", () => {
    expect(normalizeModelId("Claude-Sonnet-4.5")).toBe("claude-sonnet-4-5")
    expect(normalizeModelId("gpt-4.1-20250414")).toBe("gpt-4-1")
    expect(normalizeModelId("GLM_4.6")).toBe("glm-4-6")
  })

  it("infers tiers from price with null → standard", () => {
    expect(inferTierFromPrice(15)).toBe("frontier")
    expect(inferTierFromPrice(3)).toBe("frontier")
    expect(inferTierFromPrice(2.5)).toBe("frontier")
    expect(inferTierFromPrice(1)).toBe("standard")
    expect(inferTierFromPrice(0.1)).toBe("economy")
    expect(inferTierFromPrice(null)).toBe("standard")
  })
})

describe("catalog slugs + frontier pick (preset id ↔ models.dev slug)", () => {
  const VENDOR_BODY = {
    moonshotai: {
      models: {
        "kimi-k3": {
          name: "Kimi K3",
          cost: { input: 0.6, output: 2.5 },
          release_date: "2026-08-01",
        },
        "kimi-old": {
          name: "Kimi Old",
          cost: { input: 0.6, output: 2.5 },
          release_date: "2026-01-01",
        },
      },
    },
    zhipuai: {
      models: {
        "glm-5.3": {
          name: "GLM-5.3",
          cost: { input: 1.4, output: 4.4 },
          release_date: "2026-07-15",
        },
      },
    },
    alibaba: {
      models: {
        "qwen3.8-max": {
          name: "Qwen3.8 Max",
          cost: { input: 1.2, output: 6 },
          release_date: "2026-09-01",
        },
        "qwen3.8-flash": {
          name: "Qwen3.8 Flash",
          cost: { input: 0.1, output: 0.4 },
          release_date: "2026-09-15",
        },
      },
    },
  }

  function vendorFetch(body: unknown): typeof fetch {
    return (async () =>
      new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch
  }

  async function loadedCatalog(body: unknown): Promise<ModelCatalog> {
    const catalog = new ModelCatalog({
      cacheDir: tmp,
      fetchImpl: vendorFetch(body),
      backgroundRefresh: false,
    })
    await catalog.init()
    return catalog
  }

  it("resolves preset ids through the slug alias table", async () => {
    const catalog = await loadedCatalog(VENDOR_BODY)
    expect(catalog.listForPreset("kimi").map((e) => e.modelId)).toEqual(["kimi-k3", "kimi-old"])
    expect(catalog.listForPreset("kimi-2")).toHaveLength(2)
    expect(catalog.listForPreset("zhipu").map((e) => e.modelId)).toEqual(["glm-5.3"])
    expect(catalog.listForPreset("dashscope-bailian")).toHaveLength(2)
    expect(catalog.listForPreset("nonexistent-vendor")).toEqual([])
  })

  it("picks the flagship: top tier present, newest release within it", async () => {
    const catalog = await loadedCatalog(VENDOR_BODY)
    // moonshotai: same tier → newest release_date wins (kimi-k3).
    expect(catalog.frontierForPreset("kimi")?.modelId).toBe("kimi-k3")
    // alibaba: standard (qwen3.8-max) outranks economy (qwen3.8-flash) even
    // though flash is newer — tier is the primary sort.
    expect(catalog.frontierForPreset("dashscope-bailian")?.modelId).toBe("qwen3.8-max")
    // Unknown vendor → undefined, caller keeps the frozen preset default.
    expect(catalog.frontierForPreset("nonexistent-vendor")).toBeUndefined()
  })

  it("captures release_date and defaults status to stable during parse", () => {
    const entries = parseModelsDevCatalog(VENDOR_BODY)
    const k3 = entries.find((e) => e.modelId === "kimi-k3")
    expect(k3?.releaseDate).toBe("2026-08-01")
    expect(k3?.status).toBe("stable")
  })

  it("never picks alpha/beta/deprecated entries", async () => {
    const catalog = await loadedCatalog({
      deepseek: {
        models: {
          "deepseek-beta": {
            name: "Beta",
            cost: { input: 5, output: 20 },
            release_date: "2026-09-20",
            status: "beta",
          },
          "deepseek-v4-pro": {
            name: "V4 Pro",
            cost: { input: 0.5, output: 2 },
            release_date: "2026-08-13",
          },
        },
      },
    })
    expect(catalog.frontierForPreset("deepseek")?.modelId).toBe("deepseek-v4-pro")
  })
})
