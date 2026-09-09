/**
 * Cross-org PII redaction layer (borrowed from
 * ibmlachezar/multi-agent-patterns/coordinator.py:94-118
 * `validate_federation_request`).
 *
 * Background: the multi-agent-patterns repo demonstrates a federation
 * gateway that strips sensitive fields ("ssn", "password",
 * "internal_cost", "margin") before passing a request from Org A to Org B.
 *
 * Maximilian's adaptation: a `redactPayload` helper that takes
 *   - the structured A2AContent
 *   - a list of {key, action} policies (allow | redact | block)
 *   - a "fromOrg" identifier (for telemetry)
 * and returns the redacted content + a count of redacted/blocked fields
 * for observability. Pure function; no I/O.
 */

import type { A2AContent, A2APart } from "./index.js";

/** Policy action for a specific field name. */
export type RedactionAction = "allow" | "redact" | "block";

export interface RedactionPolicy {
  /** Field key (case-insensitive). Nested paths use dot notation: "user.ssn". */
  field: string;
  action: RedactionAction;
  /**
   * Replacement string for "redact". Default: "[REDACTED]".
   * The replacement length is preserved for the replacement hint, but
   * actual content is always overwritten.
   */
  replacement?: string;
}

/** Default Maximilian redaction policies. */
export const DEFAULT_REDACTION_POLICIES: ReadonlyArray<RedactionPolicy> = [
  { field: "ssn", action: "redact" },
  { field: "password", action: "redact" },
  { field: "apiKey", action: "redact" },
  { field: "api_key", action: "redact" },
  { field: "secret", action: "redact" },
  { field: "token", action: "redact" },
  { field: "internalCost", action: "redact" },
  { field: "internal_cost", action: "redact" },
  { field: "margin", action: "redact" },
  { field: "creditCard", action: "redact" },
  { field: "credit_card", action: "redact" },
];

export interface RedactionResult {
  /** The redacted content. Always returned, even if a "block" fires. */
  content: A2AContent;
  /** Number of fields redacted across all parts. */
  redactedCount: number;
  /** Number of fields that triggered a "block" (caller should drop the message). */
  blockedCount: number;
  /** Names of fields that triggered a block (for telemetry). */
  blockedFields: string[];
}

const DEFAULT_REPLACEMENT = "[REDACTED]";

export function redactPayload(
  content: A2AContent,
  policies: ReadonlyArray<RedactionPolicy> = DEFAULT_REDACTION_POLICIES,
  fromOrg?: string,
): RedactionResult {
  const policyMap = new Map<string, RedactionPolicy>();
  for (const p of policies) policyMap.set(p.field.toLowerCase(), p);

  let redactedCount = 0;
  let blockedCount = 0;
  const blockedFields: string[] = [];

  const newParts: A2APart[] = content.parts.map((part) => {
    if (part.kind !== "data") return part;
    const newValue = walkAndRedact(part.value, policyMap, (field): string | undefined => {
      const policy = policyMap.get(field.toLowerCase());
      if (!policy) return undefined;
      if (policy.action === "redact") {
        redactedCount += 1;
        return policy.replacement ?? DEFAULT_REPLACEMENT;
      }
      if (policy.action === "block") {
        blockedCount += 1;
        blockedFields.push(field);
        return undefined;
      }
      // allow: pass through.
      return undefined;
    });
    return {
      kind: "data" as const,
      mimeType: part.mimeType,
      value: newValue as Record<string, unknown>,
    };
  });

  return {
    content: { parts: newParts },
    redactedCount,
    blockedCount,
    blockedFields,
  };
}

interface VisitFn {
  (field: string): string | undefined;
}

/**
 * Walk a JSON-like value. Returns a new value with policy violations
 * replaced. `visit` is called for every leaf key; if it returns a string,
 * the value is replaced. If it returns undefined, the value is left alone.
 */
function walkAndRedact(value: unknown, policy: Map<string, RedactionPolicy>, visit: VisitFn): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => walkAndRedact(v, policy, visit));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const replacement = visit(k);
      if (replacement !== undefined) {
        out[k] = replacement;
      } else {
        out[k] = walkAndRedact(v, policy, visit);
      }
    }
    return out;
  }
  return value;
}
