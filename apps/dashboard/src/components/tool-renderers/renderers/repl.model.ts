// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Node-REPL tool model layer: node-repl, node-repl-image-grid. Extracts
 * the script body (monospace display) plus title/timeout/image count;
 * defensive against missing fields and malformed payloads.
 */

import {
  FIELDS,
  asRecord,
  emptyVm,
  oneLine,
  pickArray,
  pickNum,
  pickStr,
  row,
  vmFrom,
  type RendererRow,
  type ToolViewModel,
} from "./shared.model"

export function extractNodeRepl(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const code = pickStr(obj, ["code", "script", "source", "js", "body"])
  const title = pickStr(obj, ["title", "name", "label"])
  const timeout = pickNum(obj, ["timeoutMs", "timeout_ms", "timeout"])
  if (!code && !title && timeout === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.title, title),
    timeout === undefined ? undefined : row(FIELDS.timeout, timeout),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(title ?? (code === undefined ? "" : code.replace(/\s+/g, " ").slice(0, 80))),
    code === undefined ? undefined : { text: code, maxLines: 20 },
  )
}

export function extractNodeReplImageGrid(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const title = pickStr(obj, ["title", "name", "label"])
  const images = pickArray(obj, ["images", "imagePaths", "paths", "files", "items"])
  const single = pickStr(obj, ["image", "path", "file"])
  if (!title && !images && !single) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.title, title),
    images === undefined ? undefined : row(FIELDS.images, images.length),
    single === undefined ? undefined : row(FIELDS.path, single, true),
  ]
  const headline = title ?? (images ? `×${images.length}` : (single ?? ""))
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(headline),
  )
}
