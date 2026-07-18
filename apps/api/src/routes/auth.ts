/**
 * Auth HTTP routes — register / login / refresh / logout.
 *
 * Each route is paired with a `createRoute` definition so the full set
 * shows up in the OpenAPI doc at `/api/docs`. The handlers expect to be
 * registered via `api.openapi(route, handler)` so `c.req.valid("json")`
 * works for request body validation.
 *
 *   POST /api/auth/register   — create a viewer-scoped user, returns tokens
 *   POST /api/auth/login      — exchange credentials for tokens
 *   POST /api/auth/refresh    — rotate refresh token, return new pair
 *   POST /api/auth/logout     — revoke all refresh tokens for the user
 */

import { createRoute } from "@hono/zod-openapi"
import type { Context } from "hono"
import { hash, compare } from "bcryptjs"
import { randomUUID } from "node:crypto"
import { eq, and } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { users, refreshTokens, tenants } from "@max/database"
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../auth/jwt.js"
import { getLogger } from "@max/telemetry"
import {
  ErrorSchema,
  AuthRegisterRequestSchema,
  AuthLoginRequestSchema,
  AuthRefreshRequestSchema,
  AuthTokenResponseSchema,
  AuthRefreshResponseSchema,
  AuthLogoutResponseSchema,
} from "../schemas.js"

const log = getLogger("auth")

interface AuthRouteDeps {
  db: PostgresJsDatabase
  jwtSecret: string
  jwtExpiresIn?: string
  jwtRefreshExpiresIn?: string
  /**
   * When true, self-serve registration creates a personal tenant for the new
   * user and assigns them the `admin` role inside that tenant. When false
   * (single-tenant deployments) the user is left tenant-less with a `viewer`
   * role, matching the legacy behaviour.
   */
  multiTenant?: boolean
}

// ── OpenAPI route definitions ─────────────────────────────────────────────

export const authRegisterRoute = createRoute({
  method: "post",
  path: "/auth/register",
  tags: ["auth"],
  request: { body: { content: { "application/json": { schema: AuthRegisterRequestSchema } } } },
  responses: {
    200: {
      content: { "application/json": { schema: AuthTokenResponseSchema } },
      description: "New user + token pair",
    },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid body" },
    409: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Email already registered",
    },
    500: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Internal error",
    },
  },
})

export const authLoginRoute = createRoute({
  method: "post",
  path: "/auth/login",
  tags: ["auth"],
  request: { body: { content: { "application/json": { schema: AuthLoginRequestSchema } } } },
  responses: {
    200: {
      content: { "application/json": { schema: AuthTokenResponseSchema } },
      description: "Token pair",
    },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid body" },
    401: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Invalid credentials",
    },
  },
})

export const authRefreshRoute = createRoute({
  method: "post",
  path: "/auth/refresh",
  tags: ["auth"],
  request: { body: { content: { "application/json": { schema: AuthRefreshRequestSchema } } } },
  responses: {
    200: {
      content: { "application/json": { schema: AuthRefreshResponseSchema } },
      description: "Rotated token pair",
    },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid body" },
    401: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Invalid or revoked refresh token",
    },
  },
})

export const authLogoutRoute = createRoute({
  method: "post",
  path: "/auth/logout",
  tags: ["auth"],
  responses: {
    200: {
      content: { "application/json": { schema: AuthLogoutResponseSchema } },
      description: "All refresh tokens revoked",
    },
  },
})

export function authRoutes(deps: AuthRouteDeps) {
  const {
    db,
    jwtSecret,
    jwtExpiresIn = "15m",
    jwtRefreshExpiresIn = "7d",
    multiTenant = false,
  } = deps

  return {
    register: async (c: Context) => {
      const body = c.req.valid("json" as never) as { email: string; password: string }
      const { email, password } = body

      // Check for existing user
      const existing = await db.select().from(users).where(eq(users.email, email)).limit(1)
      if (existing.length > 0) {
        return c.json({ error: "Email already registered" }, 409)
      }

      const id = `usr-${randomUUID()}`
      const passwordHash = await hash(password, 12)
      const now = new Date()
      // Sign the refresh token before the tx so we can insert its hash atomically.
      const { token: refreshToken, jti } = await signRefreshToken(
        id,
        jwtSecret,
        jwtRefreshExpiresIn,
      )

      // Multi-tenant mode: every self-serve signup gets a fresh personal
      // tenant so the user can actually access tenant-scoped resources.
      // Without this, the user would be created with no tenantId and
      // immediately locked out of every tenant-scoped endpoint.
      // Both inserts are wrapped in a transaction so a failure on the user
      // insert (e.g. email uniqueness race) rolls back the tenant row —
      // preventing orphan tenants with no owner.
      // The refresh token is also inserted in the same tx so there is
      // never a user without a usable refresh handle.
      let tenantId: string | undefined
      let role: string
      if (multiTenant) {
        const tenantRowId = `tnt-${randomUUID()}`
        const slug = `t-${randomUUID().slice(0, 8)}`
        await db.transaction(async (tx) => {
          await tx.insert(tenants).values({
            id: tenantRowId,
            name: `${email}'s workspace`,
            slug,
            plan: "free",
            createdAt: now,
            updatedAt: now,
          })
          await tx.insert(users).values({
            id,
            email,
            passwordHash,
            role: "admin", // owner of the personal tenant
            tenantId: tenantRowId,
            createdAt: now,
            updatedAt: now,
          })
          await tx.insert(refreshTokens).values({
            id: `rt-${randomUUID()}`,
            jti,
            userId: id,
            tokenHash: await hash(refreshToken, 12),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          })
        })
        tenantId = tenantRowId
        role = "admin"
      } else {
        role = "viewer"
        await db.transaction(async (tx) => {
          await tx.insert(users).values({
            id,
            email,
            passwordHash,
            role,
            tenantId: null,
            createdAt: now,
            updatedAt: now,
          })
          await tx.insert(refreshTokens).values({
            id: `rt-${randomUUID()}`,
            jti,
            userId: id,
            tokenHash: await hash(refreshToken, 12),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          })
        })
      }

      const accessToken = await signAccessToken(id, role, jwtSecret, jwtExpiresIn, tenantId)

      log.info({ userId: id, email, role, tenantId }, "user registered")

      return c.json({
        userId: id,
        email,
        role,
        tenantId: tenantId ?? null,
        accessToken,
        refreshToken,
      })
    },

    login: async (c: Context) => {
      const body = c.req.valid("json" as never) as { email: string; password: string }
      const { email, password } = body

      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
      // Always run a bcrypt compare — even when the user doesn't exist — so
      // the response time for "unknown email" matches "wrong password". Without
      // this, an attacker can enumerate registered emails by measuring how
      // long the login endpoint takes to respond.
      // Dummy hash is pre-computed at cost=12 to match the real registration
      // cost; this keeps both branches within a few microseconds of each other.
      const user = rows[0]
      const dummyHash = "$2b$12$iGiF.fa4v0qPd.rtpA227eXNOHA502SK58AMViH8dp9CfwroOTtbe"
      const valid = await compare(password, user?.passwordHash ?? dummyHash)
      if (!user || !valid) {
        return c.json({ error: "Invalid credentials" }, 401)
      }

      const accessToken = await signAccessToken(
        user.id,
        user.role,
        jwtSecret,
        jwtExpiresIn,
        user.tenantId ?? undefined,
      )
      const { token: refreshToken, jti } = await signRefreshToken(
        user.id,
        jwtSecret,
        jwtRefreshExpiresIn,
      )

      // Store refresh token hash (with jti for O(1) lookup)
      await db.insert(refreshTokens).values({
        id: `rt-${randomUUID()}`,
        jti,
        userId: user.id,
        tokenHash: await hash(refreshToken, 12),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })

      log.info({ userId: user.id, email, tenantId: user.tenantId }, "user logged in")

      return c.json({
        userId: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId ?? null,
        accessToken,
        refreshToken,
      })
    },

    refresh: async (c: Context) => {
      const body = c.req.valid("json" as never) as { refreshToken: string }
      const { refreshToken } = body

      let payload
      try {
        payload = await verifyRefreshToken(refreshToken, jwtSecret)
      } catch {
        return c.json({ error: "Invalid refresh token" }, 401)
      }

      // Atomically: lock the token row, verify hash, revoke, and issue a new
      // pair. Wrapping in a single transaction with SELECT ... FOR UPDATE
      // prevents the TOCTOU race where two concurrent refreshes with the
      // same valid token both see `revoked=false`, both insert a new token,
      // and both return a fresh session (attacker + legitimate user).
      let newAccessToken: string
      let newRefreshToken: string

      try {
        const result = await db.transaction(async (tx) => {
          const rows = await tx
            .select()
            .from(refreshTokens)
            .where(eq(refreshTokens.jti, payload.jti))
            .for("update")
            .limit(1)

          if (rows.length === 0 || rows[0].revoked) {
            return { ok: false as const }
          }

          // Verify hash BEFORE revoking — if invalid, leave the row alone so
          // a legitimate user isn't accidentally logged out by an attacker
          // submitting a guess.
          const valid = await compare(refreshToken, rows[0].tokenHash)
          if (!valid) {
            return { ok: false as const }
          }

          // Revoke the used token inside the same transaction.
          await tx
            .update(refreshTokens)
            .set({ revoked: true })
            .where(eq(refreshTokens.jti, payload.jti))

          const userRows = await tx.select().from(users).where(eq(users.id, payload.sub)).limit(1)
          if (userRows.length === 0) {
            return { ok: false as const }
          }
          const user = userRows[0]

          const access = await signAccessToken(
            user.id,
            user.role,
            jwtSecret,
            jwtExpiresIn,
            user.tenantId ?? undefined,
          )
          const { token: refresh, jti: newJti } = await signRefreshToken(
            user.id,
            jwtSecret,
            jwtRefreshExpiresIn,
          )

          await tx.insert(refreshTokens).values({
            id: `rt-${randomUUID()}`,
            jti: newJti,
            userId: user.id,
            tokenHash: await hash(refresh, 12),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          })

          return { ok: true as const, access, refresh }
        })

        if (!result.ok) {
          return c.json({ error: "Invalid or revoked refresh token" }, 401)
        }
        newAccessToken = result.access
        newRefreshToken = result.refresh
      } catch (err) {
        log.error({ err }, "refresh transaction failed")
        return c.json({ error: "Invalid or revoked refresh token" }, 401)
      }

      return c.json({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      })
    },

    logout: async (c: Context) => {
      const userId = c.get("userId")
      if (!userId) {
        // Dev mode (no JWT_SECRET): authMiddleware skips, userId is undefined.
        // Return success instead of 401 to avoid breaking the dev experience.
        return c.json({ ok: true })
      }

      // Revoke all refresh tokens for this user
      await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, userId))

      log.info({ userId }, "user logged out")

      return c.json({ ok: true })
    },
  }
}
