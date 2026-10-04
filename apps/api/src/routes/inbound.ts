// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Inbound admission queue observability (read-only):
 *
 *   GET /api/inbound/stats — live three-tier counters and depths.
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

const InboundStatsResponseSchema = z.object({ stats: InboundStatsSchema })

export const inboundStatsRoute = createRoute({
  method: "get",
  path: "/inbound/stats",
  tags: ["system"],
  responses: {
    200: {
      content: { "application/json": { schema: InboundStatsResponseSchema } },
      description: "Current admission queue state",
    },
    500: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Internal error",
    },
  },
})

export interface InboundRoutesDeps {
  gate: InboundGate
}

export function inboundRoutes(deps: InboundRoutesDeps) {
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
        },
      })
    },
  }
}
