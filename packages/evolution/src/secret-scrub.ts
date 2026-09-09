/**
 * Secret-scrubbing regex set (borrowed from
 * NousResearch/hermes-agent-self-evolution/evolution/core/external_importers.py:45-80).
 *
 * Hermes mines Claude Code / Copilot sessions into an eval dataset and
 * scrubs PII / API keys before persisting, otherwise the data would carry
 * forward secrets into the next prompt context. The `SECRET_PATTERNS`
 * there is an anchored regex set covering 15+ key formats.
 *
 * Maximilian's adaptation: a pure-function `containsSecret` + `scrubSecrets`
 * that callers (memory.ts, evolution.ts, facade.ts) invoke *before*
 * persisting any text into `goodExample` / `userFeedback` / long-term memory.
 *
 * No external deps. No I/O. The 15+ patterns cover common cases; deliberately
 * over-matches on synthetic content to avoid leaking real keys.
 */

const SECRET_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  // AWS access key id (AKIA / ASIA prefix).
  { name: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  // GitHub tokens: ghp_/gho_/ghs_/ghr_/ghu_ + 36+ chars.
  { name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  // GitHub fine-grained: github_pat_ + 22+ chars + _ + 59+ chars.
  { name: "github-fine-grained", re: /\bgithub_pat_[A-Za-z0-9]{22,}_[A-Za-z0-9]{59,}\b/g },
  // Slack: xox[bpars]- + 10+ chars.
  { name: "slack-token", re: /\bxox[bpars]-[A-Za-z0-9-]{10,}\b/g },
  // Google API key: AIza + 35 chars.
  { name: "google-api", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  // OpenAI: sk- / sk-proj- + 20+ chars.
  { name: "openai-key", re: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}\b/g },
  // Anthropic: sk-ant- + 20+ chars.
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9-]{20,}\b/g },
  // Stripe: sk_live_/sk_test_ + 16+ chars.
  { name: "stripe-key", re: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  // PEM private-key header.
  { name: "pem-private-key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  // Generic "key=...", "token=...", "secret=..." patterns (24+ char value).
  { name: "generic-key-pair", re: /\b(?:api[_-]?key|token|secret|passwd|password)\s*[=:]\s*['"]?[A-Za-z0-9_\-]{16,}['"]?/gi },
  // JWT (header.payload.signature, 3 base64url chunks).
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  // Bearer token in Authorization header value.
  { name: "bearer", re: /Bearer\s+[A-Za-z0-9_\-.=]{20,}/g },
  // US SSN (3-2-4) — PII leak path.
  { name: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // Email (very rough; can be over-eager on placeholders).
  { name: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Credit-card-ish: 4×4 digits with optional separators.
  { name: "credit-card", re: /\b(?:\d[ -]?){13,19}\b/g },
  // 64-char hex (often a hash but also an API secret).
  { name: "hex-blob-64", re: /\b[a-f0-9]{64}\b/gi },
];

export interface SecretMatch {
  name: string;
  match: string;
  index: number;
}

export function containsSecret(text: string): boolean {
  for (const { re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) return true;
  }
  return false;
}

export function findSecrets(text: string): SecretMatch[] {
  const out: SecretMatch[] = [];
  for (const { name, re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({ name, match: m[0], index: m.index });
      // Defensive: zero-length match infinite loop guard.
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return out;
}

/** Replace all detected secrets with a stable, non-reversible marker. */
export function scrubSecrets(text: string, marker = "[SECRET_REMOVED]"): string {
  let out = text;
  for (const { re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, marker);
  }
  return out;
}
