// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Scrub-before-truncate for text bound for model context or durable storage
 * (hermes-agent borrowing: `gateway/run_notifications.py`
 * `_build_process_completion_event`, commit 19754b62c1 — "Mask before
 * cutting: a window that starts inside a credential hides its prefix from the
 * masker"; same family as 9031d84322 / 7af7b57688 / f12fc78ca1).
 *
 * REQUIRED ORDER at every call site:
 *
 *     scrubForModelContext(wholeText)  ->  truncate / slice / persist
 *
 * Never cut first. If the truncation window begins inside a secret, the
 * secret's prefix survives the cut and the scrubber can no longer match the
 * whole value, so the prefix leaks into the model context or the database.
 *
 * Two layers, both applied to the FULL text:
 *   1. {@link SecretRedactor.redact} — exact-match secrets a Vault resolved
 *      and registered (`Vault.redact`).
 *   2. `log-mask.maskString` — pattern-based credentials (AWS / GitHub /
 *      OpenAI / Bearer / private keys / SSN / email).
 */

import { maskString } from "./log-mask.js"

/**
 * The vault surface the scrubber needs. `Vault` satisfies it structurally,
 * so callers pass their vault instance directly.
 */
export interface SecretRedactor {
  redact(text: string): string
}

/**
 * Return `text` safe to feed a model or persist: every exact-match vault
 * secret and every pattern-shaped credential is replaced. When no vault is
 * supplied the pattern layer still applies, so callers that cannot reach a
 * vault get the log-mask floor rather than raw text.
 */
export function scrubForModelContext(text: string, vault?: SecretRedactor): string {
  const exact = vault ? vault.redact(text) : text
  return maskString(exact)
}
