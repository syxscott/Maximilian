// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Privacy-friendly in-product feedback submission types.
 *
 * Borrowing: OpenHands `submitPrivateFeedback`
 * (OpenHands src/services/telemetry.ts:955-999) — feedback must not depend
 * on analytics consent, must use a fresh random distinct_id per submission,
 * and must never attach a real ip or current_url. The PostHog capture shape
 * is kept so a self-hosted deployment can point the fetch transport at a
 * PostHog `/capture/` endpoint without a mapping layer.
 */

/** Survey metadata attached to a submission (optional). */
export interface FeedbackSurvey {
  readonly id: string
  readonly question: string
}

/** Transport delivery outcome. A false `ok` is a failed submission. */
export type FeedbackDelivery =
  { readonly ok: true } | { readonly ok: false; readonly reason: string }

/**
 * Injection point for where feedback goes. Keeping this an interface is the
 * honest boundary: Maximilian ships no mandatory third-party endpoint, so a
 * host supplies a file writer, a fetch endpoint, or its own sink.
 */
export interface FeedbackTransport {
  /** Stable transport name for diagnostics. */
  readonly name: string
  deliver(payload: FeedbackPayload): Promise<FeedbackDelivery>
}

export interface FeedbackSurveyQuestion {
  readonly id: string
  readonly question: string
}

export interface FeedbackPayloadProperties {
  readonly $survey_id?: string
  readonly $survey_questions?: ReadonlyArray<FeedbackSurveyQuestion>
  readonly $survey_response: string
  readonly $survey_completed: true
  /** Opt out of person-profile processing even when a provider supports it. */
  readonly $process_person_profile: false
  readonly feedback_source: string
  /** Omitted entirely for anonymous submissions (empty/whitespace email). */
  readonly feedback_email?: string
}

/**
 * Capture-shaped payload. `ip: false` tells PostHog not to capture an IP;
 * `$current_url` is deliberately never present.
 */
export interface FeedbackPayload {
  readonly event: "survey sent"
  readonly distinct_id: string
  readonly properties: FeedbackPayloadProperties
  readonly ip: false
}

/** Caller-supplied feedback; transport/survey are resolved by the service. */
export interface FeedbackInput {
  readonly message: string
  readonly email?: string
  readonly source: string
  /** Explicit survey metadata; skips the configured survey provider. */
  readonly survey?: FeedbackSurvey
}

/** Thrown when a transport reports the submission was not delivered. */
export class FeedbackSubmissionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "FeedbackSubmissionError"
  }
}

/** Thrown when a feedback channel is requested but not configured. */
export class FeedbackChannelNotConfiguredError extends Error {
  constructor(message = "Feedback channel is not configured") {
    super(message)
    this.name = "FeedbackChannelNotConfiguredError"
  }
}
