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
 *
 * The request is bounded by a deadline: an endpoint that accepts the socket
 * and never answers would otherwise leave the submitter pending forever
 * (the feedback form stays on "sending" with no error to show).
 */

import type { FeedbackDelivery, FeedbackPayload, FeedbackTransport } from "../types.js"

export interface FetchFeedbackTransportOptions {
  /** Absolute endpoint URL, e.g. https://posthog.example/capture/. */
  readonly endpoint: string
  /** Injectable fetch for tests. Defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch
  /** Extra headers (e.g. authorization for a relay). */
  readonly headers?: Record<string, string>
  /**
   * Abort the delivery after this many milliseconds. Default 10s; pass 0 to
   * disable the deadline.
   */
  readonly timeoutMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export class FetchFeedbackTransport implements FeedbackTransport {
  readonly name = "fetch"

  private readonly endpoint: string
  private readonly fetchImpl: typeof fetch
  private readonly headers: Record<string, string>
  private readonly timeoutMs: number

  constructor(options: FetchFeedbackTransportOptions) {
    this.endpoint = options.endpoint
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.headers = options.headers ?? {}
    this.timeoutMs = options.timeoutMs ?? 10_000
  }

  async deliver(payload: FeedbackPayload): Promise<FeedbackDelivery> {
    const controller = new AbortController()
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    // A promise that rejects when the deadline fires. The race matters: an
    // injected/older fetch may ignore the abort signal, so awaiting it alone
    // would still hang. With timeoutMs <= 0 the promise never settles.
    const deadline: Promise<never> =
      this.timeoutMs > 0
        ? new Promise((_, reject) => {
            timer = setTimeout(() => {
              timedOut = true
              controller.abort()
              reject(new Error("feedback delivery timed out"))
            }, this.timeoutMs)
          })
        : new Promise(() => {})
    const finish = (): void => {
      if (timer !== undefined) clearTimeout(timer)
    }

    let response: Response
    try {
      response = await Promise.race([
        this.fetchImpl(this.endpoint, {
          method: "POST",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          headers: { "Content-Type": "application/json", ...this.headers },
          body: JSON.stringify(payload),
          signal: controller.signal,
        }),
        deadline,
      ])
    } catch {
      finish()
      return { ok: false, reason: timedOut ? "timeout" : "network-error" }
    }

    if (!response.ok) {
      finish()
      return { ok: false, reason: `http-${response.status}` }
    }

    let body: unknown
    try {
      body = await Promise.race([response.json(), deadline])
    } catch {
      finish()
      // A non-JSON 2xx (plain relay) still delivered — unless the deadline
      // cut the body short, which is a failed delivery, not a success.
      return timedOut ? { ok: false, reason: "timeout" } : { ok: true }
    }
    finish()
    if (isRecord(body) && "status" in body && body.status !== "Ok") {
      return { ok: false, reason: "not-acknowledged" }
    }
    return { ok: true }
  }
}
