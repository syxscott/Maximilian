// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Feedback payload construction — the privacy boundary.
 *
 * Borrowing: OpenHands `submitPrivateFeedback`
 * (OpenHands src/services/telemetry.ts:955-999):
 *   - distinct_id is a fresh random UUID every call (never an email);
 *   - `$process_person_profile: false`;
 *   - `ip: false` and no `$current_url`;
 *   - a whitespace-only optional email is anonymous (field omitted).
 */

import { randomUuid } from "./uuid.js"
import type { FeedbackInput, FeedbackPayload, FeedbackPayloadProperties } from "./types.js"

/** Trim an optional contact email; empty/whitespace becomes undefined. */
export function normalizeContactEmail(email: string | undefined): string | undefined {
  if (typeof email !== "string") return undefined
  const trimmed = email.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Build the capture-shaped payload for one submission. */
export function buildFeedbackPayload(input: FeedbackInput): FeedbackPayload {
  const message = input.message.trim()
  const contactEmail = normalizeContactEmail(input.email)

  const properties: FeedbackPayloadProperties = {
    $survey_response: message,
    $survey_completed: true,
    $process_person_profile: false,
    feedback_source: input.source,
    ...(input.survey
      ? {
          $survey_id: input.survey.id,
          $survey_questions: [{ id: input.survey.id, question: input.survey.question }],
        }
      : {}),
    ...(contactEmail ? { feedback_email: contactEmail } : {}),
  }

  return {
    event: "survey sent",
    distinct_id: randomUuid(),
    properties,
    ip: false,
  }
}
