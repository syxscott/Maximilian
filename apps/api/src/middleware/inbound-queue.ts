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
import {
  classifyFailureStatus,
  classifyInboundFailure,
  type DeadLetterRegistry,
  type FailureClassification,
} from "../lib/inbound-dead-letter.js"

/** Probe endpoints that must answer even at full load. */
const EXEMPT_SUFFIXES = ["/health", "/ready", "/metrics", "/openapi.json", "/docs"]

export interface InboundAdmissionOptions {
  gate: InboundGate
  /** Extra exemption predicate (matched against the request path). */
  exempt?: (path: string) => boolean
  /**
   * Dead-letter layer (openclaw ingress borrowing). When wired, an outcome
   * classified NON-retryable (structurally invalid request — 400/404/405/
   * 409/413/415/422 — or authentication failure — 401/403) is
   * dead-lettered immediately; retrying it would only burn budget.
   * Retryable outcomes (5xx, 429) are left to the caller's retry policy.
   * Failures are observed both on the response status (Hono routes errors
   * to its own error handler, so middleware sees the 4xx/5xx Response) and
   * on thrown errors for adapters without one.
   */
  deadLetter?: { registry: DeadLetterRegistry }
}

export function inboundAdmission(opts: InboundAdmissionOptions) {
  const exempt = (path: string): boolean =>
    EXEMPT_SUFFIXES.some((suffix) => path.endsWith(suffix)) || (opts.exempt?.(path) ?? false)
  const recordNonRetryable = (
    registry: DeadLetterRegistry,
    classification: FailureClassification,
    message: string,
    receivedAt: number,
  ) => {
    registry.record({
      cause: "non-retryable",
      attempts: 1,
      receivedAt,
      message,
      classification,
    })
  }
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
    const receivedAt = Date.now()
    try {
      // next() resolves void in Hono v4 — the outcome is c.res (or a throw
      // for adapters/handlers that propagate errors).
      await next()
      const registry = opts.deadLetter?.registry
      const status = c.res?.status
      if (registry !== undefined && typeof status === "number" && status >= 400) {
        const classification = classifyFailureStatus(status)
        if (!classification.retryable) {
          recordNonRetryable(registry, classification, `response ${status}`, receivedAt)
        }
      }
    } catch (err) {
      const registry = opts.deadLetter?.registry
      if (registry !== undefined) {
        const classification = classifyInboundFailure(err)
        if (!classification.retryable) {
          recordNonRetryable(
            registry,
            classification,
            err instanceof Error ? err.message : String(err),
            receivedAt,
          )
        }
      }
      throw err
    } finally {
      opts.gate.release()
    }
  }
}
