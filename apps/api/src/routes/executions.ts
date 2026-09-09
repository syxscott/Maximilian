/**
 * Phase 5.1 — Execution History HTTP routes.
 *
 *   GET  /api/executions              List all execution records
 *   GET  /api/executions/:id          Fetch one execution record
 *   GET  /api/executions/workspace/:workspaceId  Filter by workspace
 *   GET  /api/executions/role/:role   Filter by agent role
 *   POST /api/executions/:id/feedback Append user feedback to a record
 *
 * All routes require auth (registered with requireAuthMiddleware) and
 * scope reads/writes to the tenantId attached by auth middleware.
 */

import { createRoute } from "@hono/zod-openapi"
import type { Context } from "hono"
import { z } from "zod"
import type { ExecutionStore } from "@max/autonomy"
import { ErrorSchema } from "../schemas.js"

interface Deps {
  store: ExecutionStore
}

const FeedbackSchema = z.object({
  text: z.string().min(1).max(2000),
  rating: z.number().min(1).max(5).optional(),
})

const IdParamsSchema = z.object({ id: z.string().min(1) })
const WorkspaceIdParamsSchema = z.object({ workspaceId: z.string().min(1) })
const RoleParamsSchema = z.object({ role: z.string().min(1) })

// ── OpenAPI route definitions ─────────────────────────────────────────────

export const listExecutionsRoute = createRoute({
  method: "get",
  path: "/executions",
  tags: ["executions"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(z.unknown()),
            nextCursor: z.string().optional(),
            total: z.number(),
          }),
        },
      },
      description: "Paginated executions",
    },
  },
})

export const getExecutionRoute = createRoute({
  method: "get",
  path: "/executions/{id}",
  tags: ["executions"],
  request: { params: IdParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Execution" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Missing id" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
  },
})

export const listExecutionsForWorkspaceRoute = createRoute({
  method: "get",
  path: "/executions/workspace/{workspaceId}",
  tags: ["executions"],
  request: { params: WorkspaceIdParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: z.unknown() } },
      description: "Executions for workspace",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Missing workspaceId",
    },
  },
})

export const listExecutionsForRoleRoute = createRoute({
  method: "get",
  path: "/executions/role/{role}",
  tags: ["executions"],
  request: { params: RoleParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: z.unknown() } },
      description: "Executions for role",
    },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Missing role" },
  },
})

export const appendExecutionFeedbackRoute = createRoute({
  method: "post",
  path: "/executions/{id}/feedback",
  tags: ["executions"],
  request: {
    params: IdParamsSchema,
    body: { content: { "application/json": { schema: FeedbackSchema } } },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ ok: z.boolean(), execution: z.unknown() }) },
      },
      description: "Feedback appended",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Invalid body or id",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Execution not found",
    },
  },
})

export function executionRoutes(deps: Deps) {
  const { store } = deps

  const getTenantId = (c: Context): string | undefined =>
    c.get("tenantId" as never) as string | undefined

  return {
    listAll: async (c: Context) => {
      const tenantId = getTenantId(c)
      const cursor = c.req.query("cursor")
      const limit = Math.min(Math.max(Number(c.req.query("limit")) || 20, 1), 100)

      // Use database-level keyset pagination instead of loading all records into memory
      const items = await store.listAll({ tenantId, cursor, take: limit + 1 })

      // If we got one more than the limit, there's a next page
      const hasMore = items.length > limit
      if (hasMore) {
        items.pop() // Remove the extra item
      }
      const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]?.id : undefined

      // `total` reflects the page size returned in this response. With cursor
      // pagination the global row count is intentionally not exposed (clients
      // should follow `nextCursor` to enumerate the full set), but the field
      // is kept in the wire shape so callers that only care about "is there
      // at least one row on this page" — e.g. the dashboard's polling loop —
      // don't have to reach for `items.length` themselves.
      return c.json({ items, nextCursor, total: items.length })
    },

    get: async (c: Context) => {
      const id = c.req.param("id")
      if (!id) return c.json({ error: "Missing id" }, 400)
      const tenantId = getTenantId(c)
      const exec = await store.get(id, tenantId)
      if (!exec) return c.json({ error: "Execution not found" }, 404)
      return c.json(exec)
    },

    listForWorkspace: async (c: Context) => {
      const workspaceId = c.req.param("workspaceId")
      if (!workspaceId) return c.json({ error: "Missing workspaceId" }, 400)
      const tenantId = getTenantId(c)
      const execs = await store.listForWorkspace(workspaceId, tenantId)
      return c.json({ workspaceId, count: execs.length, executions: execs })
    },

    listForRole: async (c: Context) => {
      const role = c.req.param("role")
      if (!role) return c.json({ error: "Missing role" }, 400)
      const tenantId = getTenantId(c)
      const execs = await store.listForRole(role, tenantId)
      return c.json({ role, count: execs.length, executions: execs })
    },

    appendFeedback: async (c: Context) => {
      const id = c.req.param("id")
      if (!id) return c.json({ error: "Missing id" }, 400)
      const tenantId = getTenantId(c)
      const body = c.req.valid("json" as never) as { text: string; rating?: number }
      try {
        const updated = await store.appendUserFeedback(id, body.text, body.rating, tenantId)
        return c.json({ ok: true, execution: updated })
      } catch (err) {
        const msg = (err as Error).message ?? "Unknown error"
        return c.json({ error: msg }, 400)
      }
    },
  }
}
