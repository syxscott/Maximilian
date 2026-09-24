// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Node-REPL tool model layer: node-repl, node-repl-image-grid. Extracts
 * the script body (monospace display) plus title/timeout/line count, and
 * classifies every grid image into a renderable source (data URI or
 * http(s) URL) or a bare file path; defensive against missing fields and
 * malformed payloads.
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

export interface NodeReplViewModel extends ToolViewModel {
  title?: string
  /** Total line count of the script (shown even when the block clamps). */
  lineCount?: number
}

export function extractNodeRepl(input: unknown): NodeReplViewModel {
  const obj = asRecord(input)
  const code = pickStr(obj, ["code", "script", "source", "js", "body"])
  const title = pickStr(obj, ["title", "name", "label"])
  const timeout = pickNum(obj, ["timeoutMs", "timeout_ms", "timeout"])
  if (!code && !title && timeout === undefined) return { ...emptyVm() }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.title, title),
    timeout === undefined ? undefined : row(FIELDS.timeout, timeout),
    code === undefined ? undefined : row(FIELDS.lines, code.split("\n").length),
  ]
  return {
    ...vmFrom(
      rows.filter((r) => r !== undefined),
      oneLine(title ?? (code === undefined ? "" : code.replace(/\s+/g, " ").slice(0, 80))),
      code === undefined ? undefined : { text: code, maxLines: 20 },
    ),
    ...(title === undefined ? {} : { title }),
    ...(code === undefined ? {} : { lineCount: code.split("\n").length }),
  }
}

// ── node-repl-image-grid ─────────────────────────────────────────────────────

export interface ReplImage {
  /** Renderable source: data: URI or http(s) URL (the body draws an <img>). */
  src?: string
  /** File path without a renderable source (the body lists it as text). */
  path?: string
}

export interface NodeReplImageGridViewModel extends ToolViewModel {
  title?: string
  images: ReplImage[]
}

/** True only for sources a browser can actually render inline. */
export function isRenderableImageSrc(src: string): boolean {
  return src.startsWith("data:") || src.startsWith("http://") || src.startsWith("https://")
}

function classifyImage(raw: unknown): ReplImage {
  const value = typeof raw === "string" ? raw : undefined
  const obj = asRecord(raw)
  const src =
    value ??
    pickStr(obj, ["src", "url", "data", "uri", "dataUrl", "data_url", "base64"]) ??
    undefined
  if (src !== undefined && isRenderableImageSrc(src)) return { src }
  const path = value ?? pickStr(obj, ["path", "file", "imagePath", "image_path", "name"])
  return path === undefined ? {} : { path }
}

export function extractNodeReplImageGrid(input: unknown): NodeReplImageGridViewModel {
  const obj = asRecord(input)
  const title = pickStr(obj, ["title", "name", "label"])
  const images = pickArray(obj, ["images", "imagePaths", "paths", "files", "items"])
  const single = pickStr(obj, ["image", "path", "file"])
  if (!title && !images && !single) return { ...emptyVm(), images: [] }
  const classified = (images ?? []).map(classifyImage)
  if (images === undefined && single !== undefined) classified.push(classifyImage(single))
  const renderable = classified.filter((img) => img.src !== undefined).length
  const pathOnly = classified.length - renderable
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.title, title),
    images === undefined ? undefined : row(FIELDS.images, images.length),
    // Split the count so the body knows what it can draw vs list.
    images === undefined
      ? undefined
      : row(FIELDS.preview, `${renderable} inline / ${pathOnly} path`),
    single === undefined || images !== undefined ? undefined : row(FIELDS.path, single, true),
  ]
  const headline = title ?? (images ? `×${images.length}` : (single ?? ""))
  return {
    ...vmFrom(
      rows.filter((r) => r !== undefined),
      oneLine(headline),
    ),
    ...(title === undefined ? {} : { title }),
    images: classified,
  }
}
