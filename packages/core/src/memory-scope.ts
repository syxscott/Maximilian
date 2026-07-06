/**
 * MemoryScope — hierarchical path-based memory isolation (借鉴 crewAI).
 *
 * crewAI's MemoryScope wraps an underlying Memory with root_path scoping:
 * `remember/recall/forget` calls are auto-prefixed with the scope's path,
 * and `subscope(path)` creates narrower child scopes. This lets multiple
 * teams/roles/projects share one Memory backend without leaking records
 * across boundaries.
 *
 * Maximilian adapts this with a tiny standalone scope wrapper that does
 * NOT introduce a new persistence backend — it just adds path-based
 * isolation to any record-returning storage interface. The Agent class
 * can compose it into its existing `memory` array; the workspace layer
 * can compose it into its metadata bag.
 */

export interface ScopedRecord {
  /** The scope path this record belongs to (e.g. "/backend/api-design"). */
  scope: string
  /** Record content (free-form). */
  content: string
  /** Optional timestamp / score metadata. */
  metadata?: Record<string, unknown>
}

export interface MemoryBackend {
  /** Return records within `scope` (and any descendant scopes if recursive). */
  list(scope: string, opts?: { recursive?: boolean }): Promise<ScopedRecord[]>
  /** Add a record to `scope`. */
  add(scope: string, content: string, metadata?: Record<string, unknown>): Promise<void>
  /** Remove all records under `scope`. */
  clear(scope: string): Promise<void>
}

/**
 * Hierarchical scope over a Memory backend (借鉴 crewAI MemoryScope).
 * All operations are auto-prefixed with this scope's root path so a
 * child scope never sees records outside its subtree.
 */
export class MemoryScope {
  constructor(
    private readonly backend: MemoryBackend,
    /** Root path of this scope, e.g. "/backend". Use "/" for global. */
    public readonly rootPath: string = "/",
  ) {}

  /** Build the absolute path for a relative `subpath`. */
  scopedPath(subpath: string): string {
    if (subpath.startsWith("/")) return subpath
    const root = this.rootPath.endsWith("/") ? this.rootPath.slice(0, -1) : this.rootPath
    return `${root}/${subpath}`
  }

  /** Remember `content` at this scope (or a sub-path). */
  async remember(content: string, subpath?: string, metadata?: Record<string, unknown>): Promise<void> {
    const scope = subpath ? this.scopedPath(subpath) : this.rootPath
    return this.backend.add(scope, content, metadata)
  }

  /** Recall all records under this scope (recursive by default). */
  async recall(opts?: { recursive?: boolean }): Promise<ScopedRecord[]> {
    return this.backend.list(this.rootPath, { recursive: opts?.recursive ?? true })
  }

  /** Forget all records under this scope. */
  async forget(): Promise<void> {
    return this.backend.clear(this.rootPath)
  }

  /** Create a child scope at `subpath`. Returns a new MemoryScope. */
  subscope(subpath: string): MemoryScope {
    return new MemoryScope(this.backend, this.scopedPath(subpath))
  }

  /** List all direct child subscope paths (one level deep). */
  async listSubscopes(): Promise<string[]> {
    const all = await this.backend.list(this.rootPath, { recursive: true })
    const root = this.rootPath.endsWith("/") ? this.rootPath.slice(0, -1) : this.rootPath
    const prefix = root === "" ? "/" : root + "/"
    const directChildren = new Set<string>()
    for (const r of all) {
      if (r.scope.startsWith(prefix) || root === "" && r.scope.startsWith("/")) {
        const remainder = root === "" ? r.scope.slice(1) : r.scope.slice(prefix.length)
        const slash = remainder.indexOf("/")
        const child = slash >= 0 ? remainder.slice(0, slash) : remainder
        if (child) directChildren.add(child)
      }
    }
    return [...directChildren]
  }
}

/**
 * In-memory backend, suitable for tests and ephemeral workspaces.
 * Backed by a Map<scope, ScopedRecord[]>.
 */
export class InMemoryBackend implements MemoryBackend {
  private records: ScopedRecord[] = []

  async list(scope: string, opts?: { recursive?: boolean }): Promise<ScopedRecord[]> {
    const prefix = scope.endsWith("/") ? scope : scope + "/"
    if (opts?.recursive === false) {
      return this.records.filter((r) => r.scope === scope || r.scope === scope.replace(/\/$/, ""))
    }
    return this.records.filter((r) => r.scope === scope || r.scope.startsWith(prefix))
  }

  async add(scope: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    this.records.push({ scope, content, metadata })
  }

  async clear(scope: string): Promise<void> {
    const prefix = scope.endsWith("/") ? scope : scope + "/"
    this.records = this.records.filter((r) => !(r.scope === scope || r.scope.startsWith(prefix)))
  }
}