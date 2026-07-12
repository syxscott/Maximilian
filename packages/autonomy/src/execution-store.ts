/**
 * 5.1 — ExecutionStore
 *
 * Persists ExecutionRecord to <rootDir>/executions/<id>.json.
 * Each record contains the full replay context for one task execution.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import { ExecutionRecordSchema, type ExecutionRecord } from "./types.js"

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

  async listAll(tenantId?: string): Promise<ExecutionRecord[]> {
    const all = await this.readAll()
    return tenantId ? all.filter((r) => !r.tenantId || r.tenantId === tenantId) : all
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
    const existing = await this.get(executionId, tenantId)
    if (!existing) throw new Error(`Execution ${executionId} not found`)
    const updated: ExecutionRecord = {
      ...existing,
      userFeedback: [...existing.userFeedback, { at: new Date().toISOString(), text, rating }],
    }
    await this.save(updated)
    return updated
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
