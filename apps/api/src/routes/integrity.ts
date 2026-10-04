// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Integrity admin routes: the hash-chained audit ledger and the git
 * shadow-commit rollback surface.
 *
 *   GET  /api/audit/verify            — walk the audit ledger's hash chain
 *   GET  /api/audit/shadow            — list shadow commits (rollback points)
 *   POST /api/audit/shadow/rollback   — restore the workspace tree to a shadow
 *
 * All three are admin-only: rollback discards uncommitted work in the
 * workspace directory, and verify exposes the audit trail's health.
 */

import { createRoute } from "@hono/zod-openapi"
import { z } from "zod"
import {
  AuditLedger,
  ShadowCommitError,
  createShadowCommit,
  listShadowCommits,
  rollbackToShadow,
  type ShadowCommitEntry,
} from "@max/workspace"

// ── Route definitions ─────────────────────────────────────────────────────

export const verifyAuditRoute = createRoute({
  method: "get",
  path: "/audit/verify",
  tags: ["audit"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            ok: z.boolean(),
            entries: z.number(),
            brokenAt: z.number().optional(),
            error: z.string().optional(),
          }),
        },
      },
      description: "Audit ledger hash-chain verification",
    },
    503: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Audit ledger not configured",
    },
  },
})

export const listShadowRoute = createRoute({
  method: "get",
  path: "/audit/shadow",
  tags: ["audit"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ shadows: z.array(z.record(z.string(), z.unknown())) }),
        },
      },
      description: "Shadow commits (newest first)",
    },
  },
})

export const rollbackShadowRoute = createRoute({
  method: "post",
  path: "/audit/shadow/rollback",
  tags: ["audit"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().min(4),
            /** Roll back even when the worktree is dirty (discards changes). */
            force: z.boolean().optional(),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ ok: z.boolean(), restored: z.string() }) },
      },
      description: "Worktree restored to the shadow snapshot",
    },
    400: {
      content: {
        "application/json": { schema: z.object({ error: z.string(), code: z.string() }) },
      },
      description: "Invalid shadow id",
    },
    404: {
      content: {
        "application/json": { schema: z.object({ error: z.string(), code: z.string() }) },
      },
      description: "Unknown shadow id",
    },
    409: {
      content: {
        "application/json": { schema: z.object({ error: z.string(), code: z.string() }) },
      },
      description: "Dirty worktree / not a git repository",
    },
  },
})

export const createShadowRoute = createRoute({
  method: "post",
  path: "/audit/shadow",
  tags: ["audit"],
  request: {
    body: {
      content: {
        "application/json": { schema: z.object({ label: z.string().min(1) }) },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean(), shadow: z.record(z.string(), z.unknown()) }),
        },
      },
      description: "Shadow snapshot created",
    },
    409: {
      content: {
        "application/json": { schema: z.object({ error: z.string(), code: z.string() }) },
      },
      description: "Not a git repository",
    },
  },
})

// ── Handlers ──────────────────────────────────────────────────────────────

export interface IntegrityDeps {
  /** The security audit ledger instance (may be undefined in tests). */
  audit?: AuditLedger
  /** Directory shadow commits snapshot / restore. Git repo required. */
  repoDir: string
}

export function verifyAudit(deps: IntegrityDeps) {
  return async (c: { json: (data: unknown, status?: number) => unknown }) => {
    if (deps.audit === undefined) {
      return c.json({ error: "audit_ledger_not_configured" }, 503)
    }
    const result = await deps.audit.verify()
    return c.json({
      ok: result.ok,
      entries: result.entries,
      ...(result.brokenAt !== undefined ? { brokenAt: result.brokenAt } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
    })
  }
}

export function listShadow(deps: IntegrityDeps) {
  return async (c: { json: (data: unknown, status?: number) => unknown }) => {
    const shadows = await listShadowCommits(deps.repoDir)
    return c.json({ shadows })
  }
}

export function createShadow(deps: IntegrityDeps) {
  return async (c: {
    req: { valid: (t: "json") => { label: string } }
    json: (data: unknown, status?: number) => unknown
  }) => {
    const { label } = c.req.valid("json")
    try {
      const shadow = await createShadowCommit(deps.repoDir, label, { audit: deps.audit })
      return c.json({ ok: true, shadow })
    } catch (err) {
      return shadowError(c, err)
    }
  }
}

export function rollbackShadow(deps: IntegrityDeps) {
  return async (c: {
    req: { valid: (t: "json") => { id: string; force?: boolean } }
    json: (data: unknown, status?: number) => unknown
  }) => {
    const { id, force } = c.req.valid("json")
    try {
      const restored: ShadowCommitEntry = await rollbackToShadow(deps.repoDir, id, {
        force,
        audit: deps.audit,
      })
      return c.json({ ok: true, restored: restored.id })
    } catch (err) {
      return shadowError(c, err)
    }
  }
}

/** Map ShadowCommitError codes onto HTTP statuses; rethrow anything else. */
function shadowError(
  c: { json: (data: unknown, status?: number) => unknown },
  err: unknown,
): unknown {
  if (err instanceof ShadowCommitError) {
    const status = err.code === "unknown-id" || err.code === "invalid-id" ? 404 : 409
    return c.json({ error: err.message, code: err.code }, status)
  }
  throw err
}
