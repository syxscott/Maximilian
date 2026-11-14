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

// ── Workflow candidate lint (MiniMax-Code-MiniApps borrowing) ──────────────

/**
 * Declared-access-must-match-the-code (borrowing MiniMax-Code-MiniApps
 * `docs/package-contract.md:250-276` `ACCESS_UNDECLARED`, reworked for
 * forged workflow candidates): a candidate workflow step DECLARES the
 * tools it will use; the static scan requires the step bodies to actually
 * reference exactly what was declared, and refuses tools in the chain
 * whose `hasSideEffects` is not declared — the STATIC half of the
 * step-gate pair (packages/workflow-engine step-gate.ts re-checks the
 * same rule at RUN time; this lint refuses before anything ships).
 *
 *   - `undeclared-tool`            (error)   referenced but not declared
 *   - `unused-declaration`         (warning) declared but never referenced
 *   - `side-effects-undeclared`    (error)   no hasSideEffects declared
 *   - `side-effects-not-whitelisted` (error) side-effecting and not in the
 *                                            host whitelist (step_not_chainable)
 */

export type WorkflowLintCode =
  | "undeclared-tool"
  | "unused-declaration"
  | "side-effects-undeclared"
  | "side-effects-not-whitelisted"

export interface WorkflowLintViolation {
  code: WorkflowLintCode
  /** Errors block shipment; warnings do not. */
  severity: "error" | "warning"
  detail: string
  siteId?: string
}

export interface WorkflowStepCandidate {
  /** Stable step identity (WorkflowStep.siteId). */
  siteId?: string
  /** Tool this step chains (WorkflowStep.tool). */
  tool?: string
  /** Free-text step body — scanned for tool references. */
  body?: string
}

export interface WorkflowCandidateInput {
  steps: readonly WorkflowStepCandidate[]
  /** Tools the candidate DECLARES it will use. */
  declaredTools?: readonly string[]
  /**
   * Tool registry view: name → declared `hasSideEffects`. A name absent
   * from the map (or with no boolean) is UNDECLARED — the step-gate rule:
   * "flag unset → never".
   */
  toolHasSideEffects?: Readonly<Record<string, boolean>>
  /** Host whitelist of side-effecting tools allowed in a chain. */
  sideEffectingTools?: readonly string[]
  /**
   * The full tool-name universe the body scan can detect references
   * against (the host's registry names). Without it, only `step.tool`
   * references are checkable.
   */
  knownTools?: readonly string[]
}

/** Does `text` reference `name` as a whole word? */
function referencesTool(text: string, name: string): boolean {
  if (!name) return false
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`).test(text)
}

/**
 * Static scan of a candidate workflow: declared vs referenced tool sets
 * must agree, and every tool in the chain must have declared (and, when
 * side-effecting, whitelisted) side effects. Runs at forge/ship time —
 * the runtime twin is workflow-engine's step gate.
 */
export function lintWorkflowCandidate(input: WorkflowCandidateInput): WorkflowLintViolation[] {
  const violations: WorkflowLintViolation[] = []
  const declared = new Set(input.declaredTools ?? [])
  const known = new Set(input.knownTools ?? declared)
  const sideEffecting = new Set(input.sideEffectingTools ?? [])

  // 1. Collect what the steps actually reference: the chained tool names
  //    plus any known tool name mentioned inside a step body.
  const referenced = new Map<string, string[]>() // tool → siteIds
  const note = (tool: string, siteId?: string): void => {
    const arr = referenced.get(tool) ?? []
    if (siteId) arr.push(siteId)
    referenced.set(tool, arr)
  }
  for (const step of input.steps) {
    if (step.tool) note(step.tool, step.siteId)
    if (step.body) {
      for (const tool of known) {
        if (tool !== step.tool && referencesTool(step.body, tool)) note(tool, step.siteId)
      }
    }
  }

  // 2. Referenced but not declared → error (ACCESS_UNDECLARED analog).
  for (const [tool, sites] of referenced) {
    if (!declared.has(tool)) {
      violations.push({
        code: "undeclared-tool",
        severity: "error",
        detail: `step chain references tool "${tool}" but the candidate does not declare it (steps: ${sites.slice(0, 3).join(", ") || "?"})`,
        ...(sites[0] !== undefined ? { siteId: sites[0] } : {}),
      })
    }
  }

  // 3. Declared but never referenced → warning (drift, not danger).
  for (const tool of declared) {
    if (!referenced.has(tool)) {
      violations.push({
        code: "unused-declaration",
        severity: "warning",
        detail: `candidate declares tool "${tool}" but no step references it`,
      })
    }
  }

  // 4. Side-effect declaration — the static twin of the step-gate rules.
  for (const [tool, sites] of referenced) {
    const flag = input.toolHasSideEffects?.[tool]
    if (typeof flag !== "boolean") {
      violations.push({
        code: "side-effects-undeclared",
        severity: "error",
        detail: `step tool "${tool}" does not declare hasSideEffects; set it to true or false before a forged workflow can chain it`,
        ...(sites[0] !== undefined ? { siteId: sites[0] } : {}),
      })
    } else if (flag && !sideEffecting.has(tool)) {
      violations.push({
        code: "side-effects-not-whitelisted",
        severity: "error",
        detail: `step tool "${tool}" has side effects and is not listed in sideEffectingTools`,
        ...(sites[0] !== undefined ? { siteId: sites[0] } : {}),
      })
    }
  }

  return violations
}

/**
 * The ship-gate verdict over a workflow lint: ERROR violations block the
 * candidate from shipping; warnings ride along for the review.
 */
export function workflowLintBlocksShipment(violations: readonly WorkflowLintViolation[]): boolean {
  return violations.some((v) => v.severity === "error")
}
