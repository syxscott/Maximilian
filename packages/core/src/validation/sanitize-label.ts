/**
 * Sanitize user-supplied display labels (tenant names, workspace titles,
 * agent role names, etc.) before they hit the DB or the UI.
 *
 * 借鉴 token-monitor limits.js:normalizeAccountLabel — defensive
 * 4-step filter: length cap → reject sensitive formats (email, URL) →
 * allowlist chars → collapse whitespace → re-cap.
 *
 * Returns the empty string for input that should not be displayed
 * verbatim (callers can fall back to a placeholder).
 */
export interface SanitizeLabelOptions {
  /** Max length after sanitization. Default 64. */
  maxLength?: number;
  /** Reject strings containing `@`. Default true. */
  rejectAt?: boolean;
  /** Reject strings starting with http:// or https://. Default true. */
  rejectUrl?: boolean;
}

export const DEFAULT_LABEL_MAX_LENGTH = 64;

export function sanitizeDisplayLabel(
  raw: unknown,
  options: SanitizeLabelOptions = {},
): string {
  const maxLength = options.maxLength ?? DEFAULT_LABEL_MAX_LENGTH;
  const rejectAt = options.rejectAt ?? true;
  const rejectUrl = options.rejectUrl ?? true;

  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return "";

  if (rejectAt && trimmed.includes("@")) return "";
  if (rejectUrl && /^https?:\/\//i.test(trimmed)) return "";

  // Slice BEFORE allowlist + collapse so truncation gives sensible output
  // (e.g. "hello   world" maxLength=8 → "hello   " → collapse → "hello",
  // not "hello wo" which would happen if collapse ran first).
  const sliced =
    trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;

  // Allowlist: letters (any case), digits, space, `+ . _ -`.
  // Strip everything else (emoji, control chars, slashes, quotes, etc.).
  return sliced
    .replace(/[^a-zA-Z0-9 +._-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}