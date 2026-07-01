/**
 * Tests for Tenant CRUD API routes.
 *
 * Routes are registered via `app.openapi()` so `c.req.valid("json")` works
 * the same way it does in production. Mocks for drizzle + @max/database
 * keep the test off a real Postgres.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import {
  tenantRoutes,
  tenantCreateRoute,
  tenantListRoute,
  tenantGetRoute,
  tenantUpdateRoute,
  tenantDeleteRoute,
} from "../src/routes/tenants";

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockValues = vi.fn();
const mockSet = vi.fn();

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ a, b })),
}));

vi.mock("@max/database", () => ({
  tenants: {
    id: "id",
    name: "name",
    slug: "slug",
    plan: "plan",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
}));

function createMockDb() {
  const db = {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
  };

  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockLimit.mockResolvedValue([]);
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockResolvedValue(undefined);
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

  return db;
}

function buildApp(db: unknown) {
  const app = new OpenAPIHono();
  const r = tenantRoutes({ db });
  app.openapi(tenantCreateRoute, r.create);
  app.openapi(tenantListRoute, r.list);
  app.openapi(tenantGetRoute, r.get);
  app.openapi(tenantUpdateRoute, r.update);
  app.openapi(tenantDeleteRoute, r.remove);
  return app;
}

describe("Tenant CRUD routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("create tenant returns 201 with valid input", async () => {
    const db = createMockDb();
    mockLimit.mockResolvedValueOnce([]); // slug check: no existing

    const app = buildApp(db);
    const res = await app.request("/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme Corp", slug: "acme-corp", plan: "pro" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Acme Corp");
    expect(body.slug).toBe("acme-corp");
    expect(body.plan).toBe("pro");
    expect(mockInsert).toHaveBeenCalled();
  });

  it("create tenant rejects duplicate slug with 409", async () => {
    const db = createMockDb();
    mockLimit.mockResolvedValueOnce([{ id: "ten-existing" }]); // slug exists

    const app = buildApp(db);
    const res = await app.request("/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Duplicate", slug: "acme-corp" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Slug already exists");
  });

  it("create tenant rejects invalid slug format", async () => {
    const db = createMockDb();
    const app = buildApp(db);
    const res = await app.request("/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Bad Slug", slug: "Bad Slug!" }),
    });
    expect(res.status).toBe(400);
  });

  it("list tenants returns array", async () => {
    const db = createMockDb();
    mockSelect.mockReturnValue({
      from: vi.fn().mockResolvedValue([
        { id: "ten-1", name: "Acme", slug: "acme", plan: "free", createdAt: new Date(), updatedAt: new Date() },
        { id: "ten-2", name: "Beta", slug: "beta", plan: "pro", createdAt: new Date(), updatedAt: new Date() },
      ]),
    });

    const app = buildApp(db);
    const res = await app.request("/tenants");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0].slug).toBe("acme");
  });

  it("get tenant returns 404 for non-existent", async () => {
    const db = createMockDb();
    mockLimit.mockResolvedValueOnce([]);

    const app = buildApp(db);
    const res = await app.request("/tenants/ten-nonexistent");
    expect(res.status).toBe(404);
  });

  it("get tenant returns tenant data", async () => {
    const db = createMockDb();
    mockLimit.mockResolvedValueOnce([{
      id: "ten-1", name: "Acme", slug: "acme", plan: "free",
      createdAt: new Date("2025-01-01"), updatedAt: new Date("2025-01-01"),
    }]);

    const app = buildApp(db);
    const res = await app.request("/tenants/ten-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Acme");
    expect(body.slug).toBe("acme");
  });

  it("update tenant modifies name and plan", async () => {
    const db = createMockDb();
    mockLimit.mockResolvedValueOnce([{ id: "ten-1" }]); // existing
    const mockWhereUpdate = vi.fn().mockResolvedValue(undefined);
    mockSet.mockReturnValue({ where: mockWhereUpdate });

    const app = buildApp(db);
    const res = await app.request("/tenants/ten-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New Name", plan: "enterprise" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("delete tenant returns 404 for non-existent", async () => {
    const db = createMockDb();
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const app = buildApp(db);
    const res = await app.request("/tenants/ten-nonexistent", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});