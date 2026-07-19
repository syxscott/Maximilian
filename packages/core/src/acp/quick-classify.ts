/**
 * `quickClassify` pre-screen for A2A content (borrowed from
 * kourai-khryseai/agents/aidos/agent.py:181-186 and aletheia/agent.py:209-212).
 *
 * Background: kourai's Aidos and Aletheia agents pre-screen text with a
 * small regex / lexicon before calling the LLM. If the text contains no
 * slop / no citation claim, they short-circuit and return "CLEAN" or
 * "VERIFIED" without ever calling the model — saving 100% of LLM cost on
 * trivially-classifiable input.
 *
 * Maximilian's adaptation: pre-screen for *transport* classifiers, not
 * domain classifiers. The intent is:
 *   - "noop"        — content is empty, whitespace-only, or just a
 *                     single "ok" / "ack" token. No LLM / handler needed.
 *   - "binary"      — content is a base64 blob. Skip text analysis.
 *   - "passthrough" — single text part under 1KB. Default fast path.
 *   - "complex"     — multi-part or >1KB. Hand off to full processing.
 *   - "sensitive"   — content looks like an API key / token / SSN. Mark
 *                     for redaction and downgrade to "complex".
 *   - "unknown"     — can't tell. Default to "complex".
 *
 * Returns a deterministic classification so callers can branch on it.
 * No I/O. No side effects. Pure function.
 */

import type { A2AContent, A2APart } from "./index.js";

export type QuickClassify =
  | "noop"
  | "binary"
  | "passthrough"
  | "complex"
  | "sensitive"
  | "unknown";

/** Byte threshold for "complex" content. Below this, treat as passthrough. */
export const PASSTHROUGH_MAX_BYTES = 1024;

/** Quick-check a list of regexes for sensitive content. */
const SENSITIVE_PATTERNS: ReadonlyArray<RegExp> = [
  // Generic API key shapes (24+ char hex / base64 blobs).
  /\b(?:sk|pk|api|key|token|secret)[-_][A-Za-z0-9]{16,}/i,
  // AWS access key id.
  /\bAKIA[0-9A-Z]{16}\b/,
  // PEM private-key header.
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  // GitHub personal access token (ghp_/gho_/ghs_/ghr_).
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  // Slack bot token (xox[bpars]-...).
  /\bxox[bpars]-[A-Za-z0-9-]{10,}\b/,
  // US SSN (xxx-xx-xxxx) — used for cross-org federation redaction.
  /\b\d{3}-\d{2}-\d{4}\b/,
  // Email with 4+ digit TLD-like suffix; very rough PII signal.
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
];

/** Compact "I acknowledge" tokens. Anything matching these is `noop`. */
const NOOP_TOKENS = new Set<string>([
  "",
  "ok",
  "ack",
  "ack.",
  "acknowledged",
  "acknowledged.",
  "yes",
  "no",
  "thanks",
  "thank you",
  "thx",
  "👍",
  "✅",
  "❌",
  "🆗",
]);

const BLOB_DATA_PREFIXES = [
  "data:application/octet-stream",
  "data:image/",
  "data:audio/",
  "data:video/",
  "data:font/",
];

export function quickClassify(content: A2AContent): QuickClassify {
  if (!content.parts || content.parts.length === 0) return "noop";

  // Aggregate size across all parts.
  let totalBytes = 0;
  let textBytes = 0;
  for (const part of content.parts) {
    totalBytes += partByteSize(part);
    if (part.kind === "text") textBytes += part.text.length;
  }

  if (totalBytes === 0) return "noop";

  // Binary content: a single data part whose mimeType starts with image/ etc.
  if (content.parts.length === 1) {
    const part = content.parts[0]!;
    if (part.kind === "data") {
      const mime = part.mimeType;
      if (BLOB_DATA_PREFIXES.some((p) => mime.startsWith(p.replace("data:", "")))) {
        return "binary";
      }
      // Inline data: URI base64.
      if (typeof part.value === "object" && part.value !== null) {
        const uri = (part.value as Record<string, unknown>).uri;
        if (typeof uri === "string" && BLOB_DATA_PREFIXES.some((p) => uri.startsWith(p))) {
          return "binary";
        }
      }
    }
  }

  // Noop: a single short text part whose value is an acknowledgement token.
  if (content.parts.length === 1) {
    const part = content.parts[0]!;
    if (part.kind === "text" && NOOP_TOKENS.has(part.text.trim().toLowerCase())) {
      return "noop";
    }
  }

  // Sensitive: scan text parts for known credential shapes.
  for (const part of content.parts) {
    if (part.kind === "text") {
      if (SENSITIVE_PATTERNS.some((p) => p.test(part.text))) {
        return "sensitive";
      }
    } else if (part.kind === "data") {
      // For structured data parts, recurse on string-valued fields.
      const flat = flattenStrings(part.value);
      for (const s of flat) {
        if (SENSITIVE_PATTERNS.some((p) => p.test(s))) {
          return "sensitive";
        }
      }
    }
  }

  // Passthrough: small text-only.
  if (
    content.parts.length === 1 &&
    content.parts[0]!.kind === "text" &&
    textBytes <= PASSTHROUGH_MAX_BYTES
  ) {
    return "passthrough";
  }

  // Otherwise: full processing required.
  if (totalBytes <= PASSTHROUGH_MAX_BYTES) return "passthrough";
  return "complex";
}

function partByteSize(part: A2APart): number {
  if (part.kind === "text") return part.text.length;
  // For data parts, estimate via JSON length. We don't want to actually
  // serialise to avoid double-work; use a cheap heuristic instead.
  return estimateObjectBytes(part.value);
}

function estimateObjectBytes(v: unknown): number {
  if (v === null || v === undefined) return 4;
  if (typeof v === "string") return v.length + 2;
  if (typeof v === "number") return 12;
  if (typeof v === "boolean") return 5;
  if (Array.isArray(v)) {
    let total = 2; // for []
    for (const item of v) total += estimateObjectBytes(item) + 1;
    return total;
  }
  if (typeof v === "object") {
    let total = 2;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      total += k.length + 3 + estimateObjectBytes(val) + 1;
    }
    return total;
  }
  return 8;
}

function flattenStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") {
    out.push(v);
    return out;
  }
  if (Array.isArray(v)) {
    for (const item of v) flattenStrings(item, out);
    return out;
  }
  if (v && typeof v === "object") {
    for (const val of Object.values(v as Record<string, unknown>)) {
      flattenStrings(val, out);
    }
  }
  return out;
}
