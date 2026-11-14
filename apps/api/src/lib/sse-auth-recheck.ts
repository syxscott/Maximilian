// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * SSE stream auth recheck (OpenAgentCore sessions-events.md "Key
 * recheck" borrowing): an open stream checks its ORIGINAL authorization
 * at most once per second while idle and before sending output.
 * Revoking the token closes the stream; so does an authentication
 * failure. Bytes already sent cannot be recalled.
 *
 * This helper mirrors the api's auth ladder exactly (see the
 * `requireAuthMiddleware` wiring in index.ts):
 *   1. JWT_SECRET set   → re-verify the Bearer token with jose
 *   2. ADMIN_TOKEN set  → token equality with the admin token
 *   3. neither          → auth disabled; the stream cannot be revoked,
 *                         recheck always passes
 */

import { verifyAccessToken } from "../auth/jwt.js"

export interface SseAuthRecheckOptions {
  /** The deployment's JWT secret, when JWT auth is enabled. */
  jwtSecret?: string
  /** The deployment's admin bearer token, when simple auth is enabled. */
  adminToken?: string
  /** The ORIGINAL token the stream was opened with. */
  token: string
}

/**
 * Build the recheck predicate for one open SSE connection. Returns an
 * async predicate: true = the original authorization still holds, false =
 * revoked/invalid (the feed closes the stream).
 */
export function sseAuthRecheck(opts: SseAuthRecheckOptions): () => Promise<boolean> {
  // Path 1: JWT auth (same priority as requireAuthMiddleware).
  if (opts.jwtSecret) {
    const secret = opts.jwtSecret
    return async () => {
      try {
        await verifyAccessToken(opts.token, secret)
        return true
      } catch {
        return false
      }
    }
  }
  // Path 2: simple ADMIN_TOKEN bearer check.
  if (opts.adminToken) {
    const adminToken = opts.adminToken
    return async () => opts.token === adminToken
  }
  // Path 3: dev mode — auth is disabled, nothing to revoke.
  return async () => true
}
