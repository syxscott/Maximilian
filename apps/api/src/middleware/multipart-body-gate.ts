// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Multipart request-body gate (cc-switch read_request_body_limited borrowing).
 *
 * `POST /sessions/restore` accepts a ZIP archive that can legitimately be
 * tens of megabytes, so this gate uses its own, larger cap (default 128 MiB)
 * instead of reusing the JSON gate's 512 KiB. Mounted globally on `/api/*`
 * so every multipart endpoint is bounded; the body itself is left untouched
 * for Hono's validator and the route handler.
 */

import type { Context, Next } from "hono"
import {
  DEFAULT_MULTIPART_BODY_MAX_BYTES,
  payloadTooLargeResponse,
  requestBodyExceedsByteLimit,
  type BodyLimitOptions,
} from "../lib/request-body-limit.js"

export interface MultipartBodyGateOptions extends BodyLimitOptions {
  /** Extra paths exempt from the cap (matched against the request path). */
  exempt?: (path: string) => boolean
}

export function multipartBodyGate(opts: MultipartBodyGateOptions = {}) {
  const maxBytes = opts.maxBytes ?? DEFAULT_MULTIPART_BODY_MAX_BYTES
  return async (c: Context, next: Next) => {
    if (opts.exempt?.(c.req.path)) return next()
    const contentType = (c.req.header("content-type") ?? "").toLowerCase()
    if (!contentType.includes("multipart/form-data")) return next()

    if (await requestBodyExceedsByteLimit(c.req.raw, maxBytes)) {
      return payloadTooLargeResponse(c, maxBytes)
    }
    await next()
  }
}
