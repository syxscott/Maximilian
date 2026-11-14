// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * DiffPreview — embedded diff for permission/approval cards (opencode
 * `routes/session/permission.tsx` borrowing): the approval card shows
 * *what is being approved* — an inline, line-colored preview of the file
 * change — instead of just a path. The line diff is a true LCS diff
 * (OpenHands `diff-view.tsx` borrowing): common prefix/suffix lines are
 * trimmed first, then only the middle segment goes through an O(n·m) LCS
 * so multi-hunk edits read exactly instead of as one paired block.
 */

import { useMemo } from "react"
import { useLocale, t } from "@max/i18n"

export interface DiffPreviewProps {
  tool?: string
  input?: unknown
  /** Collapse huge diffs to this many lines (default 24). */
  maxLines?: number
}

interface ExtractedChange {
  kind: "edit" | "write"
  oldText: string
  newText: string
}

/**
 * Pull an (old, new) text pair out of a tool input. Supports the edit tool
 * (`oldString`/`newString` — camelCase, matching `packages/tools/src/edit.ts`
 * input schema) and the write tool (`content` replaces the whole file;
 * the server doesn't ship a pre-existing body, so we render an all-added
 * view).
 */
export function extractChange(tool: string | undefined, input: unknown): ExtractedChange | null {
  if (!input || typeof input !== "object") return null
  const obj = input as Record<string, unknown>
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
  if (tool === "edit") {
    const oldText = str(obj.oldString)
    const newText = str(obj.newString)
    if (oldText === null || newText === null) return null
    return { kind: "edit", oldText, newText }
  }
  if (tool === "write") {
    const newText = str(obj.content)
    if (newText === null) return null
    return { kind: "write", oldText: "", newText }
  }
  return null
}

export interface DiffLine {
  type: "add" | "del" | "ctx" | "hunk"
  text: string
}

/** Lines of unchanged context kept on each side of the change (borrowing). */
const CONTEXT = 2
/** Max rows buildDiffLines ever returns, so a pathological edit can't blow
 *  the renderer; the card's own maxLines truncation sits on top of this. */
const MAX_ROWS = 300
/** Above this `old × new` line product the O(n·m) LCS is skipped and the
 *  whole middle segment degrades to a wholesale replacement (OpenHands
 *  LCS_CELL_BUDGET borrowing) — a full-file rewrite must not allocate a
 *  quarter-billion LCS cells. */
const LCS_CELL_BUDGET = 250_000

/**
 * LCS line diff over the (already prefix/suffix-trimmed) middle segments.
 * Returns the walk order: shared lines as `ctx`, old-only lines as `del`,
 * new-only lines as `add`. Above LCS_CELL_BUDGET the segments collapse to
 * "delete everything, add everything" — imprecise but bounded.
 */
function lcsDiff(a: string[], b: string[]): DiffLine[] {
  if (a.length * b.length > LCS_CELL_BUDGET) {
    return [
      ...a.map((text): DiffLine => ({ type: "del", text })),
      ...b.map((text): DiffLine => ({ type: "add", text })),
    ]
  }
  const n = a.length
  const m = b.length
  // lcs[i][j] = LCS length of a[i..] vs b[j..]; the (n+1)×(m+1) table is
  // bounded by LCS_CELL_BUDGET cells.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const rows: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: "ctx", text: a[i] })
      i += 1
      j += 1
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ type: "del", text: a[i] })
      i += 1
    } else {
      rows.push({ type: "add", text: b[j] })
      j += 1
    }
  }
  while (i < n) {
    rows.push({ type: "del", text: a[i] })
    i += 1
  }
  while (j < m) {
    rows.push({ type: "add", text: b[j] })
    j += 1
  }
  return rows
}

export interface DiffResult {
  lines: DiffLine[]
  /** Exact added-line count across the whole diff (untruncated). */
  added: number
  /** Exact removed-line count across the whole diff (untruncated). */
  removed: number
  /** True when MAX_ROWS cut rows off the tail of `lines`. */
  truncated: boolean
}

/**
 * Line-diff old vs new with a real LCS (OpenHands `computeLineDiff`
 * borrowing). Common leading/trailing lines are trimmed (with a couple
 * kept as context) so a localized edit inside a large file stays small
 * and cheap; the middle segments go through the bounded LCS so a
 * multi-hunk edit splits into per-hunk del/add groups separated by the
 * real shared context.
 */
export function buildDiff(oldText: string, newText: string): DiffResult {
  const oldLines = oldText.length > 0 ? oldText.split("\n") : []
  const newLines = newText.length > 0 ? newText.split("\n") : []

  let lo = 0
  while (lo < oldLines.length && lo < newLines.length && oldLines[lo] === newLines[lo]) {
    lo += 1
  }
  let hiOld = oldLines.length
  let hiNew = newLines.length
  while (hiOld > lo && hiNew > lo && oldLines[hiOld - 1] === newLines[hiNew - 1]) {
    hiOld -= 1
    hiNew -= 1
  }

  const lead = oldLines.slice(Math.max(0, lo - CONTEXT), lo)
  const trail = oldLines.slice(hiOld, Math.min(oldLines.length, hiOld + CONTEXT))

  const middle = lcsDiff(oldLines.slice(lo, hiOld), newLines.slice(lo, hiNew))
  const lines: DiffLine[] = [
    ...lead.map((text): DiffLine => ({ type: "ctx", text })),
    ...middle,
    ...trail.map((text): DiffLine => ({ type: "ctx", text })),
  ]

  const added = lines.filter((l) => l.type === "add").length
  const removed = lines.filter((l) => l.type === "del").length
  if (lines.length > MAX_ROWS) {
    return { lines: lines.slice(0, MAX_ROWS), added, removed, truncated: true }
  }
  return { lines, added, removed, truncated: false }
}

/**
 * Line-only view of {@link buildDiff} for callers that don't need the
 * exact +/− tallies (kept for the existing extract path consumers).
 */
export function buildDiffLines(oldText: string, newText: string): DiffLine[] {
  const result = buildDiff(oldText, newText)
  if (result.lines.length === 0) {
    return [{ type: "hunk", text: "(no textual change)" }]
  }
  return result.lines
}

export function DiffPreview({ tool, input, maxLines = 24 }: DiffPreviewProps) {
  useLocale()
  const change = useMemo(() => extractChange(tool, input), [tool, input])
  if (!change) return null

  const diff = buildDiff(change.oldText, change.newText)
  const lines = diff.lines
  const overflow = lines.length > maxLines
  const visible = overflow ? lines.slice(0, maxLines) : lines

  // For `write` we can't tell from the tool input alone whether the file
  // already exists — `packages/tools/src/write.ts` will stat() and overwrite
  // either way. So label it as a plain "write" and avoid the misleading
  // "new file" claim (which was previously driven solely by `oldText === ""`,
  // i.e. always true for write). The header shows the exact +/− tallies the
  // LCS produced (the old whole-file line counts mislabeled multi-hunk
  // edits, which motivated the LCS rewrite).
  const header = `${change.kind === "edit" ? t("diffPreview.edit") : t("diffPreview.write")} · ${t(
    "diffPreview.changes",
    { added: diff.added, removed: diff.removed },
  )}`

  return (
    <div
      className="rounded border border-[color:var(--mx-border-muted)] overflow-hidden"
      data-testid="diff-preview"
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground bg-[color:var(--mx-alpha-dark-2)]">
        {header}
      </div>
      <pre className="overflow-x-auto text-xs font-mono leading-5 m-0">
        {visible.map((line, i) => (
          <div
            key={i}
            className={
              line.type === "add"
                ? "bg-[color:var(--mx-green-1200)] text-[color:var(--mx-green-400)]"
                : line.type === "del"
                  ? "bg-[color:var(--mx-red-1200)] text-[color:var(--mx-red-400)]"
                  : "opacity-70"
            }
          >
            <span className="inline-block w-4 text-center opacity-60 select-none">
              {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
            </span>
            <span className="whitespace-pre">
              {line.type === "hunk" ? t("diffPreview.noChange") : line.text}
            </span>
          </div>
        ))}
        {overflow ? (
          <div className="px-2 text-muted-foreground">
            {t("diffPreview.overflow", { count: lines.length - maxLines })}
          </div>
        ) : null}
      </pre>
    </div>
  )
}
