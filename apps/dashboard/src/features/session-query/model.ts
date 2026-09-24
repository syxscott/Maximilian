// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Pure view-model for cross-session message search (features/README
 * model/presentation split). The API returns a FLAT hit list (newest
 * first); the panel needs (a) each hit split into a three-segment
 * highlight around the match and (b) hits grouped by session. Both are
 * pure functions here, defensive against passthrough JSON — rows may be
 * missing fields, and the query is operator input.
 */

/** One search hit as the API returns it (mirror of the route schema). */
export interface SessionSearchHit {
  sessionId: string
  workspaceId: string | null
  role: string
  content: string
  createdAt: string | null
}

/** Three-way split of a content snippet around the match. */
export interface HighlightSegments {
  before: string
  match: string
  after: string
}

/** One hit as the panel renders it. */
export interface SessionHitView {
  role: string
  createdAt: string | null
  highlight: HighlightSegments
  /** Full message content — the per-hit CopyField copies this. */
  content: string
}

/** All hits of one session, in input (newest-first) order. */
export interface SessionSearchGroup {
  sessionId: string
  workspaceId: string | null
  hits: SessionHitView[]
}

/** Grouped view the panel renders. */
export interface SessionSearchView {
  groups: SessionSearchGroup[]
  hitCount: number
}

/** Characters of context kept on each side of the match before truncation. */
export const SNIPPET_CONTEXT_CHARS = 60

/** Default cap on rendered session sections. */
export const MAX_GROUPS = 20

/** Default cap on rendered hits per session section. */
export const MAX_HITS_PER_GROUP = 5

/**
 * Split `content` into {before, match, after} around the FIRST
 * case-insensitive occurrence of `query`, truncating the context to
 * `contextChars` characters on each side ("…" marks elided text).
 * Returns null when either input is not a usable string or does not
 * match — the caller renders the row as a plain miss instead of a crash.
 */
export function splitHighlight(
  content: unknown,
  query: unknown,
  contextChars = SNIPPET_CONTEXT_CHARS,
): HighlightSegments | null {
  if (typeof content !== "string" || typeof query !== "string") return null
  const needle = query.trim()
  if (needle.length === 0) return null
  const idx = content.toLowerCase().indexOf(needle.toLowerCase())
  if (idx < 0) return null
  const matchEnd = idx + needle.length
  const start = Math.max(0, idx - contextChars)
  const end = Math.min(content.length, matchEnd + contextChars)
  return {
    before: (start > 0 ? "…" : "") + content.slice(start, idx),
    match: content.slice(idx, matchEnd),
    after: content.slice(matchEnd, end) + (end < content.length ? "…" : ""),
  }
}

/**
 * Hit role → StatusPill alias status for the role capsule: user reads as
 * the active party (blue), assistant as the fulfilled party (green),
 * system as waiting (amber); anything else stays queued-neutral. The
 * pill's visible text stays the raw role (label override).
 */
export function roleStatus(role: string): string {
  switch (role) {
    case "user":
      return "active"
    case "assistant":
      return "success"
    case "system":
      return "waiting"
    default:
      return "queued"
  }
}

/**
 * Group flat hits by session, preserving the input order (the API
 * returns newest first, so sections are newest first too). Malformed
 * rows and non-matching content are dropped; `limits` caps the rendered
 * sections and the hits per section.
 */
export function groupSearchResults(
  hits: readonly unknown[],
  query: string,
  limits?: { maxGroups?: number; maxHitsPerGroup?: number },
): SessionSearchView {
  const maxGroups = limits?.maxGroups ?? MAX_GROUPS
  const maxHitsPerGroup = limits?.maxHitsPerGroup ?? MAX_HITS_PER_GROUP
  const bySession = new Map<string, SessionSearchGroup>()
  let hitCount = 0
  for (const raw of hits) {
    if (raw === null || typeof raw !== "object") continue
    const row = raw as Record<string, unknown>
    const sessionId = typeof row.sessionId === "string" ? row.sessionId : null
    if (sessionId === null) continue
    const highlight = splitHighlight(row.content, query)
    if (highlight === null) continue
    let group = bySession.get(sessionId)
    if (group === undefined) {
      if (bySession.size >= maxGroups) continue
      group = {
        sessionId,
        workspaceId: typeof row.workspaceId === "string" ? row.workspaceId : null,
        hits: [],
      }
      bySession.set(sessionId, group)
    }
    if (group.hits.length >= maxHitsPerGroup) continue
    group.hits.push({
      role: typeof row.role === "string" && row.role.length > 0 ? row.role : "message",
      createdAt: typeof row.createdAt === "string" ? row.createdAt : null,
      highlight,
      content: typeof row.content === "string" ? row.content : "",
    })
    hitCount++
  }
  return { groups: [...bySession.values()], hitCount }
}
