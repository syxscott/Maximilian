// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Inbound admission queue observability (read-only):
 *
 *   GET /api/inbound/stats        — live three-tier counters and depths,
 *                                   plus the dead-letter layer counters.
 *   GET /api/inbound/dead-letter  — retained dead-letter entries (bounded,
 *                                   oldest first) for ops inspection.
 *
 * Mounted under the same auth middleware as the rest of /api/*; operational
 * callers that cannot authenticate should scrape the snapshot from the
 * overflow 503 bodies instead.
 */

import { createRoute } from "@hono/zod-openapi"
import type { Context } from "hono"
import { z } from "zod"
import { ErrorSchema } from "../schemas.js"
import type { InboundGate } from "../lib/inbound-queue.js"
import type { DeadLetterRegistry } from "../lib/inbound-dead-letter.js"

const InboundStatsSchema = z.object({
  inFlight: z.number(),
  queuedDepth: z.number(),
  maxInFlight: z.number(),
  maxQueued: z.number(),
  counters: z.object({
    immediate: z.number(),
    queued: z.number(),
    deadLetter: z.number(),
  }),
})

export const DeadLetterSnapshotSchema = z.object({
  /** Entries judged dead — non-retryable or retry-exhausted. */
  deadLettered: z.number(),
  /** Subset that failed the non-retryable classifier. */
  nonRetryable: z.number(),
  /** Oldest entries evicted by the retention cap. */
  evicted: z.number(),
  /** Entries removed by the periodic prune. */
  pruned: z.number(),
  size: z.number(),
  retentionCap: z.number(),
})

const DeadLetterEntrySchema = z.object({
  id: z.string(),
  cause: z.enum(["non-retryable", "retry-limit-exceeded"]),
  reason: z.string(),
  message: z.string(),
  attempts: z.number().int(),
  receivedAt: z.string(),
  deadLetteredAt: z.string(),
})

const InboundStatsResponseSchema = z.object({
  stats: InboundStatsSchema.extend({ deadLetter: DeadLetterSnapshotSchema }),
})

const DeadLetterListResponseSchema = z.object({
  items: z.array(DeadLetterEntrySchema),
  snapshot: DeadLetterSnapshotSchema,
})

export const inboundStatsRoute = createRoute({
  method: "get",
  path: "/inbound/stats",
  tags: ["system"],
  responses: {
    200: {
      content: { "application/json": { schema: InboundStatsResponseSchema } },
      description: "Current admission queue state and dead-letter counters",
    },
    500: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Internal error",
    },
  },
})

export const InboundDeadLetterQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
})

export const inboundDeadLetterRoute = createRoute({
  method: "get",
  path: "/inbound/dead-letter",
  tags: ["system"],
  request: { query: InboundDeadLetterQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: DeadLetterListResponseSchema } },
      description: "Retained dead-letter entries, oldest first",
    },
    500: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Internal error",
    },
  },
})

export interface InboundRoutesDeps {
  gate: InboundGate
  /** Dead-letter layer; when omitted the response sections report zeros. */
  deadLetter?: DeadLetterRegistry
}

export function inboundRoutes(deps: InboundRoutesDeps) {
  const deadLetterSnapshot = () =>
    deps.deadLetter?.snapshot() ?? {
      deadLettered: 0,
      nonRetryable: 0,
      evicted: 0,
      pruned: 0,
      size: 0,
      retentionCap: 0,
    }
  return {
    stats: async (c: Context) => {
      const snap = deps.gate.snapshot()
      return c.json({
        stats: {
          inFlight: snap.inFlight,
          queuedDepth: snap.queuedDepth,
          maxInFlight: snap.maxInFlight,
          maxQueued: snap.maxQueued,
          counters: {
            immediate: snap.immediate,
            queued: snap.queued,
            deadLetter: snap.deadLetter,
          },
          deadLetter: deadLetterSnapshot(),
        },
      })
    },
    deadLetter: async (c: Context) => {
      // Parse via the same schema the OpenAPI declaration uses, so the
      // handler also works when mounted without the zod-openapi validator
      // (mini-app tests, alternate adapters).
      const parsed = InboundDeadLetterQuerySchema.safeParse(c.req.query())
      const limit = parsed.success ? parsed.data.limit : undefined
      if (!deps.deadLetter) {
        return c.json({ items: [], snapshot: deadLetterSnapshot() })
      }
      return c.json({
        items: deps.deadLetter.list(limit),
        snapshot: deadLetterSnapshot(),
      })
    },
  }
}
