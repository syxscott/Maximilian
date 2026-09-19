// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * RemoteError — unified cross-boundary error vocabulary
 * (deepseek-harness borrowing: `RemoteError<Code>` with a single
 * declaration point per `<domain>/<reason>` code).
 *
 * Rules (from dsh's remote-failure-vocabulary decision record):
 *  - Every code is declared ONCE, at the lowest common dependency layer of
 *    its producers (shared packages for multi-package codes).
 *  - Discriminate by READING `error.code`, never by instanceof — across
 *    bundle/worker boundaries prototype identity is not guaranteed.
 *  - Codes are `<domain>/<reason>` strings, e.g. `session/writer-held`,
 *    `gateway/cancelled`, `subagent/activation-limit`.
 *
 * Declare new codes with {@link declareRemoteCode} at module load so a
 * duplicate declaration fails loudly, and use {@link isRemoteError} to
 * test both class and code.
 */

export class RemoteError<C extends string = string> extends Error {
  /** `<domain>/<reason>` — the single discriminant. */
  readonly code: C
  /** Structured details; consumers narrow by code. */
  readonly details?: Record<string, unknown>
  /** Marker kept for debugging; discrimination uses `code`, not this. */
  readonly isRemoteError = true as const

  constructor(code: C, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = "RemoteError"
    this.code = code
    this.details = details
  }
}

const declaredCodes = new Set<string>()

/** Declare a remote error code once (duplicate declarations throw at import time). */
export function declareRemoteCode(code: string, owner: string): void {
  if (declaredCodes.has(code)) {
    throw new Error(`remote error code "${code}" already declared (owner: ${owner})`)
  }
  declaredCodes.add(code)
}

/** Test class + code in one predicate. Pass `code` to narrow further. */
export function isRemoteError(err: unknown, code?: string): err is RemoteError {
  const isInstance =
    typeof err === "object" &&
    err !== null &&
    (err as { isRemoteError?: boolean }).isRemoteError === true
  if (!isInstance) return false
  if (code !== undefined) return (err as RemoteError).code === code
  return true
}

// ── Declared codes in use today ─────────────────────────────────────────────

declareRemoteCode("policy/denied", "@max/core policy-error")
declareRemoteCode("subagent/activation-limit", "@max/core activation-pool")
declareRemoteCode("session/writer-held", "@max/session-store")
