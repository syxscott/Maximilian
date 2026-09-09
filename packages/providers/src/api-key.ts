/**
 * API key validation utilities — 借鉴 deepseek-harness llm/src/api-key.ts.
 *
 * Characters an HTTP header value carries verbatim and every known provider key uses:
 * printable ASCII, space excluded. A key outside this set cannot reach any provider —
 * `fetch` refuses to build the header — so this is a transport invariant rather
 * than one provider's policy.
 */

/** Why a supplied API key cannot be used. */
export type ApiKeyRejection = "empty" | "illegalCharacters"

/** The verdict on one supplied API key. */
export type ApiKeyCheck =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: ApiKeyRejection }

/**
 * Validate and normalize a raw API key string, trimming surrounding whitespace.
 *
 * Trimming is silent because a padded key has one unambiguous reading.
 * Absence is a configuration state this function never sees — callers decide
 * whether a value was supplied before asking.
 *
 * @param raw - the key exactly as configured, stored, or typed
 * @returns the trimmed key, or why it cannot be used
 */
export function normalizeApiKey(raw: string): ApiKeyCheck {
  const value = raw.trim()
  if (value.length === 0) return { ok: false, reason: "empty" }

  // Printable ASCII 0x21–0x7E; rejects control chars, spaces, tabs, newlines.
  if (!/^[\x21-\x7E]+$/.test(value)) {
    return { ok: false, reason: "illegalCharacters" }
  }

  return { ok: true, value }
}
