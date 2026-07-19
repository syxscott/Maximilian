/**
 * Artifact constraint gates (borrowed from
 * NousResearch/hermes-agent-self-evolution/evolution/core/constraints.py:30-53).
 *
 * Hermes runs `validate_all` on a candidate before promotion: size,
 * growth ≤ 20%, non-empty, structural integrity. A candidate that fails
 * any gate is aborted and the evolved prompt is written to a sibling
 * `evolved_FAILED.md` file for postmortem.
 *
 * Maximilian's adaptation: a pure `validateCandidate` function that the
 * evolution pipeline calls *before* writing the candidate version. A
 * failed gate produces a `ValidationError` with a structured `code` that
 * the caller can attach to the `EvolutionDecision.reason`.
 */

export const PROMPT_GROWTH_MAX = 1.2; // 20% growth cap
export const PROMPT_MIN_LEN = 80;
export const PROMPT_MAX_LEN = 16_000;

export interface CandidateLike {
  /** The proposed system prompt. */
  newSystemPrompt: string;
  /** The current system prompt (for growth comparison). */
  baseSystemPrompt: string;
}

export type GateCode =
  | "ok"
  | "empty"
  | "too-short"
  | "too-long"
  | "overgrowth"
  | "missing-role-marker"
  | "secret-leaked"
  | "duplicate-section";

export interface GateResult {
  code: GateCode;
  ok: boolean;
  reason?: string;
  /** Numeric metric the caller can use (size, growth ratio, etc.). */
  metric?: { size: number; growth: number };
}

const ROLE_MARKERS = [
  "you are",
  "your role",
  "your task",
  "agent profile",
  "system prompt",
];

export function validateCandidate(c: CandidateLike): GateResult {
  const trimmed = c.newSystemPrompt.trim();

  if (trimmed.length === 0) {
    return { code: "empty", ok: false, reason: "candidate prompt is empty" };
  }
  if (trimmed.length < PROMPT_MIN_LEN) {
    return {
      code: "too-short",
      ok: false,
      reason: `candidate prompt is shorter than ${PROMPT_MIN_LEN} chars (${trimmed.length})`,
      metric: { size: trimmed.length, growth: 1 },
    };
  }
  if (trimmed.length > PROMPT_MAX_LEN) {
    return {
      code: "too-long",
      ok: false,
      reason: `candidate prompt exceeds ${PROMPT_MAX_LEN} chars (${trimmed.length})`,
      metric: { size: trimmed.length, growth: 1 },
    };
  }

  const baseLen = Math.max(1, c.baseSystemPrompt.length);
  const growth = trimmed.length / baseLen;
  if (growth > PROMPT_GROWTH_MAX) {
    return {
      code: "overgrowth",
      ok: false,
      reason: `candidate grew by ${(growth * 100).toFixed(0)}% (max ${(PROMPT_GROWTH_MAX * 100).toFixed(0)}%)`,
      metric: { size: trimmed.length, growth },
    };
  }

  const lower = trimmed.toLowerCase();
  if (!ROLE_MARKERS.some((m) => lower.includes(m))) {
    return {
      code: "missing-role-marker",
      ok: false,
      reason: `candidate missing role marker; expected one of: ${ROLE_MARKERS.join(", ")}`,
      metric: { size: trimmed.length, growth },
    };
  }

  // Reject if the candidate *introduces* a secret (the source prompt is
  // assumed to be already-scrubbed; this guards against the candidate
  // generator accidentally embedding a key).
  if (containsSecretLike(trimmed)) {
    return {
      code: "secret-leaked",
      ok: false,
      reason: "candidate prompt appears to contain a secret (API key, token, etc.)",
      metric: { size: trimmed.length, growth },
    };
  }

  return { code: "ok", ok: true, metric: { size: trimmed.length, growth } };
}

function containsSecretLike(text: string): boolean {
  // Lightweight check; the full secret-scrub module is a separate package
  // we import at the top of the evolution pipeline. Here we only catch
  // obvious PEM / Bearer / 64-char-hex markers.
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text) ||
    /Bearer\s+[A-Za-z0-9_\-.=]{20,}/.test(text) ||
    /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/.test(text) ||
    /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/.test(text);
}
