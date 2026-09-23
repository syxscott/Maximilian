// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * EditInlineDiff model layer: file-change fields for the edit/write
 * renderers (the diff itself is rendered by reusing DiffPreview's
 * extractChange — see edit-inline-diff.tsx).
 */

import { FIELDS, asRecord, oneLine, pickStr, row, vmFrom, type RendererRow } from "./shared.model"

export interface FileChangeViewModel {
  /** Labeled rows (file path). */
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
  const filePath = pickStr(obj, ["file_path", "filePath", "path", "file"])
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
  const vm = vmFrom(
    [row(FIELDS.file, filePath, true)].filter((r) => r !== undefined),
    oneLine(filePath ?? ""),
  )
  return { rows: vm.rows, headline: vm.headline, hasDiff, isEmpty: vm.isEmpty && !hasDiff }
}
