// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Outbound error redaction (minimax-code 9a93560 borrowing — the upstream
 * implementation lives in
 * packages/local-runtime-v2/src/service/model-system/connectivity/
 * test-connection.ts `redactConnectionTestError`).
 *
 * Provider errors are surfaced to clients, logs and dashboards. Error
 * bodies and messages sometimes echo the caller's own credentials back —
 * an auth failure repeats the Authorization header, a misconfigured base
 * URL leaks the key inside the URL. Anything sent OUT of the process
 * (client responses, remote telemetry) must scrub those first, otherwise
 * the error path becomes a secret-exfiltration path.
 *
 * Pipeline, mirroring the upstream semantics exactly:
 *   1. fold whitespace (error text often arrives multi-line),
 *   2. replace each caller secret with `***` — LONGEST FIRST, so two
 *      secrets where one is a prefix of the other cannot leave a partial
 *      residue of the longer one behind,
 *   3. three generic regex groups for credentials the caller did not list:
 *      sk-prefixed keys, Bearer tokens (bare and in Authorization
 *      headers), api-key / x-api-key header values,
 *   4. truncate to a sane length so a hostile error body cannot balloon
 *      the outbound payload.
 *
 * This module is intentionally self-contained: providers must not depend
 * on @max/evolution's secret-scrub, and the regex set here is the narrower
 * outbound-focused one from the upstream helper (not the 15+ persist-time
 * pattern set).
 */

/** Upper bound for the redacted message (upstream MAX_UPSTREAM_ERROR_CHARS). */
const MAX_REDACTED_ERROR_CHARS = 1_200

/** Secrets shorter than this are too generic to safely blind-replace. */
const MIN_SECRET_LENGTH = 4

/**
 * Redact credentials from an error message before it leaves the process.
 *
 * @param message - the raw error text (any provider/transport origin)
 * @param secrets - the caller's credential values (API keys, header
 *   values); each is replaced verbatim with `***`. Entries shorter than 4
 *   characters are ignored (blind-replacing tiny strings corrupts text
 *   without protecting anything).
 * @returns the scrubbed, whitespace-folded, truncated message. Never
 *   returns the input unmodified-unsanitized: even with an empty secrets
 *   list the generic regex groups still run.
 */
export function redactOutboundError(message: string, secrets: string[]): string {
  // 1. Fold whitespace first (upstream: `\s+ → single space, trim`).
  let out = message.replace(/\s+/gu, " ").trim()

  // 2. Caller-provided secrets, longest first (upstream ordering): if one
  //    secret is a prefix of another, replacing the shorter one first would
  //    leave the longer secret's residue in the output.
  const sorted = [...secrets]
    .map((secret) => secret.trim())
    .filter((secret) => secret.length >= MIN_SECRET_LENGTH)
    .sort((left, right) => right.length - left.length)
  for (const secret of sorted) {
    // split/join instead of a RegExp: secrets may contain regex metachars.
    out = out.split(secret).join("***")
  }

  // 3. Generic credential patterns (upstream regex set).
  out = out
    .replace(/\bsk-[A-Za-z0-9._-]{8,}\b/gu, "sk-***")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"',}]+/giu, "$1***")
    .replace(/((?:api[_-]?key|x-api-key)\s*[:=]\s*)[^\s"',}]+/giu, "$1***")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/giu, "$1***")

  // 4. Truncate to the upstream bound.
  return out.slice(0, MAX_REDACTED_ERROR_CHARS).trim()
}
