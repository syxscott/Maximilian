// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Hono wiring for the Idempotency-Key receipt layer
 * (OpenAgentCore wire-semantics.md "Creation retries" borrowing):
 *
 *   - Send an `Idempotency-Key` of 1–256 bytes; a longer key returns 400.
 *     An empty header counts as no key.
 *   - Same key + same body  → the ORIGINAL result is replayed (2xx JSON
 *     responses are stored; `Idempotency-Replayed: true` marks the replay).
 *   - Same key + different body → 409 { error: "idempotency_conflict" }.
 *
 * The receipt stores the hash of the PARSED body (canonicalized), so
 * whitespace and key-order differences are not conflicts. Receipts are
 * recorded only after a SUCCESSFUL (2xx JSON) response — a failed request
 * is retryable by nature and is never stored.
 *
 * Scope note: receipts are keyed by `${method} ${path} ${key}`. Auth runs
 * per-route AFTER this middleware in this server, so keys are not
 * identity-scoped yet (wire-semantics scopes keys per Project) — the
 * bounded store and the body-hash equality check are the poison/
 * cross-collision mitigations until receipts move behind auth.
 */

import type { Context, Next } from "hono"
import {
  IDEMPOTENCY_KEY_MAX_BYTES,
  hashRequestBody,
  type IdempotencyReceiptStore,
} from "../lib/inbound-queue.js"

export interface IdempotencyKeyOptions {
  store: IdempotencyReceiptStore
  /** Methods that carry a body and are made idempotent. Default ["POST"]. */
  methods?: readonly string[]
}

export function idempotencyKey(opts: IdempotencyKeyOptions) {
  const methods = opts.methods ?? ["POST"]
  return async (c: Context, next: Next) => {
    const rawKey = c.req.header("Idempotency-Key")
    // An empty header counts as no key (wire-semantics.md).
    if (!rawKey || rawKey.trim() === "") return next()
    // The wire contract caps the key at 256 bytes; longer keys are an
    // invalid request, not a new namespace.
    if (new TextEncoder().encode(rawKey).length > IDEMPOTENCY_KEY_MAX_BYTES) {
      return c.json(
        {
          error: "invalid_request",
          message: `Idempotency-Key must be 1-${IDEMPOTENCY_KEY_MAX_BYTES} bytes`,
        },
        400,
      )
    }
    if (!methods.includes(c.req.method)) return next()

    const scopedKey = `${c.req.method} ${c.req.path}::${rawKey}`
    let bodyText = ""
    try {
      // c.req.text() caches the raw body (Hono bodyCache) — downstream
      // c.req.json() in the route validators reads the same bytes.
      bodyText = await c.req.text()
    } catch {
      bodyText = ""
    }
    const bodyHash = await hashRequestBody(bodyText)

    const existing = opts.store.get(scopedKey)
    if (existing) {
      if (existing.bodyHash !== bodyHash) {
        // Same key, different request — the ledger would fork: refuse.
        return c.json({ error: "idempotency_conflict" }, 409)
      }
      // Same key, same request: replay the original result verbatim.
      // (Status came from a Hono response, so it is a valid code; the
      // widening to number happened in the receipt record.)
      const status = existing.status as 200
      return c.newResponse(JSON.stringify(existing.body ?? null), status, {
        "content-type": "application/json",
        "Idempotency-Replayed": "true",
      })
    }

    await next()

    // Record only successful JSON responses — the replayable result.
    const status = c.res?.status ?? 0
    if (status < 200 || status >= 300) return
    const contentType = c.res?.headers.get("content-type") ?? ""
    if (!contentType.includes("application/json")) return
    try {
      const body = await c.res.clone().json()
      opts.store.record(scopedKey, { bodyHash, status, body })
    } catch {
      // Unreadable body — nothing replayable to store.
    }
  }
}
