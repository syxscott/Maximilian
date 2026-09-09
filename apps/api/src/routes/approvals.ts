import { createRoute } from "@hono/zod-openapi"
import type { Context } from "hono"
import { z } from "zod"
import { ErrorSchema } from "../schemas.js"

const ApprovalAnswerRequestSchema = z.object({
  requestId: z.string(),
  decision: z.enum(["approve", "reject"]),
  comment: z.string().optional(),
})

const ApprovalAnswerResponseSchema = z.object({
  requestId: z.string(),
  decision: z.enum(["approve", "reject"]),
  comment: z.string().optional(),
})

export type ApprovalResolveOutcome =
  { ok: true } | { ok: false; reason: "unknown" | "comment_required" }

export interface ApprovalAnswerPort {
  resolveApproval(
    requestId: string,
    response: { decision: "approve" | "reject"; comment?: string },
  ): ApprovalResolveOutcome
  /**
   * Look up a pending approval's metadata (workspaceId) without resolving
   * it. Used by the route for tenant isolation: verifies the caller's
   * tenantId matches the workspace that owns the pending approval, so
   * tenant B can't approve/reject tenant A's tasks.
   */
  getPendingApproval?(requestId: string): {
    workspaceId: string
    taskId: string
    prompt: string
    requireComment: boolean
    reason?: string
    promptedAt: string
  }
}

export const answerApprovalRoute = createRoute({
  method: "post",
  path: "/approvals/answer",
  tags: ["approvals"],
  request: { body: { content: { "application/json": { schema: ApprovalAnswerRequestSchema } } } },
  responses: {
    200: {
      content: { "application/json": { schema: ApprovalAnswerResponseSchema } },
      description: "Approval decision applied",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Invalid body or missing comment",
    },
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

export function approvalRoutes(
  deps: {
    runtime?: ApprovalAnswerPort
    /**
     * Tenant isolation check: returns true if `workspaceId` belongs to
     * `tenantId` (or is unowned and tenantId is undefined - dev mode).
     * The /answer route calls this before resolving a pending approval so
     * tenant B can't approve tenant A's tasks. When omitted, the route
     * skips the check (backward compatible with tests).
     */
    checkWorkspaceTenant?: (workspaceId: string, tenantId: string | undefined) => Promise<boolean>
  } = {},
) {
  return {
    answer: async (c: Context) => {
      if (!deps.runtime) {
        return c.json({ error: "runtime_unavailable" }, 503)
      }
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return c.json({ error: "invalid_json" }, 400)
      }
      const parsed = ApprovalAnswerRequestSchema.safeParse(body)
      if (!parsed.success) {
        return c.json({ error: "invalid_body", details: parsed.error.flatten() }, 400)
      }

      // Tenant isolation: before resolving, verify the caller's
      // tenantId matches the workspace that owns this pending approval.
      // Without this, tenant B could approve/reject tenant A's tasks
      // just by guessing the requestId.
      if (deps.runtime.getPendingApproval && deps.checkWorkspaceTenant) {
        const pending = deps.runtime.getPendingApproval(parsed.data.requestId)
        if (pending) {
          const callerTenantId = (c as any).get("tenantId") as string | undefined
          const allowed = await deps.checkWorkspaceTenant(pending.workspaceId, callerTenantId)
          if (!allowed) {
            return c.json({ error: "forbidden" }, 403)
          }
        }
      }

      const outcome = deps.runtime.resolveApproval(parsed.data.requestId, {
        decision: parsed.data.decision,
        comment: parsed.data.comment,
      })
      if (outcome.ok) return c.json(parsed.data)
      if (outcome.reason === "comment_required") {
        return c.json({ error: "comment_required" }, 400)
      }
      return c.json({ error: "unknown_request" }, 404)
    },
  }
}
