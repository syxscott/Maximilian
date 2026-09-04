// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Unified model catalog — three-tier loading (borrowed from opencode
 * `packages/core/src/models-dev.ts`):
 *
 *   1. warm disk cache (TTL-gated, `freshTtlMs`)
 *   2. remote catalog  (models.dev-style api.json, refreshed under a
 *      cross-process lockfile so N workers don't stampede the endpoint)
 *   3. embedded snapshot (`model-catalog-snapshot.ts`) — boot fallback so
 *      the process always answers even fully offline
 *
 * Cost semantics (opencode `packages/llm/DESIGN.md`): a missing price is
 * `null`, never 0 — callers must distinguish "unknown" from "free" and
 * refuse to compute a run total when any turn's price is unknown.
 *
 * No new dependencies: the remote payload is validated by hand (the
 * models.dev shape is small and stable) instead of pulling zod into this
 * package.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"
import { EMBEDDED_CATALOG, inferTierFromPrice } from "./model-catalog-snapshot.js"

// ── Types ───────────────────────────────────────────────────────────────────

export interface ModelCost {
  /** USD per 1M input tokens. */
  inputPerMTok: number
  /** USD per 1M output tokens. */
  outputPerMTok: number
  /** USD per 1M cache-read tokens, when the provider reports it. */
  cacheReadPerMTok?: number
  /** USD per 1M cache-write tokens, when the provider reports it. */
  cacheWritePerMTok?: number
}

export type ModelTier = "frontier" | "standard" | "economy"
export type ModelStatus = "stable" | "alpha" | "beta" | "deprecated"

export interface ModelCatalogEntry {
  /** Catalog provider slug ("anthropic", "openai", …). */
  providerId: string
  /** Provider-side model id ("claude-sonnet-4-5", …). */
  modelId: string
  name: string
  /** `null` = pricing unknown. Never fabricate 0. */
  cost: ModelCost | null
  limit: { context: number; output?: number }
  modalities: string[]
  reasoning: boolean
  status: ModelStatus
  /** Value tier derived from price (see `inferTierFromPrice`). */
  tier: ModelTier
}

export type CatalogSource = "embedded" | "cache" | "remote"

export interface CatalogInfo {
  source: CatalogSource
  count: number
  /** Epoch ms of the last successful remote/cache load, if any. */
  fetchedAt?: number
}

export interface ModelCatalogOptions {
  /** Cache directory. Default `<tmpdir>/max-model-catalog`. */
  cacheDir?: string
  /** Remote catalog URL. Default env `MODEL_CATALOG_URL` or models.dev. */
  remoteUrl?: string
  fetchImpl?: typeof fetch
  /** A cache younger than this is used without contacting the remote. Default 5 min. */
  freshTtlMs?: number
  /** Stale-lock takeover age for the cross-process lockfile. Default 30 s. */
  lockStaleMs?: number
  /** Background refresh interval. Default 60 min (opencode parity). */
  refreshIntervalMs?: number
  /** Disable the background refresh timer (tests). */
  backgroundRefresh?: boolean
  /** Time source override (tests). */
  now?: () => number
}

interface CacheFile {
  version: 1
  fetchedAt: number
  entries: ModelCatalogEntry[]
}

// ── Remote (models.dev) payload parsing ─────────────────────────────────────

/**
 * Parse the models.dev `api.json` shape:
 * `{ "<provider>": { "models": { "<model>": { cost: {input, output, …}, limit: {context, output}, … } } } }`.
 * Unknown/malformed providers are skipped rather than failing the load.
 */
export function parseModelsDevCatalog(raw: unknown): ModelCatalogEntry[] {
  if (typeof raw !== "object" || raw === null) return []
  const byProvider = raw as Record<string, unknown>
  const out: ModelCatalogEntry[] = []
  for (const [providerId, providerVal] of Object.entries(byProvider)) {
    if (typeof providerVal !== "object" || providerVal === null) continue
    const models = (providerVal as Record<string, unknown>).models
    if (typeof models !== "object" || models === null) continue
    for (const [modelId, modelVal] of Object.entries(models as Record<string, unknown>)) {
      const entry = parseModelsDevEntry(providerId, modelId, modelVal)
      if (entry) out.push(entry)
    }
  }
  return out
}

function parseModelsDevEntry(
  providerId: string,
  modelId: string,
  val: unknown,
): ModelCatalogEntry | undefined {
  if (typeof val !== "object" || val === null) return undefined
  const m = val as Record<string, unknown>
  const name = typeof m.name === "string" ? m.name : modelId

  let cost: ModelCost | null = null
  if (typeof m.cost === "object" && m.cost !== null) {
    const c = m.cost as Record<string, unknown>
    const input = asNumber(c.input)
    const output = asNumber(c.output)
    if (input !== undefined && output !== undefined) {
      cost = {
        inputPerMTok: input,
        outputPerMTok: output,
        ...(asNumber(c.cache_read) !== undefined
          ? { cacheReadPerMTok: asNumber(c.cache_read) }
          : {}),
        ...(asNumber(c.cache_write) !== undefined
          ? { cacheWritePerMTok: asNumber(c.cache_write) }
          : {}),
      }
    }
  }

  const limitRaw = (typeof m.limit === "object" && m.limit !== null ? m.limit : {}) as Record<
    string,
    unknown
  >
  const context = asNumber(limitRaw.context) ?? 128_000
  const outputLimit = asNumber(limitRaw.output)

  const modalities = Array.isArray(m.modalities)
    ? (m.modalities as unknown[]).filter((x): x is string => typeof x === "string")
    : ["text"]

  const statusRaw = typeof m.status === "string" ? m.status : "stable"
  const status: ModelStatus =
    statusRaw === "alpha" || statusRaw === "beta" || statusRaw === "deprecated"
      ? statusRaw
      : "stable"

  return {
    providerId,
    modelId,
    name,
    cost,
    limit: { context, ...(outputLimit !== undefined ? { output: outputLimit } : {}) },
    modalities,
    reasoning: m.reasoning === true,
    status,
    tier: inferTierFromPrice(cost?.inputPerMTok ?? null),
  }
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

// ── Cross-process lockfile (opencode Flock borrowing, best-effort) ─────────

interface LockHandle {
  path: string
  release: () => Promise<void>
}

async function acquireLock(
  dir: string,
  staleMs: number,
  now: () => number,
): Promise<LockHandle | null> {
  const lockPath = path.join(dir, "catalog.lock")
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await fs.open(lockPath, "wx")
      await fh.write(`${process.pid} ${now()}`)
      await fh.close()
      return {
        path: lockPath,
        release: async () => {
          await fs.rm(lockPath, { force: true })
        },
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") return null
      // Lock exists: take over only when stale.
      try {
        const raw = await fs.readFile(lockPath, "utf-8")
        const created = Number(raw.split(" ")[1])
        if (Number.isFinite(created) && now() - created < staleMs) return null // someone else is fresh
      } catch {
        // unreadable lock — treat as stale below
      }
      await fs.rm(lockPath, { force: true }) // stale takeover, retry once
    }
  }
  return null
}

// ── Catalog ─────────────────────────────────────────────────────────────────

export class ModelCatalog {
  private entries: ModelCatalogEntry[] = EMBEDDED_CATALOG
  private source: CatalogSource = "embedded"
  private fetchedAt: number | undefined
  private initPromise: Promise<void> | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private readonly refreshedCbs = new Set<() => void>()

  constructor(private readonly opts: ModelCatalogOptions = {}) {}

  private get cacheDir(): string {
    return this.opts.cacheDir ?? path.join(os.tmpdir(), "max-model-catalog")
  }
  private get cacheFile(): string {
    return path.join(this.cacheDir, "catalog.json")
  }
  private get remoteUrl(): string {
    return this.opts.remoteUrl ?? process.env.MODEL_CATALOG_URL ?? "https://models.dev/api.json"
  }
  private get freshTtlMs(): number {
    return this.opts.freshTtlMs ?? 5 * 60_000
  }
  private get now(): () => number {
    return this.opts.now ?? Date.now
  }

  /**
   * Load the catalog: warm cache → remote refresh (under lock, when stale)
   * → embedded fallback. Idempotent and concurrency-safe within the
   * process (second `init()` while one is in flight returns the same
   * promise).
   */
  async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.load().catch(() => {
        // load() already falls back to embedded; never reject init.
      })
    }
    await this.initPromise
    if (this.opts.backgroundRefresh !== false && this.refreshTimer === null) {
      const interval = this.opts.refreshIntervalMs ?? 60 * 60_000
      this.refreshTimer = setTimeout(() => {
        void this.refresh().catch(() => {})
      }, interval)
      // Never hold the process open for a background refresh.
      this.refreshTimer.unref?.()
    }
  }

  private async load(): Promise<void> {
    const now = this.now()
    // Tier 1: warm cache.
    const cached = await this.readCache()
    if (cached && now - cached.fetchedAt < this.freshTtlMs) {
      this.entries = cached.entries
      this.source = "cache"
      this.fetchedAt = cached.fetchedAt
      return
    }
    // Tier 2: remote refresh under cross-process lock.
    const lock = await acquireLock(this.cacheDir, this.opts.lockStaleMs ?? 30_000, this.now)
    if (lock) {
      try {
        const ok = await this.fetchRemote()
        if (ok) return
      } finally {
        await lock.release()
      }
    }
    // Lock held elsewhere (another process is fetching) or fetch failed:
    // stale cache beats embedded.
    if (cached) {
      this.entries = cached.entries
      this.source = "cache"
      this.fetchedAt = cached.fetchedAt
      return
    }
    // Tier 3: embedded snapshot.
    this.entries = EMBEDDED_CATALOG
    this.source = "embedded"
    this.fetchedAt = undefined
  }

  private async readCache(): Promise<CacheFile | null> {
    try {
      const raw = await fs.readFile(this.cacheFile, "utf-8")
      const parsed = JSON.parse(raw) as CacheFile
      if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return null
      return parsed
    } catch {
      return null
    }
  }

  private async fetchRemote(): Promise<boolean> {
    try {
      const fetchImpl = this.opts.fetchImpl ?? fetch
      const res = await fetchImpl(this.remoteUrl)
      if (!res.ok) return false
      const raw: unknown = await res.json()
      const entries = parseModelsDevCatalog(raw)
      if (entries.length === 0) return false
      this.entries = entries
      this.source = "remote"
      this.fetchedAt = this.now()
      await fs.mkdir(this.cacheDir, { recursive: true })
      const cache: CacheFile = { version: 1, fetchedAt: this.fetchedAt, entries }
      await fs.writeFile(this.cacheFile, JSON.stringify(cache))
      for (const cb of this.refreshedCbs) cb()
      return true
    } catch {
      return false
    }
  }

  /**
   * Force a remote refresh. Returns true when new data was loaded; never
   * throws (offline = keep what you have).
   */
  async refresh(): Promise<boolean> {
    const lock = await acquireLock(this.cacheDir, this.opts.lockStaleMs ?? 30_000, this.now)
    if (!lock) return false
    try {
      return await this.fetchRemote()
    } finally {
      await lock.release()
    }
  }

  /** Subscribe to successful remote refreshes. Returns an unsubscribe fn. */
  onRefreshed(cb: () => void): () => void {
    this.refreshedCbs.add(cb)
    return () => this.refreshedCbs.delete(cb)
  }

  // ── Lookups ───────────────────────────────────────────────────────────────

  get(providerId: string, modelId: string): ModelCatalogEntry | undefined {
    const key = normalizeModelId(modelId)
    const all = this.entries.filter(
      (e) => e.providerId === providerId && normalizeModelId(e.modelId) === key,
    )
    return all.at(-1)
  }

  /** Alias-tolerant: exact id first, then unique suffix match (`gpt-4.1-2025-04` → `gpt-4.1`). */
  find(providerId: string, modelId: string): ModelCatalogEntry | undefined {
    const exact = this.get(providerId, modelId)
    if (exact) return exact
    const key = normalizeModelId(modelId)
    const suffix = this.entries.filter(
      (e) => e.providerId === providerId && normalizeModelId(e.modelId).endsWith(key),
    )
    return suffix.length === 1 ? suffix[0] : undefined
  }

  list(providerId?: string): ModelCatalogEntry[] {
    return providerId ? this.entries.filter((e) => e.providerId === providerId) : [...this.entries]
  }

  /**
   * Cost lookup. Returns `null` when the model (or its price) is unknown —
   * callers must treat that as "cost unknown", never 0.
   */
  costOf(providerId: string, modelId: string): ModelCost | null {
    return this.find(providerId, modelId)?.cost ?? null
  }

  get info(): CatalogInfo {
    return {
      source: this.source,
      count: this.entries.length,
      ...(this.fetchedAt !== undefined ? { fetchedAt: this.fetchedAt } : {}),
    }
  }

  dispose(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }
}

/**
 * Normalize a model id for comparison: lowercase, drop date-stamp suffixes
 * (`-20250929`), collapse `.`/`_` variants.
 */
export function normalizeModelId(modelId: string): string {
  return modelId
    .toLowerCase()
    .replace(/[-_]?\d{8}\b/g, "") // date-stamped snapshots
    .replace(/[._]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export { inferTierFromPrice } from "./model-catalog-snapshot.js"
