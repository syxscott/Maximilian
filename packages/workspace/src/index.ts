/**
 * Workspace store backed by unstorage.
 *
 * Supports multiple storage backends (filesystem, S3, Redis, etc.) via
 * unstorage drivers. Defaults to filesystem when no STORAGE_DRIVER env var
 * is set.
 *
 * Key layout:
 *   ws/{id}             → JSON-serialized Workspace
 *   tenant/{id}         → tenant ID string
 *   artifact/{id}/{fn}  → artifact file content
 */

import { createStorage, type Storage } from "unstorage"
import fsDriver from "unstorage/drivers/fs"
import type { Workspace } from "@max/core"
import { writeFileAtomic } from "./atomic.js"

export interface WorkspaceStoreOptions {
  /** Root directory for filesystem driver. Ignored when driver is not fs. */
  rootDir: string
  /**
   * Storage driver name. Defaults to "fs".
   * Supported: "fs", "s3", "redis", "memory" (see unstorage docs).
   */
  driver?: string
  /** Additional driver-specific options passed to unstorage. */
  driverOptions?: Record<string, unknown>
}

function createDriver(opts: WorkspaceStoreOptions) {
  const name = opts.driver ?? "fs"
  switch (name) {
    case "fs":
      return fsDriver({ base: opts.rootDir, ...opts.driverOptions })
    case "memory":
      // unstorage built-in, imported dynamically to avoid hard dep
      return undefined // createStorage() without driver uses in-memory
    default:
      // For s3, redis, etc. — caller must provide driverOptions or use
      // STORAGE_DRIVER_URL env var that unstorage auto-discovers.
      throw new Error(
        `[WorkspaceStore] Driver "${name}" requires explicit driver import. ` +
          `Pass a pre-configured driver instance via driverOptions.driver.`,
      )
  }
}

export class FileWorkspaceStore {
  private readonly storage: Storage
  /**
   * The filesystem root that unstorage's fs driver writes to. Cached at
   * construction so we can write the tenant key atomically (write-tmp +
   * rename) without going through unstorage, which has no atomic
   * `setItem` API. For non-fs drivers (memory, s3, etc.) this is
   * undefined and the atomic write falls back to a plain setItem.
   */
  private readonly rootDir?: string

  constructor(opts: WorkspaceStoreOptions | string) {
    const resolved: WorkspaceStoreOptions = typeof opts === "string" ? { rootDir: opts } : opts
    const driver = createDriver(resolved)
    this.storage = driver ? createStorage({ driver }) : createStorage()
    if (resolved.driver === undefined || resolved.driver === "fs") {
      this.rootDir = resolved.rootDir
    }
  }

  // ── Workspace CRUD ─────────────────────────────────────────────────────

  async saveWorkspace(workspace: Workspace, tenantId?: string): Promise<void> {
    const id = workspace.id
    // Write the tenant key FIRST, then the workspace. If the process
    // crashes between the two writes, the tenant key exists but the
    // workspace doesn't (or is stale) - loadWorkspace returns
    // undefined because `ws/{id}` is missing, so no data leaks. The
    // previous order (workspace first, then tenant) left the workspace
    // visible to dev-mode callers if the process crashed after the
    // workspace write but before the tenant write - a cross-tenant
    // data leak.
    if (this.rootDir !== undefined) {
      const tenantPath = `${this.rootDir}/tenant/${id}`
      await writeFileAtomic(tenantPath, tenantId ?? "")
    } else {
      await this.storage.setItem(`tenant/${id}`, tenantId ?? "")
    }
    await this.storage.setItem(`ws/${id}`, JSON.stringify(workspace))
  }

  async loadWorkspace(id: string, tenantId?: string): Promise<Workspace | undefined> {
    // unstorage's getItem calls destr() which auto-parses JSON strings,
    // so the result is already a Workspace object (not a string).
    const ws = await this.storage.getItem<Workspace>(`ws/${id}`)
    if (ws === null || ws === undefined) return undefined

    const stored = await this.storage.getItem<string>(`tenant/${id}`)
    // `stored` is null/undefined for legacy data predating the always-write
    // fix; treat that as "no tenant" for backward compat with dev tests.
    const storedTenant = stored?.trim() ?? ""

    if (tenantId !== undefined) {
      // Caller is authenticated (or has a tenant claim). Require exact match.
      if (storedTenant !== tenantId) return undefined
      return ws
    }

    // Caller has no tenant claim (dev mode). Refuse to return tenant-owned
    // data — otherwise any unauthenticated request could enumerate
    // `ws/{id}` and read workspaces it doesn't own.
    if (storedTenant !== "") return undefined
    return ws
  }

  async listWorkspaces(tenantId?: string): Promise<string[]> {
    // unstorage normalizes / → : in keys, so getKeys("ws/") returns ["ws:id1", ...]
    const keys = await this.storage.getKeys("ws/")
    const ids = keys.map((k) => k.replace(/^ws:/, "")).filter((id) => id.length > 0)

    // Parallel fetch all tenant keys — O(n) concurrent round-trips instead
    // of O(n) sequential round-trips. Same isolation rule as loadWorkspace:
    // a tenantId caller gets rows matching that tenant; a dev caller
    // (no tenantId) only sees rows whose tenant key is empty/missing.
    const tenants = await Promise.all(
      ids.map((id) => this.storage.getItem<string>(`tenant/${id}`)),
    )
    const filtered = ids
      .map((id, i) => ({ id, tenant: (tenants[i] ?? "").trim() }))
      .filter(({ tenant }) =>
        tenantId !== undefined ? tenant === tenantId : tenant === "",
      )
      .map(({ id }) => id)
    return filtered.sort().reverse()
  }

  // ── Artifact CRUD ──────────────────────────────────────────────────────

  async saveArtifact(workspaceId: string, filename: string, content: string): Promise<string> {
    const safeName = filename.replace(/[^\w.\-]/g, "_")
    await this.storage.setItem(`artifact/${workspaceId}/${safeName}`, content)
    return safeName
  }

  async readArtifact(workspaceId: string, filename: string): Promise<string | undefined> {
    const val = await this.storage.getItem<string>(`artifact/${workspaceId}/${filename}`)
    return val ?? undefined
  }

  async listArtifacts(workspaceId: string): Promise<string[]> {
    // unstorage normalizes / → : in keys
    const prefix = `artifact:${workspaceId}:`
    const keys = await this.storage.getKeys(prefix)
    return keys
      .map((k) => k.replace(prefix, ""))
      .filter((name) => name.length > 0)
      .sort()
  }
}
