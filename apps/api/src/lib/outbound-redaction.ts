// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Outbound error redaction wiring (minimax-code 9a93560 borrowing).
 *
 * Provider SDK failures (an OpenAI 401, for example) echo the API key
 * back in `err.message`. Every place that pushes a provider error OUT
 * of the process — the test-chat probe response, the jobs
 * `dispatch-failed` event stream — must pass the message through the
 * redactor with THIS request's secrets before it leaves the process.
 *
 * Contract (pinned by @max/providers, implemented there in redact.ts):
 *   redactOutboundError(message: string, secrets: string[]): string
 * The implementation is NOT copied into the api package — call sites
 * inject `redactOutboundMessage` (defaults to the providers export) so
 * tests can observe the secret set each call site passes.
 */

import { redactOutboundError, PROVIDER_PRESETS, type ProviderPreset } from "@max/providers"

export type OutboundRedactor = (message: string, secrets: string[]) => string

/** The pinned @max/providers implementation — the default redactor. */
export const defaultOutboundRedactor: OutboundRedactor = redactOutboundError

/**
 * Redact one outbound error message before it leaves the process.
 * `redactor` is injectable for tests; the default is the @max/providers
 * contract implementation.
 */
export function redactOutboundMessage(
  message: string,
  secrets: string[],
  redactor: OutboundRedactor = defaultOutboundRedactor,
): string {
  return redactor(message, secrets)
}

/**
 * Header names whose VALUES count as secrets for outbound redaction.
 * Matched case-insensitively; the bare-word alternates catch custom
 * `x-*-key` / `x-*-token` style headers.
 */
const SECRET_HEADER_PATTERN =
  /^(authorization|proxy-authorization|x-api-key|x-auth-token|x-access-token)$|key|token|secret|credential/i

/**
 * Collect secret-looking values from THIS request's headers
 * (Authorization bearer tokens, custom key/token headers). Values shorter
 * than 8 chars are ignored — they cannot be meaningful credentials and
 * would over-redact ordinary error text.
 */
export function collectHeaderSecrets(headers: Headers): string[] {
  const secrets: string[] = []
  headers.forEach((value, name) => {
    if (!SECRET_HEADER_PATTERN.test(name)) return
    for (const piece of value.split(",")) {
      const token = piece.trim()
      const bearer = token.toLowerCase().startsWith("bearer ") ? token.slice(7).trim() : token
      for (const candidate of [token, bearer]) {
        if (candidate.length >= 8 && !secrets.includes(candidate)) secrets.push(candidate)
      }
    }
  })
  return secrets
}

/**
 * Collect the provider API keys available to this process from the
 * preset table (env-only key contract — the registry never stores keys).
 * With `providerId`, only that provider's key is returned; without, every
 * configured provider's key (used by background paths with no request
 * context, like the jobs dispatch-failed event).
 */
export function collectProviderSecrets(providerId?: string): string[] {
  const presets =
    providerId !== undefined
      ? PROVIDER_PRESETS.filter((p: ProviderPreset) => p.id === providerId)
      : PROVIDER_PRESETS
  const secrets: string[] = []
  for (const preset of presets) {
    const value = process.env[preset.envKey]
    if (value && value.length >= 8 && !secrets.includes(value)) secrets.push(value)
  }
  return secrets
}

/**
 * The secret set for one outbound failure: this request's credential
 * headers plus the configured provider keys (scoped to `providerId` when
 * given). Header secrets come first so a prefix-collision redacts the
 * longer value first (the providers implementation sorts by length
 * anyway — ordering here is for deterministic logging).
 */
export function collectOutboundSecrets(headers: Headers, providerId?: string): string[] {
  return [...collectHeaderSecrets(headers), ...collectProviderSecrets(providerId)]
}
