// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Fetch transport — injectable endpoint for self-hosted deployments.
 *
 * Borrowing: OpenHands `submitPrivateFeedback`
 * (OpenHands src/services/telemetry.ts:975-997): credentials omitted, no
 * referrer, JSON body. A 2xx response whose JSON carries a `status` other
 * than `"Ok"` is treated as a failed capture rather than silently counted.
 */

import type { FeedbackDelivery, FeedbackPayload, FeedbackTransport } from "../types.js"

export interface FetchFeedbackTransportOptions {
  /** Absolute endpoint URL, e.g. https://posthog.example/capture/. */
  readonly endpoint: string
  /** Injectable fetch for tests. Defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch
  /** Extra headers (e.g. authorization for a relay). */
  readonly headers?: Record<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export class FetchFeedbackTransport implements FeedbackTransport {
  readonly name = "fetch"

  private readonly endpoint: string
  private readonly fetchImpl: typeof fetch
  private readonly headers: Record<string, string>

  constructor(options: FetchFeedbackTransportOptions) {
    this.endpoint = options.endpoint
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.headers = options.headers ?? {}
  }

  async deliver(payload: FeedbackPayload): Promise<FeedbackDelivery> {
    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json", ...this.headers },
        body: JSON.stringify(payload),
      })
    } catch {
      return { ok: false, reason: "network-error" }
    }

    if (!response.ok) {
      return { ok: false, reason: `http-${response.status}` }
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      // A non-JSON 2xx (plain relay) still delivered.
      return { ok: true }
    }
    if (isRecord(body) && "status" in body && body.status !== "Ok") {
      return { ok: false, reason: "not-acknowledged" }
    }
    return { ok: true }
  }
}
