// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * DiffPreview — embedded diff for permission/approval cards (opencode
 * `routes/session/permission.tsx` borrowing): the approval card shows
 * *what is being approved* — an inline, line-colored preview of the file
 * change — instead of just a path. Zero-dependency: line-based render of
 * old/new text with +/− gutters, good enough to judge an edit at a glance.
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

interface DiffLine {
  type: "add" | "del" | "ctx" | "hunk"
  text: string
}

/**
 * Line-diff old vs new. Not a real LCS diff — for edit-sized inputs a
 * common-prefix/suffix trim plus line pairing reads correctly and costs
 * nothing; that matches how approval previews are actually read (glance,
 * decide).
 */
export function buildDiffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.length > 0 ? oldText.split("\n") : []
  const newLines = newText.split("\n")

  // Trim common prefix/suffix so the preview focuses on the change.
  let start = 0
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start += 1
  }
  let endOld = oldLines.length
  let endNew = newLines.length
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
    endOld -= 1
    endNew -= 1
  }

  const ctxBefore = oldLines.slice(Math.max(0, start - 2), start)
  const ctxAfter = newLines.slice(endNew, endNew + 2)
  const removed = oldLines.slice(start, endOld)
  const added = newLines.slice(start, endNew)

  const lines: DiffLine[] = []
  for (const t of ctxBefore) lines.push({ type: "ctx", text: t })
  for (const t of removed) lines.push({ type: "del", text: t })
  for (const t of added) lines.push({ type: "add", text: t })
  for (const t of ctxAfter) lines.push({ type: "ctx", text: t })

  if (lines.length === 0) {
    lines.push({ type: "hunk", text: "(no textual change)" })
  }
  return lines
}

export function DiffPreview({ tool, input, maxLines = 24 }: DiffPreviewProps) {
  useLocale()
  const change = useMemo(() => extractChange(tool, input), [tool, input])
  if (!change) return null

  const lines = buildDiffLines(change.oldText, change.newText)
  const overflow = lines.length > maxLines
  const visible = overflow ? lines.slice(0, maxLines) : lines

  // For `write` we can't tell from the tool input alone whether the file
  // already exists — `packages/tools/src/write.ts` will stat() and overwrite
  // either way. So label it as a plain "write" and avoid the misleading
  // "new file" claim (which was previously driven solely by `oldText === ""`,
  // i.e. always true for write). The previous header would have lied on
  // every overwrite of an existing file.
  const header =
    change.kind === "edit"
      ? `${t("diffPreview.edit")} · ${t("diffPreview.linesChanged", {
          old: change.oldText.split("\n").length,
          new: change.newText.split("\n").length,
        })}`
      : `${t("diffPreview.write")} · ${t("diffPreview.linesChanged", {
          old: 0,
          new: change.newText.split("\n").length,
        })}`

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
