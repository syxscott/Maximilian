// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Feedback form model — pure presentation rules (no network, no React).
 *
 * Borrowing: OpenHands feedback-button validation shape
 * (OpenHands components/features/feedback/feedback-button.tsx): the email is
 * optional, empty/whitespace is valid-anonymous, and a malformed non-empty
 * value blocks submission. Payload normalization itself lives in
 * @max/telemetry (`normalizeContactEmail`) so the privacy boundary has one
 * implementation.
 */

export const FEEDBACK_MESSAGE_MAX_LENGTH = 4000
export const FEEDBACK_EMAIL_MAX_LENGTH = 254

/** Pragmatic email check (the browser's own input validity is the first gate). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Optional-email validity: blank (empty or whitespace) is anonymous-valid;
 * a present value must look like an email and fit the field limit.
 */
export function isValidOptionalEmail(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return true
  if (trimmed.length > FEEDBACK_EMAIL_MAX_LENGTH) return false
  return EMAIL_PATTERN.test(trimmed)
}

/** Whether the form currently holds anything worth preserving as a draft. */
export function hasFeedbackDraft(message: string, email: string): boolean {
  return message.trim().length > 0 || email.trim().length > 0
}
