import { and, eq, isNull, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { workspaces, workspaceArtifacts } from "../schema.js"

/**
 * PostgreSQL-backed workspace store.
 * API-compatible with FileWorkspaceStore from @max/workspace.
 *
 * Multi-tenant: when tenantId is passed to a method, queries are scoped
 * to that tenant. When omitted, no tenant filtering is applied (backward
 * compatible with single-tenant deployments).
 */
export class PgWorkspaceStore {
  constructor(private db: PostgresJsDatabase) {}

  async ensureWorkspace(id: string): Promise<void> {
    const existing = await this.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, id))
      .limit(1)
    if (existing.length === 0) {
      throw new Error(`workspace ${id} not found`)
    }
  }

  async saveWorkspace(
    workspace: {
      id: string
      userRequest: string
      status: string
      plan?: unknown
      results?: unknown[]
      review?: unknown
      createdAt: string
      updatedAt: string
      error?: string
    },
    tenantId?: string,
  ): Promise<void> {
    await this.db
      .insert(workspaces)
      .values({
        id: workspace.id,
        tenantId: tenantId ?? null,
        userRequest: workspace.userRequest,
        status: workspace.status,
        plan: workspace.plan ?? null,
        results: workspace.results ?? [],
        review: workspace.review ?? null,
        error: workspace.error ?? null,
        createdAt: new Date(workspace.createdAt),
        updatedAt: new Date(workspace.updatedAt),
      })
      .onConflictDoUpdate({
        target: workspaces.id,
        set: {
          // COALESCE keeps the existing tenant_id if it's already set,
          // and only claims the workspace for `tenantId` when it was
          // previously NULL (unowned). Without this, an upsert would
          // either (a) leave tenant_id stuck at NULL forever when a
          // tenant caller tries to claim a legacy workspace, or
          // (b) silently transfer ownership between tenants - a
          // cross-tenant hijack via the upsert path.
          tenantId: sql`COALESCE(${workspaces.tenantId}, ${tenantId ?? null})`,
          userRequest: workspace.userRequest,
          status: workspace.status,
          plan: workspace.plan ?? null,
          results: workspace.results ?? [],
          review: workspace.review ?? null,
          error: workspace.error ?? null,
          updatedAt: new Date(workspace.updatedAt),
        },
      })
  }

  async loadWorkspace(
    id: string,
    tenantId?: string,
  ): Promise<
    | {
        id: string
        userRequest: string
        status: string
        plan?: unknown
        results: unknown[]
        review?: unknown
        createdAt: string
        updatedAt: string
        error?: string
      }
    | undefined
  > {
    // Tenant isolation:
    //   - When the caller provides a tenantId, require the row's tenant_id
    //     to match exactly. A NULL row tenant + tenantId caller is a
    //     mismatch (don't leak dev data to authenticated callers).
    //   - When the caller provides no tenantId (dev mode), only return
    //     rows where tenant_id IS NULL — refuse to surface tenant-owned
    //     data to unauthenticated requests.
    // The previous implementation used a bare `eq(workspaces.id, id)`
    // when tenantId was undefined, which leaked any workspace to any
    // caller that knew its id.
    const where =
      tenantId !== undefined
        ? and(eq(workspaces.id, id), eq(workspaces.tenantId, tenantId))
        : and(eq(workspaces.id, id), isNull(workspaces.tenantId))
    const rows = await this.db.select().from(workspaces).where(where).limit(1)
    if (rows.length === 0) return undefined
    const row = rows[0]
    return {
      id: row.id,
      userRequest: row.userRequest,
      status: row.status as "planning" | "executing" | "reviewing" | "completed" | "failed",
      plan: row.plan ?? undefined,
      results: (row.results as unknown[]) ?? [],
      review: row.review ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      error: row.error ?? undefined,
    }
  }

  async listWorkspaces(tenantId?: string): Promise<string[]> {
    // Same isolation rule as loadWorkspace: a tenantId caller gets rows
    // matching that tenant; a dev caller (no tenantId) only sees NULL
    // tenant rows. Previously, `where = undefined` returned every
    // workspace in the database to any dev caller.
    const where =
      tenantId !== undefined ? eq(workspaces.tenantId, tenantId) : isNull(workspaces.tenantId)
    const rows = await this.db.select({ id: workspaces.id }).from(workspaces).where(where)
    return rows.map((r) => r.id)
  }

  async saveArtifact(workspaceId: string, filename: string, content: string): Promise<string> {
    await this.db
      .insert(workspaceArtifacts)
      .values({ workspaceId, filename, content })
      .onConflictDoUpdate({
        target: [workspaceArtifacts.workspaceId, workspaceArtifacts.filename],
        set: { content },
      })
    return filename
  }

  async readArtifact(workspaceId: string, filename: string): Promise<string | undefined> {
    const rows = await this.db
      .select({ content: workspaceArtifacts.content })
      .from(workspaceArtifacts)
      .where(
        and(
          eq(workspaceArtifacts.workspaceId, workspaceId),
          eq(workspaceArtifacts.filename, filename),
        ),
      )
      .limit(1)
    return rows[0]?.content
  }

  async listArtifacts(workspaceId: string): Promise<string[]> {
    const rows = await this.db
      .select({ filename: workspaceArtifacts.filename })
      .from(workspaceArtifacts)
      .where(eq(workspaceArtifacts.workspaceId, workspaceId))
    return rows.map((r) => r.filename)
  }
}
