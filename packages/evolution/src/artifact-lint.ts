// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Shape contract + lints for evolved artifacts.
 *
 * Borrowed from NousResearch/hermes-agent (commit c240e65399, "rewrite the
 * lessons, not the incident log"): months of an underspecified prompt
 * contract produced a 100k-char SKILL.md, 443 per-session reference
 * fragments and 5 duplicate skills — all learned garbage the agents kept
 * faithfully replaying. The fix is a *shape contract* for generated text —
 * imperative rules, no incident references — enforced by lints before a
 * candidate is promoted:
 *
 *   - `incident-reference`   no PR/issue numbers, tracker URLs, dates —
 *                            a prompt must encode the *lesson*, not the event
 *   - `chat-reference`       no conversational debris ("as discussed", …)
 *   - `references-sprawl`    bounded reference count (hermes: >60 files)
 *   - `section-sprawl`       bounded top-level heading count
 *   - `duplicate-section`    same heading twice = learned garbage
 *
 * The duplicate-section check also backs the pre-existing `duplicate-section`
 * GateCode in constraint-gates.ts (previously declared, never enforced).
 */

/** Max path/link references in one candidate (hermes references-sprawl threshold). */
export const MAX_REFERENCES = 60
/** Max markdown headings in one candidate. */
export const MAX_SECTIONS = 24

export type LintCode =
  | "incident-reference"
  | "chat-reference"
  | "references-sprawl"
  | "section-sprawl"
  | "duplicate-section"

export interface LintViolation {
  code: LintCode
  detail: string
}

/** Standalone `#123`-style PR/issue references (3+ digits avoids headings). */
const INCIDENT_NUMBER = /(?<!\w)#{1,2}\d{3,}\b/
/** Tracker URLs — a prompt should never point at a specific incident. */
const TRACKER_URL =
  /\b(?:github\.com|gitlab\.com|jira|linear\.app)\/[^\s)]*(?:\/issues?\/|\/pull\/)/i
/** ISO-style dates — they anchor the rule to an event instead of the lesson. */
const ISO_DATE = /\b20\d{2}-\d{2}-\d{2}\b/
/** Conversational debris. */
const CHAT_PHRASES = [
  /\bas discussed\b/i,
  /\bas mentioned\b/i,
  /\bper our chat\b/i,
  /\bas you asked\b/i,
  /\bearlier (?:today|yesterday)\b/i,
]

export interface PromptShapeInput {
  /** The candidate text to lint. */
  text: string
  /** Overrides for bounds (tests / stricter roles). */
  maxReferences?: number
  maxSections?: number
}

/**
 * Lint a candidate artifact against the shape contract. Returns all
 * violations (not just the first) so the caller can attach a complete
 * postmortem to the rejection.
 */
export function lintPromptShape(input: PromptShapeInput): LintViolation[] {
  const text = input.text
  const maxRefs = input.maxReferences ?? MAX_REFERENCES
  const maxSections = input.maxSections ?? MAX_SECTIONS
  const violations: LintViolation[] = []

  // 1. Incident references — the candidate must state the rule, not the event.
  const incidentHits: string[] = []
  const numberMatch = INCIDENT_NUMBER.exec(text)
  if (numberMatch) incidentHits.push(`issue/PR reference "${trimSample(numberMatch[0])}"`)
  const urlMatch = TRACKER_URL.exec(text)
  if (urlMatch) incidentHits.push(`tracker URL "${trimSample(urlMatch[0])}"`)
  const dateMatch = ISO_DATE.exec(text)
  if (dateMatch) incidentHits.push(`date "${trimSample(dateMatch[0])}"`)
  if (incidentHits.length > 0) {
    violations.push({
      code: "incident-reference",
      detail: `candidate references specific incidents (${incidentHits.join(", ")}); state the general rule instead`,
    })
  }

  // 2. Chat debris.
  const chatHit = CHAT_PHRASES.map((re) => re.exec(text)).find(Boolean)
  if (chatHit) {
    violations.push({
      code: "chat-reference",
      detail: `conversational phrase "${trimSample(chatHit[0])}" — prompts must be imperative rules, not conversation`,
    })
  }

  // 3. Reference sprawl.
  const refs = countReferences(text)
  if (refs > maxRefs) {
    violations.push({
      code: "references-sprawl",
      detail: `${refs} path/link references exceeds the cap of ${maxRefs}`,
    })
  }

  // 4. Heading structure.
  const headings = text
    .split("\n")
    .map((l) => /^#{1,6}\s+(.*)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1].trim().toLowerCase())
  if (headings.length > maxSections) {
    violations.push({
      code: "section-sprawl",
      detail: `${headings.length} headings exceeds the cap of ${maxSections}`,
    })
  }
  const seen = new Map<string, number>()
  for (const h of headings) {
    seen.set(h, (seen.get(h) ?? 0) + 1)
  }
  const duplicated = [...seen.entries()].filter(([, n]) => n > 1)
  if (duplicated.length > 0) {
    violations.push({
      code: "duplicate-section",
      detail: `duplicate headings: ${duplicated
        .slice(0, 3)
        .map(([h, n]) => `"${h}" ×${n}`)
        .join(", ")}`,
    })
  }

  return violations
}

/** Human-readable one-liner for decision logs. */
export function summarizeViolations(violations: LintViolation[]): string {
  return violations.map((v) => `${v.code} (${v.detail})`).join("; ")
}

/**
 * Count reference-like tokens in mutually exclusive categories: markdown
 * links / autolinks, inline-code spans that look like paths, and bare path
 * tokens (contain `/` plus a file extension). Deliberately coarse — the
 * sprawl cap is a tripwire, not a precise count.
 */
export function countReferences(text: string): number {
  let count = 0
  let rest = text

  const mdLink = /\[[^\]]*\]\([^)]*\)|<https?:\/\/[^>]+>/g
  count += (rest.match(mdLink) ?? []).length
  rest = rest.replace(mdLink, " ")

  const inlineSpan = /`[^`\n]*`/g
  for (const span of rest.match(inlineSpan) ?? []) {
    if (span.includes("/")) count += 1
  }
  rest = rest.replace(inlineSpan, " ")

  const barePath = /\b[\w.-]+(?:\/[\w.@-]+)+\.[a-z]{1,6}\b/gi
  count += (rest.match(barePath) ?? []).length
  return count
}

function trimSample(s: string, max = 40): string {
  const oneLine = s.replace(/\s+/g, " ").trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}
