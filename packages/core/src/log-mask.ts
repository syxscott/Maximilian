/**
 * Sensitive value masking for log output (borrowed from
 * myclaude/internal/executor/executor.go:1481-1491).
 *
 * Background: myclaude's `maskSensitiveValue` redacts env-bearing vars
 * (anything whose name contains `key`, `token`, `secret`, `password`,
 * `auth`) before logging. The Maximilian equivalent masks:
 *   - HTTP `Authorization` header values
 *   - JSON body fields named like credentials
 *   - Inline API keys / tokens / SSNs (re-using the regex set from
 *     packages/evolution/src/secret-scrub.ts).
 *
 * The masker is recursive on objects/arrays and safe to call on any
 * unknown value. The original input is never mutated.
 */

const SENSITIVE_HEADER_NAMES = new Set<string>([
  "authorization",
  "x-api-key",
  "x-auth-token",
  "cookie",
  "set-cookie",
  "proxy-authorization",
]);

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
]);

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
];

const REPLACEMENT = "[REDACTED]";
const MASKED_HEADER = "***";
const MASKED_FIELD = "***REDACTED***";

export function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_NAMES.has(k.toLowerCase())) {
      out[k] = MASKED_HEADER;
    } else {
      out[k] = maskString(v);
    }
  }
  return out;
}

export function maskBody(body: unknown): unknown {
  return walk(body);
}

export function maskString(s: string): string {
  let out = s;
  for (const re of SENSITIVE_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, REPLACEMENT);
  }
  return out;
}

function walk(value: unknown): unknown {
  if (typeof value === "string") return maskString(value);
  if (Array.isArray(value)) return value.map((v) => walk(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_FIELD_NAMES.has(k.toLowerCase())) {
        out[k] = MASKED_FIELD;
      } else {
        out[k] = walk(v);
      }
    }
    return out;
  }
  return value;
}