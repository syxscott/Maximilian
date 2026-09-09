/**
 * Permission audit log — append-only in-memory ring buffer of every
 * `ask → allow/deny` decision the runtime gates. Exposed via the API so
 * the dashboard (or an external SIEM) can review what got prompted,
 * what got approved, and what got blocked.
 *
 * Kept separate from `OrganizationMemory` because:
 *   - Permission prompts are high-frequency (one per gated tool call);
 *     a dedicated bounded buffer avoids bloating the meta-system event log.
 *   - Auditors want a flat, typed shape; `OrganizationEvent`'s free-form
 *     `payload` makes it harder to query.
 *
 * Persistence is opt-in: when `persistPath` is set, every `record()` call
 * rewrites the whole file. That's fine at the scale we expect (one entry
 * per human decision, not per tool call). If we ever push for true
 * append-only durability we'll swap the body for a line-delimited JSONL.
 */

export type PermissionAuditDecision = "ask" | "allow" | "deny"

export interface PermissionAuditEntry {
  /** ISO timestamp. */
  at: string
  /** Stable id from `PermissionRequestError.requestId`. Empty for deny/ask
   *  rows that never went through the UI (e.g. auto-deny on config reload). */
  requestId: string
  workspaceId: string
  taskId: string
  tool: string
  target: string
  /** What the user (or auto-policy) decided. */
  decision: PermissionAuditDecision
  /**
   * If a matching `ask` entry exists, this is its timestamp. Lets auditors
   * pair a "decision" row with the original "asked" row.
   */
  promptedAt?: string
}

export interface PermissionAuditQuery {
  /** Only return entries with `at >= since`. ISO timestamp. */
  since?: string
  /** Hard cap on returned entries. Defaults to 100, max 1000. */
  limit?: number
  /** Filter to a specific tool (e.g. `bash`). */
  tool?: string
  /** Filter to a specific workspace. */
  workspaceId?: string
}

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000
const DEFAULT_CAPACITY = 1000

export class PermissionAuditLog {
  private entries: PermissionAuditEntry[] = []

  constructor(
    private readonly capacity: number = DEFAULT_CAPACITY,
    private readonly persistPath?: string,
  ) {}

  /**
   * Record a single audit row. Eviction is FIFO when `capacity` is
   * exceeded — old entries are dropped without any index bookkeeping
   * (the previous `requestLookup` map had a bug where evicting the `ask`
   * row also dropped the lookup for the still-retained `allow` row).
   */
  record(entry: PermissionAuditEntry): PermissionAuditEntry {
    this.entries.push(entry)
    if (this.entries.length > this.capacity) {
      this.entries.shift()
    }
    if (this.persistPath) {
      this.schedulePersist()
    }
    return entry
  }

  /**
   * Return every retained entry that shares `requestId`. A request that
   * was prompted and then answered produces two rows (one `ask`, one
   * `allow`/`deny`) with matching ids; this returns both, in
   * chronological order. Empty array if nothing is retained.
   *
   * Walks the whole buffer (O(n)) rather than maintaining a lookup map;
   * capacity is bounded (default 1000) so this is cheap, and avoiding
   * the map removes an entire class of eviction-sync bugs.
   */
  getByRequestId(requestId: string): PermissionAuditEntry[] {
    if (!requestId) return []
    return this.entries.filter((e) => e.requestId === requestId)
  }

  /**
   * Returns the most recent `limit` entries, optionally filtered.
   * Result is in chronological order (oldest first).
   *
   * Note: `limit` caps the page size; `size()` returns the total
   * retained count (pre-filter) so callers paginating can tell when
   * they've reached the end. To get the *filtered* total, use
   * `countMatching()`.
   */
  query(opts: PermissionAuditQuery = {}): PermissionAuditEntry[] {
    const since = opts.since
    const tool = opts.tool
    const workspaceId = opts.workspaceId
    const limit = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? DEFAULT_LIMIT))

    const filtered: PermissionAuditEntry[] = []
    // Walk newest → oldest so we can stop early once we hit `limit` AND
    // crossed the `since` threshold.
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!
      if (since && e.at < since) break
      if (tool && e.tool !== tool) continue
      if (workspaceId && e.workspaceId !== workspaceId) continue
      filtered.push(e)
      if (filtered.length >= limit) break
    }
    // Returned in chronological order (oldest first) for stable display.
    return filtered.reverse()
  }

  /**
   * Count of entries matching the same filter set as `query()` — used by
   * the API's `/audit` endpoint so the `total` field reflects the full
   * result set rather than the page size.
   */
  countMatching(opts: Omit<PermissionAuditQuery, "limit"> = {}): number {
    const since = opts.since
    const tool = opts.tool
    const workspaceId = opts.workspaceId
    let n = 0
    for (const e of this.entries) {
      if (since && e.at < since) continue
      if (tool && e.tool !== tool) continue
      if (workspaceId && e.workspaceId !== workspaceId) continue
      n++
    }
    return n
  }

  /** Total entries currently held (pre-filter). */
  size(): number {
    return this.entries.length
  }

  /** Drop all entries — exposed for tests. */
  clear(): void {
    this.entries = []
  }

  /**
   * Coalesce + serialize persist calls. Without this, concurrent record()
   * calls fire overlapping persist() calls that write to the SAME tmp file
   * (`.tmp.<pid>`) - one writeFile clobbers the other mid-flight, and the
   * two rename() calls race, which can leave the on-disk file empty or
   * missing. The coalescing pattern ensures:
   *   1. At most one persist runs at a time (no concurrent writes).
   *   2. If record() fires while a persist is running, one follow-up
   *      persist is scheduled (not N - the extra calls are coalesced
   *      into a single dirty flag).
   *   3. A persist crash doesn't kill the chain - the next record()
   *      starts a fresh persist.
   */
  private persistInFlight: Promise<void> | null = null
  private persistDirty = false

  private schedulePersist(): void {
    if (this.persistInFlight) {
      this.persistDirty = true
      return
    }
    this.persistInFlight = this.doPersist()
      .catch((err) => {
        // Persistence is best-effort; warn but don't fail the request flow.
        // console.error (not the project logger) because this can fire at
        // high frequency during a sustained I/O failure and we don't want
        // to spam the structured log — a raw console warning is intentional.
        console.error("[permission-audit] persist failed", err)
      })
      .finally(() => {
        this.persistInFlight = null
        if (this.persistDirty) {
          this.persistDirty = false
          this.schedulePersist()
        }
      })
  }

  private async doPersist(): Promise<void> {
    if (!this.persistPath) return
    const { writeFile, rename, mkdir } = await import("node:fs/promises")
    const { dirname } = await import("node:path")
    await mkdir(dirname(this.persistPath), { recursive: true })
    // Unique tmp name per call as a safety net - even though schedulePersist
    // serializes writes, a unique name prevents clobbering if a future
    // caller bypasses the scheduler.
    const tmp = `${this.persistPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
    await writeFile(tmp, JSON.stringify(this.entries, null, 2), "utf-8")
    await rename(tmp, this.persistPath)
  }
}
