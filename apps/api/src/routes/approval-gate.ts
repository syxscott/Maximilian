// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Remote approval gate routes (oh-my-claudecode remote-approval borrowing).
 *
 *   POST /api/permissions/gate/release  — loopback-only: release a held
 *                                         "allow" answer and apply it to
 *                                         the parked prompt via the runtime.
 *   GET  /api/permissions/gate/pending  — list held answers + gate counters.
 *
 * Both sit under the existing `/permissions/*` auth middleware; no new
 * event types are emitted — release goes through the same
 * `runtime.resolvePermission` port the answer route uses, so the
 * `permission-request` / `permission-resolved` contract is unchanged.
 */

import { createRoute } from "@hono/zod-openapi"
import type { Context } from "hono"
import { z } from "zod"
import { getLogger } from "@max/telemetry"
import type { AuditLedger } from "@max/workspace"
import { ErrorSchema } from "../schemas.js"
import {
  RemoteApprovalGate,
  requestRemoteAddress,
  type GateEntry,
} from "../lib/remote-approval-gate.js"
import type { PermissionAnswerPort } from "./permissions.js"

const log = getLogger("permissions")

const GateReleaseRequestSchema = z.object({
  requestId: z.string().min(1),
})

const GateReleaseResponseSchema = z.object({
  requestId: z.string(),
  decision: z.enum(["allow", "deny"]),
  gate: z.literal("released"),
})

const GatePendingEntrySchema = z.object({
  requestId: z.string(),
  decision: z.literal("allow"),
  requestedAt: z.string(),
  remoteAddress: z.string().optional(),
  status: z.enum(["pending-gate", "released"]),
})

const GatePendingResponseSchema = z.object({
  items: z.array(GatePendingEntrySchema),
  snapshot: z.object({
    enabled: z.boolean(),
    pending: z.number(),
    held: z.number(),
    released: z.number(),
    expired: z.number(),
  }),
})

export const releaseApprovalGateRoute = createRoute({
  method: "post",
  path: "/permissions/gate/release",
  tags: ["permissions"],
  request: { body: { content: { "application/json": { schema: GateReleaseRequestSchema } } } },
  responses: {
    200: {
      content: { "application/json": { schema: GateReleaseResponseSchema } },
      description: "Held decision released and applied",
    },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid body" },
    403: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Release from a non-loopback client",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Unknown request id, already released, or prompt no longer pending",
    },
    503: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Runtime unavailable",
    },
  },
})

export const listApprovalGateRoute = createRoute({
  method: "get",
  path: "/permissions/gate/pending",
  tags: ["permissions"],
  responses: {
    200: {
      content: { "application/json": { schema: GatePendingResponseSchema } },
      description: "Held answers and gate counters",
    },
  },
})

export interface ApprovalGateRoutesDeps {
  gate: RemoteApprovalGate
  /** Runtime port — same shape the /answer route receives. */
  runtime?: PermissionAnswerPort
  /** Security audit ledger — a released remote allow is the riskiest
   * authorization action in the system, so it is always recorded. */
  audit?: AuditLedger
}

export function approvalGateRoutes(deps: ApprovalGateRoutesDeps) {
  const { gate, runtime, audit } = deps
  return {
    /** POST /permissions/gate/release — loopback-only two-person-rule step. */
    release: async (c: Context) => {
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return c.json({ error: "invalid_json" }, 400)
      }
      if (!body || typeof body !== "object") {
        return c.json({ error: "body_required" }, 400)
      }
      const requestId = (body as Record<string, unknown>).requestId
      if (typeof requestId !== "string" || requestId.length === 0) {
        return c.json({ error: "requestId_required" }, 400)
      }

      const remoteAddress = requestRemoteAddress(c)
      const result = gate.release(requestId, remoteAddress)
      if (!result.ok) {
        if (result.reason === "remote-release-forbidden") {
          log.warn({ requestId, remoteAddress }, "gate release refused - remote caller")
          return c.json({ error: result.reason, requestId }, 403)
        }
        return c.json({ error: result.reason, requestId }, 404)
      }

      if (!runtime) {
        return c.json({ error: "runtime_unavailable" }, 503)
      }
      const entry: GateEntry = result.entry
      const applied = runtime.resolvePermission(entry.requestId, entry.decision)
      if (!applied) {
        // The prompt settled while gated (timeout / batch answer). The held
        // decision is moot; the runtime already emitted its own outcome.
        return c.json({ error: "unknown_request", requestId }, 404)
      }
      log.info({ requestId, by: remoteAddress ?? "local" }, "remote approval released")
      await audit?.append("approval-gate.released", {
        requestId,
        decision: entry.decision,
        releasedBy: remoteAddress ?? "loopback",
      })
      return c.json({ requestId, decision: entry.decision, gate: "released" })
    },

    /** GET /permissions/gate/pending — dashboards' pending-gate view. */
    pending: async (c: Context) => {
      return c.json({ items: gate.listPending(), snapshot: gate.snapshot() })
    },
  }
}
