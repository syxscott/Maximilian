import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";
import { ErrorSchema } from "../schemas.js";

const ApprovalAnswerRequestSchema = z.object({
  requestId: z.string(),
  decision: z.enum(["approve", "reject"]),
  comment: z.string().optional(),
});

const ApprovalAnswerResponseSchema = z.object({
  requestId: z.string(),
  decision: z.enum(["approve", "reject"]),
  comment: z.string().optional(),
});

export interface ApprovalAnswerPort {
  resolveApproval(requestId: string, response: { decision: "approve" | "reject"; comment?: string }): boolean;
}

export const answerApprovalRoute = createRoute({
  method: "post",
  path: "/approvals/answer",
  tags: ["approvals"],
  request: { body: { content: { "application/json": { schema: ApprovalAnswerRequestSchema } } } },
  responses: {
    200: { content: { "application/json": { schema: ApprovalAnswerResponseSchema } }, description: "Approval decision applied" },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid body" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Unknown request id" },
    503: { content: { "application/json": { schema: ErrorSchema } }, description: "Runtime unavailable" },
  },
});

export function approvalRoutes(deps: { runtime?: ApprovalAnswerPort } = {}) {
  return {
    answer: async (c: Context) => {
      if (!deps.runtime) {
        return c.json({ error: "runtime_unavailable" }, 503);
      }
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "invalid_json" }, 400);
      }
      const parsed = ApprovalAnswerRequestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "invalid_body", details: parsed.error.flatten() }, 400);
      }
      const ok = deps.runtime.resolveApproval(parsed.data.requestId, {
        decision: parsed.data.decision,
        comment: parsed.data.comment,
      });
      if (!ok) {
        return c.json({ error: "unknown_request" }, 404);
      }
      return c.json(parsed.data);
    },
  };
}
