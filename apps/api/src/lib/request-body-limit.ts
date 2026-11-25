// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Request-body byte gates (cc-switch proxy/handlers.rs::read_request_body_limited
 * borrowing): one shared, byte-exact limit helper for the JSON gate and the
 * multipart upload gate.
 *
 * `Content-Length` is a free fast path. When it is absent (chunked
 * transfer-encoding) we cannot know the size before reading, so the helper
 * drains a `clone()` of the body — the original stream stays readable by the
 * downstream route validator (the tee keeps both branches), while our drain
 * stops at `maxBytes + 1`. Exactly `maxBytes` bytes passes.
 */

import type { Context } from "hono"

/** Default JSON body cap (512 KiB). */
export const DEFAULT_JSON_BODY_MAX_BYTES = 512 * 1024

/** Default multipart upload cap (128 MiB) — session archives are large. */
export const DEFAULT_MULTIPART_BODY_MAX_BYTES = 128 * 1024 * 1024

/** Stable wire text for both gates. */
export const PAYLOAD_TOO_LARGE_MESSAGE = "Request body exceeds the maximum allowed size"

export interface BodyLimitOptions {
  /** Byte cap; exactly this many bytes is accepted. */
  maxBytes?: number
}

const encoder = new TextEncoder()

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength
}

/**
 * 413 with a stable `{ error, message, maxBytes }` payload. Shared by the
 * JSON and multipart gates so clients see one shape for both.
 */
export function payloadTooLargeResponse(c: Context, maxBytes: number): Response {
  return c.json(
    {
      error: "payload_too_large",
      message: PAYLOAD_TOO_LARGE_MESSAGE,
      maxBytes,
    },
    413,
  )
}

/**
 * True when `request` carries more than `maxBytes` body bytes. Never throws:
 * an unreadable/locked body (already consumed by another middleware) is left
 * to the route to handle, matching the existing gates' fail-open posture.
 */
export async function requestBodyExceedsByteLimit(
  request: Request,
  maxBytes: number,
): Promise<boolean> {
  const declared = request.headers.get("content-length")
  if (declared !== null && declared.trim() !== "") {
    const length = Number(declared)
    if (Number.isFinite(length) && length >= 0) {
      return length > maxBytes
    }
    // Malformed Content-Length: fall through to the streaming check.
  }

  let cloned: Request
  try {
    // A tee: the clone's branch is drained here, the original remains the
    // body Hono's validator reads downstream.
    cloned = request.clone()
  } catch {
    return false
  }
  if (!cloned.body) return false

  const reader = cloned.body.getReader()
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) {
        // Do NOT await `reader.cancel()` here: the clone is one branch of a
        // tee whose other branch (the original request body) is still
        // unread, and undici's cancel waits on that branch. Abandoning the
        // reader is safe — the tee applies backpressure once both branch
        // queues fill, so a hostile chunked upload cannot buffer without
        // bound; the rejected response completes without draining it.
        return true
      }
    }
    return false
  } catch {
    return false
  }
}
