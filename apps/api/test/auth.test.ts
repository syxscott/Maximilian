/**
 * Auth route tests — register / login / refresh / logout.
 *
 * Routes are registered via `app.openapi()` so request body validation
 * runs through the route spec, matching production. Mocks for
 * drizzle + @max/database keep the test off a real Postgres.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { hash as bcryptHash } from "bcryptjs";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ a, b })),
  and: vi.fn((...args) => ({ args })),
}));

vi.mock("@max/database", () => ({
  users: {
    id: "id",
    email: "email",
    passwordHash: "passwordHash",
    role: "role",
    tenantId: "tenantId",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
  refreshTokens: {
    id: "id",
    jti: "jti",
    userId: "userId",
    tokenHash: "tokenHash",
    revoked: "revoked",
    expiresAt: "expiresAt",
  },
}));

const JWT_SECRET = "test-secret-do-not-use-in-prod";

interface MockDb {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
}

function createMockDb(): MockDb {
  const mockSelect = vi.fn();
  const mockInsert = vi.fn();
  const mockUpdate = vi.fn();
  const mockFrom = vi.fn();
  const mockWhere = vi.fn();
  const mockLimit = vi.fn();
  const mockValues = vi.fn();
  const mockSet = vi.fn();

  const db: MockDb = {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    transaction: vi.fn(async (fn: (tx: MockDb) => Promise<unknown>) => fn(db)),
  };

  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit, for: mockLimit });
  mockWhere.mockReturnValue({ limit: mockLimit, for: mockLimit });
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockResolvedValue(undefined);
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

  return db;
}

function buildApp(db: MockDb, secret = JWT_SECRET) {
  const app = new OpenAPIHono();
  const r = authRoutes({ db, jwtSecret: secret });
  app.openapi(authRegisterRoute, r.register);
  app.openapi(authLoginRoute, r.login);
  app.openapi(authRefreshRoute, r.refresh);
  // logout uses c.get("userId") which is set by auth middleware — for tests,
  // we register without middleware and the handler returns { ok: true }.
  app.openapi(authLogoutRoute, r.logout);
  return app;
}

// Static imports so the route definitions are in scope for buildApp.
import {
  authRoutes,
  authRegisterRoute,
  authLoginRoute,
  authRefreshRoute,
  authLogoutRoute,
} from "../src/routes/auth";

describe("Auth routes", () => {
  let db: MockDb;
  let mockLimit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    // Re-derive mockLimit — it's nested inside db.select.from.where.limit
    mockLimit = db.select().from({}).limit as unknown as ReturnType<typeof vi.fn>;
  });

  it("register creates a viewer user and returns access + refresh tokens", async () => {
    // Stash the limit mock so the existing-user check returns []
    const selectLimitMock = vi.fn().mockResolvedValueOnce([]);
    db.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: selectLimitMock }),
      }),
    }) as never;

    const app = buildApp(db);
    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com", password: "password123" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe("alice@example.com");
    expect(body.role).toBe("viewer");
    expect(body.accessToken).toMatch(/^eyJ/);
    expect(body.refreshToken).toMatch(/^eyJ/);
  });

  it("register rejects duplicate email with 409", async () => {
    const selectLimitMock = vi.fn().mockResolvedValueOnce([{ id: "usr-existing" }]);
    db.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: selectLimitMock }),
      }),
    }) as never;

    const app = buildApp(db);
    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com", password: "password123" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Email already registered");
  });

  it("register rejects invalid email with 400", async () => {
    const app = buildApp(db);
    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", password: "password123" }),
    });
    expect(res.status).toBe(400);
  });

  it("register rejects short password with 400", async () => {
    const app = buildApp(db);
    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com", password: "short" }),
    });
    expect(res.status).toBe(400);
  });

  it("login returns 401 for unknown email", async () => {
    const selectLimitMock = vi.fn().mockResolvedValueOnce([]);
    db.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: selectLimitMock }),
      }),
    }) as never;

    const app = buildApp(db);
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ghost@example.com", password: "password123" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Invalid credentials");
  });

  it("login returns 401 for wrong password", async () => {
    const passwordHash = await bcryptHash("password123", 4);
    const selectLimitMock = vi.fn().mockResolvedValueOnce([{
      id: "usr-1",
      email: "alice@example.com",
      passwordHash,
      role: "viewer",
      tenantId: null,
    }]);
    db.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: selectLimitMock }),
      }),
    }) as never;

    const app = buildApp(db);
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com", password: "WRONG-password" }),
    });
    expect(res.status).toBe(401);
  });

  it("login returns tokens for valid credentials", async () => {
    const passwordHash = await bcryptHash("password123", 4);
    const selectLimitMock = vi.fn().mockResolvedValueOnce([{
      id: "usr-1",
      email: "alice@example.com",
      passwordHash,
      role: "viewer",
      tenantId: "ten-1",
    }]);
    db.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: selectLimitMock }),
      }),
    }) as never;

    const app = buildApp(db);
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com", password: "password123" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe("usr-1");
    expect(body.tenantId).toBe("ten-1");
    expect(body.accessToken).toMatch(/^eyJ/);
    expect(body.refreshToken).toMatch(/^eyJ/);
  });

  it("refresh returns 401 for malformed token", async () => {
    const app = buildApp(db);
    const res = await app.request("/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: "garbage" }),
    });
    expect(res.status).toBe(401);
  });

  it("refresh returns new token pair for valid refresh token", async () => {
    const { signRefreshToken } = await import("../src/auth/jwt");
    const { token: refreshToken, jti } = await signRefreshToken("usr-1", JWT_SECRET);
    const tokenHash = await bcryptHash(refreshToken, 4);

    // Mock the transaction to return the expected rows.
    const txMock = vi.fn(async (fn: (tx: MockDb) => Promise<unknown>) => {
      const tokenRowPromise = vi.fn().mockResolvedValueOnce([{ jti, tokenHash, revoked: false }]);
      const userRowPromise = vi.fn().mockResolvedValueOnce([{ id: "usr-1", role: "viewer", tenantId: null }]);
      const txDb: MockDb = {
        ...db,
        select: vi.fn().mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              for: vi.fn().mockReturnValueOnce({ limit: tokenRowPromise }),
            }),
          }),
        }).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({ limit: userRowPromise }),
          }),
        }) as never,
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }) as never,
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined),
        }) as never,
      };
      return fn(txDb);
    });
    db.transaction = txMock as never;

    const app = buildApp(db);
    const res = await app.request("/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accessToken).toMatch(/^eyJ/);
    expect(body.refreshToken).toMatch(/^eyJ/);
    expect(body.refreshToken).not.toBe(refreshToken); // rotated
  });

  it("logout returns 200 even without userId (dev mode)", async () => {
    const app = buildApp(db);
    const res = await app.request("/auth/logout", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});