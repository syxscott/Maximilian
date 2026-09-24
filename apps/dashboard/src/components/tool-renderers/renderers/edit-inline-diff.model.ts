// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * EditInlineDiff model layer: file-change fields for the edit/write
 * renderers. Keyed to the REAL input schemas of packages/tools/src:
 *
 *   edit  → edit.ts  { path, oldString, newString, replaceAll? }
 *   write → write.ts { path, content }
 *
 * `path` is the schema field (with the historical `file_path`/camelCase
 * spellings kept as defensive aliases — the runtime forwards whatever the
 * model produced). The diff itself is rendered by reusing DiffPreview's
 * extractChange, which accepts the camelCase oldString/newString pair —
 * aliases there would make hasDiff lie, so hasDiff mirrors its rules.
 */

import { FIELDS, asRecord, oneLine, pickStr, row, vmFrom, type RendererRow } from "./shared.model"

export interface FileChangeViewModel {
  /** Labeled rows (file path, replaceAll, byte/line counts). */
  rows: RendererRow[]
  /** Raw file path for the collapsed line. */
  headline: string
  /** true → DiffPreview can extract an (old, new) pair from this input. */
  hasDiff: boolean
  /** No domain field found → body shows the generic JSON preview. */
  isEmpty: boolean
}

export function extractFileChange(tool: string, input: unknown): FileChangeViewModel {
  const obj = asRecord(input)
  const filePath = pickStr(obj, ["path", "filePath", "file_path", "file"])
  const replaceAll = obj["replaceAll"] === true || obj["replace_all"] === true
  // Same keys DiffPreview.extractChange accepts — camelCase only, matching
  // packages/tools input schemas. Aliases here would make hasDiff lie.
  const oldText = pickStr(obj, ["oldString"])
  const newText = pickStr(obj, ["newString", "content"])
  // Mirrors DiffPreview.extractChange's acceptance rules: edit needs the
  // (oldString, newString) pair; write needs just content.
  const hasDiff =
    tool === "edit"
      ? oldText !== undefined && newText !== undefined
      : tool === "write"
        ? newText !== undefined
        : false
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.file, filePath, true),
    tool === "edit" && replaceAll ? row(FIELDS.replaceAll, "true", true) : undefined,
  ]
  if (tool === "write" && newText !== undefined) {
    rows.push(row(FIELDS.bytes, utf8ByteLength(newText)))
    rows.push(row(FIELDS.lines, newText.split("\n").length))
  }
  const vm = vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(filePath ?? ""),
  )
  return { rows: vm.rows, headline: vm.headline, hasDiff, isEmpty: vm.isEmpty && !hasDiff }
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}
