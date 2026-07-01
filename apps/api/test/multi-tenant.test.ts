/**
 * Tests for multi-tenant JWT and middleware behavior.
 *
 * Verifies:
 *   - signAccessToken includes tenantId when provided
 *   - authMiddleware extracts tenantId from JWT
 *   - authMiddleware works without tenantId (backward compatible)
 */

import { describe, it, expect, vi } from "vitest";

describe("Multi-tenant JWT", () => {
  it("signAccessToken includes tenantId in payload", async () => {
    const { signAccessToken, verifyAccessToken } = await import("../src/auth/jwt.js");
    const secret = "test-secret-key-for-jwt-signing";
    const token = await signAccessToken("user-1", "admin", secret, "15m", "ten-123");
    const payload = await verifyAccessToken(token, secret);
    expect(payload.sub).toBe("user-1");
    expect(payload.role).toBe("admin");
    expect(payload.tenantId).toBe("ten-123");
  });

  it("signAccessToken works without tenantId", async () => {
    const { signAccessToken, verifyAccessToken } = await import("../src/auth/jwt.js");
    const secret = "test-secret-key-for-jwt-signing";
    const token = await signAccessToken("user-2", "viewer", secret, "15m");
    const payload = await verifyAccessToken(token, secret);
    expect(payload.sub).toBe("user-2");
    expect(payload.tenantId).toBeUndefined();
  });

  it("authMiddleware extracts tenantId from JWT", async () => {
    const { signAccessToken } = await import("../src/auth/jwt.js");
    const { authMiddleware } = await import("../src/auth/middleware.js");
    const secret = "test-secret-for-middleware";
    const token = await signAccessToken("user-3", "operator", secret, "15m", "ten-456");

    const middleware = authMiddleware(secret);
    let capturedTenantId: string | undefined;
    let capturedUserId: string | undefined;

    const fakeCtx = {
      req: {
        header: (name: string) => name === "Authorization" ? `Bearer ${token}` : undefined,
        url: "http://localhost/test",
      },
      json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
      set: (key: string, value: string) => {
        if (key === "tenantId") capturedTenantId = value;
        if (key === "userId") capturedUserId = value;
      },
      get: (key: string) => key === "userId" ? capturedUserId : undefined,
    } as never;

    let nextCalled = false;
    await middleware(fakeCtx, async () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(capturedUserId).toBe("user-3");
    expect(capturedTenantId).toBe("ten-456");
  });

  it("authMiddleware works without tenantId in token", async () => {
    const { signAccessToken } = await import("../src/auth/jwt.js");
    const { authMiddleware } = await import("../src/auth/middleware.js");
    const secret = "test-secret-for-middleware-2";
    const token = await signAccessToken("user-4", "viewer", secret, "15m");

    const middleware = authMiddleware(secret);
    let capturedTenantId: string | undefined;

    const fakeCtx = {
      req: {
        header: (name: string) => name === "Authorization" ? `Bearer ${token}` : undefined,
        url: "http://localhost/test",
      },
      json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
      set: (key: string, value: string) => {
        if (key === "tenantId") capturedTenantId = value;
      },
      get: vi.fn(),
    } as never;

    let nextCalled = false;
    await middleware(fakeCtx, async () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    // tenantId should NOT have been set since the token has no tenantId
    expect(capturedTenantId).toBeUndefined();
  });

  it("authMiddleware returns 401 for missing token", async () => {
    const { authMiddleware } = await import("../src/auth/middleware.js");
    const middleware = authMiddleware("some-secret");

    const fakeCtx = {
      req: {
        header: () => undefined,
        url: "http://localhost/test",
      },
      json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
      set: vi.fn(),
      get: vi.fn(),
    } as never;

    const res = await middleware(fakeCtx, async () => {});
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });

  it("authMiddleware skips auth when no secret configured (dev mode)", async () => {
    const { authMiddleware } = await import("../src/auth/middleware.js");
    const middleware = authMiddleware(undefined);

    let nextCalled = false;
    const fakeCtx = {
      req: { header: () => undefined },
      set: vi.fn(),
      get: vi.fn(),
    } as never;

    await middleware(fakeCtx, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});
