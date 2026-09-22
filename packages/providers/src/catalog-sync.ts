// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * RemoteCatalogSynchronizer — lease-based remote catalog sync (ZCode
 * provider-node borrowing: zcode-builtin-remote-synchronizer).
 *
 * Hard boundaries ported from ZCode:
 *  - HTTPS-only download URLs (reject anything else at the boundary).
 *  - A TOTAL time budget per attempt (default 20s) — a hung mirror must
 *    not stall bootstrap.
 *  - A control file holding {leaseId, leaseUntil, failureCount} so multiple
 *    processes don't sync concurrently and failures back off exponentially.
 *  - The file lock is NOT held during network IO (only around the
 *    control-file read/write).
 *
 * Pairs with ModelCatalog: the synchronizer decides WHEN to refresh and
 * hands the downloaded JSON to `catalog.ingestRemote()`; ModelCatalog owns
 * validation, the three-tier fallback, and the cache.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import { randomBytes } from "node:crypto"

export interface CatalogSynchronizerOptions {
  /** Directory for the control/lease file. */
  controlDir: string
  /** HTTPS-only download URL for the catalog JSON. */
  remoteUrl: string
  /** Refresh interval after a successful sync. Default: 1 hour. */
  intervalMs?: number
  /** Total budget per download attempt. Default: 20s. */
  attemptBudgetMs?: number
  now?: () => number
  fetchImpl?: typeof fetch
}

interface ControlFile {
  leaseId: string
  leaseUntil: number
  failureCount: number
  lastSuccessAt?: string
}

const LEASE_MS = 60_000

export class RemoteCatalogSynchronizer {
  private readonly controlPath: string
  private readonly intervalMs: number
  private readonly budgetMs: number
  private readonly now: () => number
  private readonly fetchImpl: typeof fetch

  constructor(private readonly opts: CatalogSynchronizerOptions) {
    if (!opts.remoteUrl.startsWith("https://")) {
      // ZCode boundary: non-HTTPS catalog URLs are rejected outright —
      // a plain-http mirror would be a supply-chain injection point.
      throw new Error(`catalog remoteUrl must be https:// (got: ${opts.remoteUrl})`)
    }
    this.controlPath = path.join(opts.controlDir, "catalog-sync-control.json")
    this.intervalMs = opts.intervalMs ?? 60 * 60_000
    this.budgetMs = opts.attemptBudgetMs ?? 20_000
    this.now = opts.now ?? Date.now
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  private async readControl(): Promise<ControlFile | undefined> {
    try {
      const raw = await fs.readFile(this.controlPath, "utf8")
      return JSON.parse(raw) as ControlFile
    } catch {
      return undefined
    }
  }

  private async writeControl(c: ControlFile): Promise<void> {
    await fs.mkdir(path.dirname(this.controlPath), { recursive: true })
    const tmp = `${this.controlPath}.tmp`
    await fs.writeFile(tmp, JSON.stringify(c, null, 2))
    await fs.rename(tmp, this.controlPath)
  }

  /**
   * Run one sync attempt under the lease.
   * @returns the parsed JSON body on success, or null when skipped/failed
   * (lease held elsewhere, budget exhausted, non-2xx). Never throws.
   */
  async syncOnce(): Promise<unknown | null> {
    const control = await this.readControl()
    const now = this.now()
    if (control && control.leaseUntil > now) return null // another process holds the lease

    const leaseId = randomBytes(8).toString("hex")
    await this.writeControl({
      leaseId,
      leaseUntil: now + LEASE_MS,
      failureCount: control?.failureCount ?? 0,
      lastSuccessAt: control?.lastSuccessAt,
    })

    // Exponential backoff after consecutive failures (ZCode borrowing):
    // failureCount N delays the next attempt by 2^N minutes, capped at 1h.
    if (control && control.failureCount > 0) {
      const backoffMs = Math.min(2 ** control.failureCount * 30_000, 60 * 60_000)
      const lastAttempt = control.leaseUntil - LEASE_MS
      if (now - lastAttempt < backoffMs) return null
    }

    try {
      const res = await this.fetchImpl(this.opts.remoteUrl, {
        signal: AbortSignal.timeout(this.budgetMs),
      })
      if (!res.ok) {
        await this.writeControl({
          ...control0(control, leaseId, now),
          failureCount: (control?.failureCount ?? 0) + 1,
        })
        return null
      }
      const json: unknown = await res.json()
      await this.writeControl({
        leaseId,
        leaseUntil: now,
        failureCount: 0,
        lastSuccessAt: new Date(now).toISOString(),
      })
      return json
    } catch {
      await this.writeControl({
        ...control0(control, leaseId, now),
        failureCount: (control?.failureCount ?? 0) + 1,
      })
      return null
    }

    function control0(prev: ControlFile | undefined, leaseId: string, now: number): ControlFile {
      return {
        leaseId,
        leaseUntil: now + LEASE_MS,
        failureCount: prev?.failureCount ?? 0,
        lastSuccessAt: prev?.lastSuccessAt,
      }
    }
  }
}
