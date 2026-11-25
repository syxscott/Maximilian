// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Log-mask layer for persisted runtime events (borrowed from
 * `@max/core/src/log-mask.ts`). This package deliberately has no
 * `@max/core` dependency, so the pattern set is mirrored here instead of
 * imported — keep the two copies in sync when either changes.
 *
 * Applied BEFORE any truncation/slice: cutting first can start a window
 * inside a credential and hide its prefix from the masker (hermes-agent
 * borrowing: "mask before cutting").
 */

const SENSITIVE_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bsk-(?:proj-)?[A-Za-z0-9]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9-]{20,}\b/g,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  /Bearer\s+[A-Za-z0-9_\-.=]{20,}/gi,
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
]

const REPLACEMENT = "[REDACTED]"
const MASKED_FIELD = "***REDACTED***"

const SENSITIVE_FIELD_NAMES = new Set<string>([
  "password",
  "passwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "authorization",
  "access_token",
  "refresh_token",
  "private_key",
  "session_id",
  "sessionid",
  "creditcard",
  "credit_card",
  "ssn",
])

/** Mask pattern-shaped credentials in a single string. */
export function maskSecrets(text: string): string {
  let out = text
  for (const re of SENSITIVE_PATTERNS) {
    re.lastIndex = 0
    out = out.replace(re, REPLACEMENT)
  }
  return out
}

/**
 * Deep-copy `value`, routing every string through `scrub` and masking
 * sensitive object fields by name. Never mutates the input. `scrub`
 * defaults to {@link maskSecrets}; callers holding a Vault pass their own
 * scrubber so exact-match secrets are covered too.
 */
export function maskValueDeep(
  value: unknown,
  scrub: (text: string) => string = maskSecrets,
): unknown {
  if (typeof value === "string") return scrub(value)
  if (Array.isArray(value)) return value.map((v) => maskValueDeep(v, scrub))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_FIELD_NAMES.has(k.toLowerCase()) ? MASKED_FIELD : maskValueDeep(v, scrub)
    }
    return out
  }
  return value
}
