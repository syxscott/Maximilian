// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Feedback submission service.
 *
 * Borrowing: OpenHands `submitPrivateFeedback`
 * (OpenHands src/services/telemetry.ts:955-999). Two deliberate differences:
 *   - there is no analytics-consent gate here: consent denial must not block
 *     feedback (the upstream implementation checks only hard-disable/DNT);
 *   - the destination is an injected transport rather than a hardcoded
 *     PostHog host, because Maximilian has no mandatory telemetry backend.
 *
 * Survey metadata is resolved before the payload is built; a survey lookup
 * failure propagates and nothing is sent (the provider decides whether to
 * cache failures — the caching wrapper does not).
 */

import { buildFeedbackPayload } from "./payload.js"
import type { FeedbackSurveyProvider } from "./survey.js"
import {
  FeedbackSubmissionError,
  type FeedbackInput,
  type FeedbackSurvey,
  type FeedbackTransport,
} from "./types.js"

export interface SubmitFeedbackOptions {
  /** Required destination. No implicit third-party endpoint. */
  readonly transport: FeedbackTransport
  /** Optional metadata source; consulted when `input.survey` is absent. */
  readonly surveyProvider?: FeedbackSurveyProvider
}

/**
 * Submit one feedback entry. Resolves survey metadata, builds the payload,
 * delivers it, and throws `FeedbackSubmissionError` when the transport did
 * not acknowledge it — the caller keeps the draft so the user can retry.
 */
export async function submitFeedback(
  input: FeedbackInput,
  options: SubmitFeedbackOptions,
): Promise<void> {
  let survey: FeedbackSurvey | undefined = input.survey
  if (!survey && options.surveyProvider) {
    survey = await options.surveyProvider.load()
  }

  const payload = buildFeedbackPayload({ ...input, survey })
  const delivery = await options.transport.deliver(payload)
  if (!delivery.ok) {
    throw new FeedbackSubmissionError(`Feedback delivery failed: ${delivery.reason}`)
  }
}
