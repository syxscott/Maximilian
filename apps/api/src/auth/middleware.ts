import type { Context, Next } from "hono";
import { verifyAccessToken } from "./jwt.js";

type AppEnv = { Variables: { requestId: string; userId?: string; userRole?: string; tenantId?: string } };

/**
 * JWT auth middleware for Hono.
 *
 * Extracts Bearer token from Authorization header, verifies it,
 * and attaches userId + userRole to the context.
 *
 * When JWT_SECRET is not configured, auth is skipped (dev mode).
 * Returns 401 on missing/invalid token.
 */
export function authMiddleware(jwtSecret: string | undefined) {
  return async (c: Context<AppEnv>, next: Next) => {
    // No secret configured = dev mode, skip auth
    if (!jwtSecret) return next();

    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) {
      return c.json({ error: "unauthorized", code: "MISSING_TOKEN" }, 401);
    }

    try {
      const payload = await verifyAccessToken(token, jwtSecret);
      c.set("userId", payload.sub);
      c.set("userRole", payload.role);
      if (payload.tenantId) c.set("tenantId", payload.tenantId);
    } catch {
      return c.json({ error: "unauthorized", code: "INVALID_TOKEN" }, 401);
    }

    return next();
  };
}

/**
 * Role-based access guard.
 * Returns 403 if the user's role is not in the allowed list.
 */
export function requireRole(...roles: string[]) {
  return async (c: Context<AppEnv>, next: Next) => {
    const userRole = c.get("userRole");
    if (!userRole || !roles.includes(userRole)) {
      return c.json({ error: "forbidden", code: "INSUFFICIENT_ROLE" }, 403);
    }
    return next();
  };
}
