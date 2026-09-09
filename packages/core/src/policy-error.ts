// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * PolicyDeniedError — deny ≠ failure (crewAI borrowing, commits e9d4c57b2
 * + OSS-149/151): a governance rejection (permission denied, capability
 * gate, budget cap) is a *policy outcome*, not a provider or model fault.
 * crewAI fixed exactly this: a hook `deny` used to be swallowed by a broad
 * `except Exception` and misreported as a provider failure, feeding the
 * retry loop and polluting failure analytics.
 *
 * In Maximilian the same distinction matters downstream: the evolution and
 * autonomy layers learn from task failures — if a governance rejection is
 * recorded as a failure mode, the system "learns" to avoid work that a
 * human deliberately blocked. So a policy denial:
 *   - carries its policy + reason structurally (not just a string),
 *   - classifies as non-retryable, non-fallback (`policy_denied`),
 *   - is excluded from failure-memory / failure-pattern learning.
 */

/** Stable string prefix so cross-package error strings stay recognizable. */
export const POLICY_DENIED_PREFIX = "POLICY_DENIED:"

export class PolicyDeniedError extends Error {
  /** Which policy rejected the action, e.g. "permission:write", "governance:capability-cap". */
  readonly policy: string
  /** Human-readable reason from the denying authority. */
  readonly detail: string

  constructor(policy: string, detail: string) {
    super(`${POLICY_DENIED_PREFIX}${policy} — ${detail}`)
    this.name = "PolicyDeniedError"
    this.policy = policy
    this.detail = detail
  }
}

export function isPolicyDeniedError(err: unknown): err is PolicyDeniedError {
  return err instanceof PolicyDeniedError
}

/** Recognize policy denials that crossed a serialization boundary. */
export function isPolicyDeniedMessage(message: string | undefined | null): boolean {
  if (!message) return false
  return (
    message.startsWith(POLICY_DENIED_PREFIX) ||
    // Matches both producers: with-permission's "Permission denied: <tool> ->
    // <target>" AND tool-integration's interactive-deny path, which emits the
    // colon-less "Permission denied for tool \"<tool>\"" (previously missed).
    /^permission denied\b/i.test(message) ||
    /^Permission required:/i.test(message)
  )
}
