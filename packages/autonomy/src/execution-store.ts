/**
 * 5.1 — ExecutionStore
 *
 * Persists ExecutionRecord to <rootDir>/executions/<id>.json.
 * Each record contains the full replay context for one task execution.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import { ExecutionRecordSchema, type ExecutionRecord } from "./types.js"

// In-memory locks for appendUserFeedback to prevent race conditions
interface LockEntry {
  promise: Promise<void>
  resolve: () => void
}
const feedbackLocks = new Map<string, LockEntry>();

export class ExecutionStore {
  constructor(private rootDir: string) {}

  private dir(): string {
    return path.join(this.rootDir, "executions")
  }

  private fileFor(id: string): string {
    return path.join(this.dir(), `${id}.json`)
  }

  async save(record: ExecutionRecord): Promise<void> {
    const validated = ExecutionRecordSchema.parse(record)
    await fs.mkdir(this.dir(), { recursive: true })
    await fs.writeFile(this.fileFor(validated.id), JSON.stringify(validated, null, 2), "utf-8")
  }

  async get(id: string, tenantId?: string): Promise<ExecutionRecord | undefined> {
    const existing = await this.getRaw(id)
    if (!existing) return undefined
    if (tenantId && existing.tenantId && existing.tenantId !== tenantId) return undefined
    return existing
  }

  async listAll(tenantIdOrOptions?: string | { tenantId?: string; cursor?: string; take?: number; skip?: number }): Promise<ExecutionRecord[]> {
    const opts = typeof tenantIdOrOptions === 'string' ? { tenantId: tenantIdOrOptions } : tenantIdOrOptions
    const { tenantId, take, skip } = opts ?? {}
    let all = await this.readAll()
    // Filter by tenantId
    if (tenantId !== undefined) {
      all = all.filter((r) => r.tenantId === tenantId)
    }
    // Apply skip offset
    if (skip !== undefined) {
      all = all.slice(skip)
    }
    // Apply take limit
    if (take !== undefined) {
      all = all.slice(0, take)
    }
    return all
  }

  async listForWorkspace(workspaceId: string, tenantId?: string): Promise<ExecutionRecord[]> {
    const all = await this.listAll(tenantId)
    return all.filter((r) => r.workspaceId === workspaceId)
  }

  async listForRole(role: string, tenantId?: string): Promise<ExecutionRecord[]> {
    const all = await this.listAll(tenantId)
    return all.filter((r) => r.agentRole === role)
  }

  async listForBlueprint(blueprintId: string, tenantId?: string): Promise<ExecutionRecord[]> {
    const all = await this.listAll(tenantId)
    return all.filter((r) => r.blueprintId === blueprintId)
  }

  async appendUserFeedback(
    executionId: string,
    text: string,
    rating?: number,
    tenantId?: string,
  ): Promise<ExecutionRecord> {
    // Wait for any concurrent append to this execution to complete first.
    // Note: This is an in-memory lock and only works within a single process.
    // For multi-process deployments, use a distributed lock (Redis, database, etc.)
    // Use a lock entry object to properly manage lock ownership transfer.
    interface LockEntry {
      promise: Promise<void>
      resolve: () => void
    }
    while (feedbackLocks.has(executionId)) {
      const entry = feedbackLocks.get(executionId) as LockEntry | undefined
      if (entry) {
        await entry.promise
      }
    }
    let resolveLock: () => void
    const promise = new Promise<void>((resolve) => {
      resolveLock = resolve
    })
    const entry: LockEntry = { promise, resolve: resolveLock! }
    feedbackLocks.set(executionId, entry)

    try {
      const existing = await this.get(executionId, tenantId)
      if (!existing) throw new Error(`Execution ${executionId} not found`)
      const updated: ExecutionRecord = {
        ...existing,
        userFeedback: [...existing.userFeedback, { at: new Date().toISOString(), text, rating }],
      }
      await this.save(updated)
      return updated
    } finally {
      // Delete lock first, then resolve to ensure proper ownership transfer
      feedbackLocks.delete(executionId)
      entry.resolve()
    }
  }

  private async getRaw(id: string): Promise<ExecutionRecord | undefined> {
    try {
      const raw = await fs.readFile(this.fileFor(id), "utf-8")
      return ExecutionRecordSchema.parse(JSON.parse(raw))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw err
    }
  }

  private async readAll(): Promise<ExecutionRecord[]> {
    try {
      const entries = await fs.readdir(this.dir())
      const out: ExecutionRecord[] = []
      for (const name of entries) {
        if (!name.endsWith(".json")) continue
        const raw = await fs.readFile(path.join(this.dir(), name), "utf-8")
        out.push(ExecutionRecordSchema.parse(JSON.parse(raw)))
      }
      return out
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
      throw err
    }
  }
}
