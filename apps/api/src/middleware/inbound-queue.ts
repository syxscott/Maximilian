// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Hono wiring for the three-tier inbound admission queue. Admits the
 * request before the route handler runs, releases the slot when it
 * finishes (success, error, or early response), and answers dead-letter
 * admissions with a structured 503 carrying the live snapshot.
 */

import type { Context, Next } from "hono"
import { InboundOverflowError, type InboundGate } from "../lib/inbound-queue.js"

/** Probe endpoints that must answer even at full load. */
const EXEMPT_SUFFIXES = ["/health", "/ready", "/metrics", "/openapi.json", "/docs"]

export interface InboundAdmissionOptions {
  gate: InboundGate
  /** Extra exemption predicate (matched against the request path). */
  exempt?: (path: string) => boolean
}

export function inboundAdmission(opts: InboundAdmissionOptions) {
  const exempt = (path: string): boolean =>
    EXEMPT_SUFFIXES.some((suffix) => path.endsWith(suffix)) || (opts.exempt?.(path) ?? false)
  return async (c: Context, next: Next) => {
    if (exempt(c.req.path)) return next()
    try {
      await opts.gate.acquire()
    } catch (err) {
      if (err instanceof InboundOverflowError) {
        c.header("Retry-After", "1")
        return c.json(
          {
            error: "inbound_overflow",
            message: "server at capacity - request dead-lettered by the inbound admission queue",
            snapshot: err.snapshot,
          },
          503,
        )
      }
      throw err
    }
    try {
      return await next()
    } finally {
      opts.gate.release()
    }
  }
}
