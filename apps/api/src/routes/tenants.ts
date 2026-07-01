/**
 * Tenant management API routes.
 *
 *   POST   /api/tenants       — create a tenant
 *   GET    /api/tenants       — list tenants
 *   GET    /api/tenants/:id   — get a tenant
 *   PUT    /api/tenants/:id   — update a tenant
 *   DELETE /api/tenants/:id   — delete a tenant
 *
 * All endpoints require admin role. Each route is paired with a
 * `createRoute` definition so the full set shows up in the OpenAPI doc.
 */

import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { tenants } from "@max/database";
import { randomUUID } from "node:crypto";
import { getLogger } from "@max/telemetry";
import {
  ErrorSchema,
  IdParamsSchema,
  TenantSchema,
  CreateTenantSchema,
  UpdateTenantSchema,
  TenantListResponseSchema,
} from "../schemas.js";

const log = getLogger("tenants");

interface TenantRouteDeps {
  db: PostgresJsDatabase;
}

// ── OpenAPI route definitions ─────────────────────────────────────────────

const OkResponseSchema = z.object({ ok: z.boolean() });

export const tenantCreateRoute = createRoute({
  method: "post",
  path: "/tenants",
  tags: ["tenants"],
  request: { body: { content: { "application/json": { schema: CreateTenantSchema } } } },
  responses: {
    201: { content: { "application/json": { schema: TenantSchema } }, description: "Tenant created" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid body" },
    409: { content: { "application/json": { schema: ErrorSchema } }, description: "Slug already exists" },
  },
});

export const tenantListRoute = createRoute({
  method: "get",
  path: "/tenants",
  tags: ["tenants"],
  responses: {
    200: { content: { "application/json": { schema: TenantListResponseSchema } }, description: "List of tenants" },
  },
});

export const tenantGetRoute = createRoute({
  method: "get",
  path: "/tenants/{id}",
  tags: ["tenants"],
  request: { params: IdParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: TenantSchema } }, description: "Tenant" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Tenant not found" },
  },
});

export const tenantUpdateRoute = createRoute({
  method: "put",
  path: "/tenants/{id}",
  tags: ["tenants"],
  request: {
    params: IdParamsSchema,
    body: { content: { "application/json": { schema: UpdateTenantSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: OkResponseSchema } }, description: "Updated" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid body" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Tenant not found" },
  },
});

export const tenantDeleteRoute = createRoute({
  method: "delete",
  path: "/tenants/{id}",
  tags: ["tenants"],
  request: { params: IdParamsSchema },
  responses: {
    200: { content: { "application/json": { schema: OkResponseSchema } }, description: "Deleted" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Tenant not found" },
  },
});

export function tenantRoutes(deps: TenantRouteDeps) {
  const { db } = deps;

  return {
    create: async (c: Context) => {
      const body = c.req.valid("json" as never) as { name: string; slug: string; plan: "free" | "pro" | "enterprise" };
      const { name, slug, plan } = body;

      // Check slug uniqueness
      const existing = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
      if (existing.length > 0) {
        return c.json({ error: "Slug already exists" }, 409);
      }

      const id = `ten-${randomUUID()}`;
      const now = new Date();

      await db.insert(tenants).values({ id, name, slug, plan, createdAt: now, updatedAt: now });

      log.info({ tenantId: id, name, slug }, "tenant created");

      return c.json({ id, name, slug, plan }, 201);
    },

    list: async (c: Context) => {
      const rows = await db.select().from(tenants);
      return c.json({
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          plan: r.plan,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      });
    },

    get: async (c: Context) => {
      const id = c.req.param("id")!;
      const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
      if (rows.length === 0) {
        return c.json({ error: "Tenant not found" }, 404);
      }
      const r = rows[0];
      return c.json({
        id: r.id,
        name: r.name,
        slug: r.slug,
        plan: r.plan,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      });
    },

    update: async (c: Context) => {
      const id = c.req.param("id")!;
      const body = c.req.valid("json" as never) as { name?: string; plan?: "free" | "pro" | "enterprise" };

      const existing = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
      if (existing.length === 0) {
        return c.json({ error: "Tenant not found" }, 404);
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (body.name !== undefined) updates.name = body.name;
      if (body.plan !== undefined) updates.plan = body.plan;

      await db.update(tenants).set(updates).where(eq(tenants.id, id));

      log.info({ tenantId: id, updates: body }, "tenant updated");

      return c.json({ ok: true });
    },

    remove: async (c: Context) => {
      const id = c.req.param("id")!;

      const existing = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, id)).limit(1);
      if (existing.length === 0) {
        return c.json({ error: "Tenant not found" }, 404);
      }

      // CASCADE will delete all tenant data
      await db.delete(tenants).where(eq(tenants.id, id));

      log.info({ tenantId: id }, "tenant deleted");

      return c.json({ ok: true });
    },
  };
}
