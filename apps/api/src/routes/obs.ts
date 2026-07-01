/**
 * Phase 10 — Observability HTTP routes.
 *
 *   GET  /api/obs/executions                List historical execution traces
 *   GET  /api/obs/evolutions                Timeline of self-evolution events
 *   GET  /api/obs/lineage/agent/:role       Evolutionary history of a specific agent role
 */

import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";
import { getLogger } from "@max/telemetry";
import type { TelemetryCollector } from "@max/telemetry";
import { PaginationQuerySchema, paginate, type PaginationQuery } from "../lib/pagination.js";
import { ErrorSchema } from "../schemas.js";

const log = getLogger("obs");

interface ObsRouteDeps {
  telemetry: TelemetryCollector;
}

const RoleParamsSchema = z.object({ role: z.string().min(1) });

// ── OpenAPI route definitions ─────────────────────────────────────────────

export const listObsExecutionsRoute = createRoute({
  method: "get",
  path: "/obs/executions",
  tags: ["observability"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Paginated execution traces" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "Internal error" },
  },
});

export const listObsEvolutionsRoute = createRoute({
  method: "get",
  path: "/obs/evolutions",
  tags: ["observability"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Paginated evolution traces" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "Internal error" },
  },
});

export const lineageByRoleRoute = createRoute({
  method: "get",
  path: "/obs/lineage/agent/{role}",
  tags: ["observability"],
  request: { params: RoleParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Per-role lineage" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Missing role" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "Internal error" },
  },
});

const ExecutionIdParamsSchema = z.object({ executionId: z.string().min(1) });

export const obsGraphRoute = createRoute({
  method: "get",
  path: "/obs/graph/{executionId}",
  tags: ["observability"],
  request: { params: ExecutionIdParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "UI-ready execution graph" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Not found" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "Internal error" },
  },
});

export const obsTimelineRoute = createRoute({
  method: "get",
  path: "/obs/timeline",
  tags: ["observability"],
  responses: {
    200: { content: { "application/json": { schema: z.unknown() } }, description: "Evolution timeline" },
    500: { content: { "application/json": { schema: ErrorSchema } }, description: "Internal error" },
  },
});

function parsePagination(c: Context): PaginationQuery {
  const raw = c.req.query();
  const parsed = PaginationQuerySchema.safeParse({
    cursor: raw.cursor,
    limit: raw.limit,
  });
  if (!parsed.success) return { cursor: undefined, limit: 20 };
  return parsed.data;
}

export function obsRoutes(deps: ObsRouteDeps) {
  const { telemetry } = deps;

  return {
    listExecutions: async (c: Context) => {
      try {
        const traces = telemetry.listExecutions();
        const page = paginate(traces, parsePagination(c), (t) => t.id);
        return c.json({
          count: page.items.length,
          executions: page.items,
          nextCursor: page.nextCursor,
          total: page.total,
        });
      } catch (err) {
        log.error({ err }, "listExecutions failed");
        return c.json({ error: "internal_error" }, 500);
      }
    },

    listEvolutions: async (c: Context) => {
      try {
        const traces = telemetry.listEvolutions();
        const page = paginate(traces, parsePagination(c), (t) => t.id);
        return c.json({
          count: page.items.length,
          evolutions: page.items,
          nextCursor: page.nextCursor,
          total: page.total,
        });
      } catch (err) {
        log.error({ err }, "listEvolutions failed");
        return c.json({ error: "internal_error" }, 500);
      }
    },

    lineageByRole: async (c: Context) => {
      const role = c.req.param("role");
      if (!role) return c.json({ error: "missing role param" }, 400);
      try {
        const traces = telemetry.lineageByRole(role);
        return c.json({ role, count: traces.length, lineage: traces });
      } catch (err) {
        log.error({ err }, "lineageByRole failed");
        return c.json({ error: "internal_error" }, 500);
      }
    },
  };
}
