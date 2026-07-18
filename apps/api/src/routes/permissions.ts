/**
 * Permissions HTTP routes — read/update the on-disk `Permissions` config that
 * the runtime gate (`withPermission`) consults before letting any tool call
 * through. Mirrors the OpenCode pattern of "first match wins, fall back to
 * per-tool default".
 *
 *   GET    /api/permissions             — full current config
 *   PUT    /api/permissions             — replace config (validated + persisted)
 *   POST   /api/permissions/resolve     — preview the decision for a sample
 *                                          { tool, input } pair (no execution)
 *   POST   /api/permissions/test        — check whether a single glob pattern
 *                                          matches a candidate path/command
 *   POST   /api/permissions/reset       — restore DEFAULT_PERMISSIONS
 *   POST   /api/permissions/answer      — answer a pending runtime prompt
 *                                          (delegates to runtime.resolvePermission)
 *
 * The runtime can subscribe to updates by re-`loadPermissions()` after any
 * successful PUT. The wrapper takes a `PermissionProvider` function, so as
 * long as callers re-materialize, they'll see the new rules immediately.
 *
 * Each handler is paired with a `createRoute` definition so the full set
 * shows up in the OpenAPI doc mounted at `/api/docs`.
 */

import { createRoute } from "@hono/zod-openapi"
import type { Context } from "hono"
import { join } from "node:path"
import { homedir } from "node:os"
import { readFile, writeFile, rename, mkdir } from "node:fs/promises"
import { getLogger } from "@max/telemetry"
import {
  validatePermissions,
  resolvePermission,
  matchPattern,
  DEFAULT_PERMISSIONS,
  type Permissions,
  type Permission,
  type ToolName,
  TOOL_NAMES,
} from "@max/tools/permission"
import {
  ErrorSchema,
  PermissionsConfigSchema,
  ResolveRequestSchema,
  ResolveResponseSchema,
  TestRequestSchema,
  TestResponseSchema,
  AnswerRequestSchema,
  AnswerResponseSchema,
  PermissionAuditQuerySchema,
  PermissionAuditResponseSchema,
} from "../schemas.js"

const log = getLogger("permissions")

/**
 * Hook into the AgentRuntime so the API route can unblock parked prompts.
 * Matches the runtime's public method shape — the actual `AgentRuntime`
 * instance is passed in by `apps/api/src/index.ts`.
 */
export interface PermissionAnswerPort {
  resolvePermission(requestId: string, decision: "allow" | "deny"): boolean
  /**
   * Look up a pending permission request's metadata (tool, target) so the
   * route can persist the user's decision to `permissions.json`. Without
   * this, every call to the same (tool, target) re-prompts the user -
   * an infinite popup loop for any tool whose default is `ask`.
   */
  getPendingPermission?(requestId: string): {
    workspaceId: string
    taskId: string
    tool: string
    target: string
    promptedAt: string
  }
  /**
   * Return the audit trail. The runtime owns the log; this port lets the
   * API expose `/api/permissions/audit` without a hard dependency on
   * `@max/core` from the route module (keeps test setup minimal).
   */
  getPermissionAudit?(query?: {
    since?: string
    limit?: number
    tool?: string
    workspaceId?: string
  }): Array<{
    at: string
    requestId: string
    workspaceId: string
    taskId: string
    tool: string
    target: string
    decision: "ask" | "allow" | "deny"
    promptedAt?: string
  }>
  /**
   * Count of audit entries matching the filter (ignoring `limit`). Used
   * by the `/audit` endpoint so the `total` field reflects the full
   * result set rather than the page size. Optional — when absent the
   * endpoint falls back to `items.length`.
   */
  countPermissionAudit?(opts: { since?: string; tool?: string; workspaceId?: string }): number
}

/**
 * The on-disk store is parameterised by a root dir (defaults to
 * `~/.maximilian`). Tests pass a temp dir; production passes nothing.
 */
export interface PermissionsRoutesDeps {
  /** Override the directory where `permissions.json` is persisted. */
  rootDir?: string
  /**
   * Runtime port for resolving pending permission requests. When omitted
   * the /answer endpoint returns 503 — useful for tests that exercise only
   * the on-disk config routes.
   */
  runtime?: PermissionAnswerPort
  /**
   * Tenant isolation check: returns true if `workspaceId` belongs to
   * `tenantId` (or is unowned and tenantId is undefined - dev mode).
   * The /answer route calls this before resolving a pending prompt so
   * tenant B can't answer permission requests for tenant A's workspace.
   * When omitted, the route skips the check (backward compatible with
   * tests that don't exercise multi-tenancy).
   */
  checkWorkspaceTenant?: (workspaceId: string, tenantId: string | undefined) => Promise<boolean>
}

function dirFor(rootDir?: string): string {
  return rootDir ?? join(homedir(), ".maximilian")
}

function filePathFor(rootDir?: string): string {
  return join(dirFor(rootDir), "permissions.json")
}

function isENOENT(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT"
}

async function loadFrom(rootDir?: string): Promise<Permissions> {
  const path = filePathFor(rootDir)
  try {
    const raw = await readFile(path, "utf-8")
    return validatePermissions(JSON.parse(raw))
  } catch (err) {
    if (isENOENT(err)) return DEFAULT_PERMISSIONS
    throw err
  }
}

async function saveTo(config: Permissions, rootDir?: string): Promise<void> {
  const dir = dirFor(rootDir)
  const path = filePathFor(rootDir)
  await mkdir(dir, { recursive: true })
  const tmp = `${path}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(config, null, 2), "utf-8")
  await rename(tmp, path)
}

function isToolName(v: unknown): v is ToolName {
  return typeof v === "string" && (TOOL_NAMES as readonly string[]).includes(v)
}

// ── OpenAPI route definitions ─────────────────────────────────────────────

export const getPermissionsRoute = createRoute({
  method: "get",
  path: "/permissions",
  tags: ["permissions"],
  responses: {
    200: {
      content: { "application/json": { schema: PermissionsConfigSchema } },
      description: "Current permissions config",
    },
    500: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Internal error",
    },
  },
})

export const putPermissionsRoute = createRoute({
  method: "put",
  path: "/permissions",
  tags: ["permissions"],
  request: { body: { content: { "application/json": { schema: PermissionsConfigSchema } } } },
  responses: {
    200: {
      content: { "application/json": { schema: PermissionsConfigSchema } },
      description: "Persisted config",
    },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid JSON" },
    500: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Internal error",
    },
  },
})

export const resolvePermissionRoute = createRoute({
  method: "post",
  path: "/permissions/resolve",
  tags: ["permissions"],
  request: { body: { content: { "application/json": { schema: ResolveRequestSchema } } } },
  responses: {
    200: {
      content: { "application/json": { schema: ResolveResponseSchema } },
      description: "Decision for the given tool/input",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Invalid tool or body",
    },
    500: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Internal error",
    },
  },
})

export const testPermissionRoute = createRoute({
  method: "post",
  path: "/permissions/test",
  tags: ["permissions"],
  request: { body: { content: { "application/json": { schema: TestRequestSchema } } } },
  responses: {
    200: {
      content: { "application/json": { schema: TestResponseSchema } },
      description: "Pattern match result",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Missing pattern or value",
    },
  },
})

export const resetPermissionsRoute = createRoute({
  method: "post",
  path: "/permissions/reset",
  tags: ["permissions"],
  responses: {
    200: {
      content: { "application/json": { schema: PermissionsConfigSchema } },
      description: "Restored default config",
    },
    500: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Internal error",
    },
  },
})

export const answerPermissionRoute = createRoute({
  method: "post",
  path: "/permissions/answer",
  tags: ["permissions"],
  request: { body: { content: { "application/json": { schema: AnswerRequestSchema } } } },
  responses: {
    200: {
      content: { "application/json": { schema: AnswerResponseSchema } },
      description: "Decision applied",
    },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid body" },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Unknown request id",
    },
    503: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Runtime unavailable",
    },
  },
})

export const auditPermissionsRoute = createRoute({
  method: "get",
  path: "/permissions/audit",
  tags: ["permissions"],
  request: { query: PermissionAuditQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: PermissionAuditResponseSchema } },
      description: "Audit log entries",
    },
    503: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Runtime unavailable",
    },
  },
})

export function permissionsRoutes(deps: PermissionsRoutesDeps = {}) {
  const { rootDir, runtime, checkWorkspaceTenant } = deps
  return {
    /** GET /api/permissions — return the current persisted config. */
    get: async (c: Context) => {
      try {
        const config = await loadFrom(rootDir)
        return c.json(config)
      } catch (err) {
        log.error({ err }, "load permissions failed")
        return c.json({ error: "internal_error" }, 500)
      }
    },

    /**
     * PUT /api/permissions — replace the persisted config.
     * Body is the full `Permissions` object; unknown tools and bad actions
     * are dropped by `validatePermissions` rather than rejected, so the
     * dashboard can ship loose drafts and the server still applies the sane
     * subset.
     */
    put: async (c: Context) => {
      let raw: unknown
      try {
        raw = await c.req.json()
      } catch {
        return c.json({ error: "invalid_json" }, 400)
      }
      const validated = validatePermissions(raw)
      try {
        await saveTo(validated, rootDir)
        return c.json(validated)
      } catch (err) {
        log.error({ err }, "save permissions failed")
        return c.json({ error: "internal_error" }, 500)
      }
    },

    /**
     * POST /api/permissions/resolve — preview a decision for a sample
     * (tool, input) pair using the current persisted config. Useful for the
     * "would this be allowed?" indicators in the UI.
     */
    resolve: async (c: Context) => {
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return c.json({ error: "invalid_json" }, 400)
      }
      if (!body || typeof body !== "object") {
        return c.json({ error: "body_required" }, 400)
      }
      const b = body as Record<string, unknown>
      const tool = b.tool
      const input = b.input ?? {}
      if (!isToolName(tool)) {
        return c.json({ error: "invalid_tool", allowed: TOOL_NAMES }, 400)
      }
      try {
        const config = await loadFrom(rootDir)
        const decision = resolvePermission(tool, input, config)
        return c.json({ tool, decision, config })
      } catch (err) {
        log.error({ err, tool }, "resolve permission failed")
        return c.json({ error: "internal_error" }, 500)
      }
    },

    /**
     * POST /api/permissions/test — check a single pattern against a value
     * without touching the saved config. Pure function over glob semantics,
     * exposed so the UI's "test pattern" widget has somewhere to call.
     */
    test: async (c: Context) => {
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return c.json({ error: "invalid_json" }, 400)
      }
      if (!body || typeof body !== "object") {
        return c.json({ error: "body_required" }, 400)
      }
      const b = body as Record<string, unknown>
      const pattern = b.pattern
      const value = b.value
      if (typeof pattern !== "string" || typeof value !== "string") {
        return c.json({ error: "pattern_and_value_required" }, 400)
      }
      const matches = matchPattern(pattern, value)
      return c.json({ pattern, value, matches })
    },

    /** POST /api/permissions/reset — restore defaults. */
    reset: async (c: Context) => {
      try {
        await saveTo(DEFAULT_PERMISSIONS, rootDir)
        return c.json(DEFAULT_PERMISSIONS)
      } catch (err) {
        log.error({ err }, "reset permissions failed")
        return c.json({ error: "internal_error" }, 500)
      }
    },

    /**
     * POST /api/permissions/answer — body: `{ requestId, decision }`. Unblocks
     * a parked task by delegating to the runtime. Returns 404 if the request
     * id is unknown (already resolved, or the runtime never saw it).
     */
    answer: async (c: Context) => {
      if (!runtime) {
        return c.json({ error: "runtime_unavailable" }, 503)
      }
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return c.json({ error: "invalid_json" }, 400)
      }
      if (!body || typeof body !== "object") {
        return c.json({ error: "body_required" }, 400)
      }
      const b = body as Record<string, unknown>
      const requestId = b.requestId
      const decision = b.decision
      if (typeof requestId !== "string") {
        return c.json({ error: "requestId_required" }, 400)
      }
      if (decision !== "allow" && decision !== "deny") {
        return c.json({ error: "decision_must_be_allow_or_deny" }, 400)
      }

      // Look up the pending request's (tool, target) so we can persist
      // the decision to permissions.json. Without this, the runtime
      // unblocks the current call but the next call to the same
      // tool+target prompts again - an infinite popup loop for any
      // tool whose default is `ask`. Persistence failures are logged
      // but do NOT block the resolution: the user's in-flight decision
      // still takes effect, they just might get re-prompted next time.
      const pending = runtime.getPendingPermission?.(requestId)

      // Tenant isolation: before resolving, verify the caller's
      // tenantId matches the workspace that owns this pending prompt.
      // Without this, tenant B could answer tenant A's permission
      // requests just by guessing the requestId. Skip when the check
      // isn't wired (tests) or when the pending request is unknown
      // (will fall through to the 404 below).
      if (pending && checkWorkspaceTenant) {
        const callerTenantId = (c as any).get("tenantId") as string | undefined
        const allowed = await checkWorkspaceTenant(pending.workspaceId, callerTenantId)
        if (!allowed) {
          log.warn(
            { workspaceId: pending.workspaceId, callerTenantId },
            "permission answer denied - workspace belongs to a different tenant",
          )
          return c.json({ error: "forbidden" }, 403)
        }
      }

      // Resolve FIRST — only persist the decision if the request is still
      // alive. Persisting before resolve meant a stale request (already
      // aborted/timeout) would have its (tool, target) pattern silently
      // written to permissions.json and bypass the next prompt.
      const ok = runtime.resolvePermission(requestId, decision)
      if (!ok) {
        return c.json({ error: "unknown_request" }, 404)
      }

      if (pending && pending.target && isToolName(pending.tool)) {
        try {
          const config = await loadFrom(rootDir)
          const toolPatterns = config.patterns[pending.tool] ?? {}
          // Exact-match pattern: future calls with the same target
          // inherit this decision without re-prompting. The user can
          // broaden the rule via PUT /permissions if they want a
          // glob-style allowance.
          toolPatterns[pending.target] = decision
          config.patterns[pending.tool] = toolPatterns
          await saveTo(config, rootDir)
          log.info(
            { tool: pending.tool, target: pending.target, decision },
            "persisted permission decision to config",
          )
        } catch (err) {
          // Persistence is best-effort: don't fail the resolution just
          // because we couldn't write the config. The user will see
          // another prompt next time, which is annoying but not broken.
          log.error({ err, requestId }, "failed to persist permission decision")
        }
      }

      return c.json({ requestId, decision })
    },

    /**
     * GET /api/permissions/audit — return the runtime's audit log of
     * `ask → allow/deny` decisions. Optional `since`, `tool`,
     * `workspaceId`, `limit` filters. Returns 503 when the runtime isn't
     * wired up (e.g. tests that exercise only the on-disk config routes).
     */
    audit: async (c: any) => {
      if (!runtime?.getPermissionAudit) {
        return c.json({ error: "runtime_unavailable" }, 503)
      }
      const q = c.req.valid("query") as {
        since?: string
        limit: number
        tool?: string
        workspaceId?: string
      }
      const filter = {
        since: q.since,
        tool: q.tool,
        workspaceId: q.workspaceId,
      }
      const items = runtime.getPermissionAudit({ ...filter, limit: q.limit })
      // `total` is the full filtered count (not the page size) so callers
      // paginating know whether more pages remain.
      const total = runtime.countPermissionAudit
        ? runtime.countPermissionAudit(filter)
        : items.length
      return c.json({ items, total })
    },
  }
}

/** Type re-exports for callers that compose this route into a larger API. */
export type { Permissions, Permission, ToolName }
