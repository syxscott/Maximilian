// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Bounded response reader for webhook delivery (cc-switch
 * usage_script.rs::read_response_text_limited borrowing).
 *
 * A customer-supplied webhook endpoint can answer with an unbounded body;
 * without a cap that body is buffered in full, so one malicious target can
 * OOM the API process. The reader stops at the first byte past the limit,
 * cancels the underlying stream, and reports a typed error the caller can
 * distinguish from a network failure.
 */

/** Default 1 MiB cap — generous for an acknowledgement body. */
export const DEFAULT_WEBHOOK_RESPONSE_MAX_BYTES = 1024 * 1024

export class WebhookResponseTooLargeError extends Error {
  readonly maxBytes: number

  constructor(maxBytes: number) {
    super(`webhook response exceeds ${maxBytes} bytes`)
    this.name = "WebhookResponseTooLargeError"
    this.maxBytes = maxBytes
  }
}

/**
 * Read `response` as text, aborting once more than `maxBytes` bytes have
 * been received. Exactly `maxBytes` bytes is allowed. The response body is
 * cancelled on overflow (and on unexpected read errors) so the socket is
 * released instead of being drained to completion.
 */
export async function readResponseTextLimited(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) return ""

  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared >= 0 && declared > maxBytes) {
    throw new WebhookResponseTooLargeError(maxBytes)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let text = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) {
        throw new WebhookResponseTooLargeError(maxBytes)
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } catch (error) {
    // Always release the stream: on overflow we must not drain the rest of a
    // hostile body, and on a transport failure the socket is otherwise held.
    await reader.cancel().catch(() => {})
    throw error
  }
}
