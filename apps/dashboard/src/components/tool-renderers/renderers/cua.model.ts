// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Computer-use tool model layer: cua-action, get-app-state, list-apps,
 * screenshot — the individual CUA calls that previously existed only as
 * the cua-group's fallback child name. extractCuaAction reads the real
 * action surface (action · target/selector · typed text · key · dwell),
 * extractGetAppState the explicit observation (app · window · state id ·
 * element count), extractListApps the app/window roster and
 * extractScreenshot the image payload — classified through
 * repl.model.ts isRenderableImageSrc so the body knows whether it can
 * draw an <img>.
 */

import {
  FIELDS,
  asRecord,
  emptyVm,
  jsonPreview,
  oneLine,
  pickArray,
  pickNum,
  pickStr,
  row,
  vmFrom,
  type RendererCode,
  type RendererRow,
  type ToolViewModel,
} from "./shared.model"
import { isRenderableImageSrc } from "./repl.model"

export function extractCuaAction(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const action = pickStr(obj, ["action", "method", "type", "op", "name"])
  const target = pickStr(obj, ["target", "selector", "element", "ref", "coordinate"])
  const text = pickStr(obj, ["text", "value", "content"])
  const key = pickStr(obj, ["key", "keys", "hotkey"])
  const dwell = pickNum(obj, ["ms", "durationMs", "duration_ms", "waitMs"])
  if (action === undefined && target === undefined && text === undefined && key === undefined) {
    return emptyVm()
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.action, action),
    row(FIELDS.selector, target, true),
    row(FIELDS.text, text),
    key === undefined ? undefined : row(FIELDS.key, key, true),
    dwell === undefined ? undefined : row(FIELDS.duration, dwell),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine([action, target].filter((p) => p !== undefined).join(" · ")),
  )
}

export interface GetAppStateViewModel extends ToolViewModel {
  /** Explicit-observation marker: the returned state id. */
  stateId?: string
}

export function extractGetAppState(input: unknown): GetAppStateViewModel {
  const obj = asRecord(input)
  const app = pickStr(obj, ["app", "appId", "app_id", "application", "appName"])
  const win = pickStr(obj, ["window", "windowTitle", "window_title", "win"])
  const stateId = pickStr(obj, ["stateId", "state_id", "state", "snapshotId"])
  const elements = pickArray(obj, ["elements", "items", "nodes"])
  const count = elements !== undefined ? elements.length : pickNum(obj, ["count", "elementCount"])
  if (app === undefined && win === undefined && stateId === undefined && count === undefined) {
    return { ...emptyVm() }
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.app, app),
    row(FIELDS.window, win),
    stateId === undefined ? undefined : row(FIELDS.state, stateId, true),
    count === undefined ? undefined : row(FIELDS.elements, count),
  ]
  return {
    ...vmFrom(
      rows.filter((r) => r !== undefined),
      oneLine(app ?? win ?? stateId ?? ""),
    ),
    ...(stateId === undefined ? {} : { stateId }),
  }
}

function numberedBlock(entries: string[], maxLines = 10): RendererCode | undefined {
  if (entries.length === 0) return undefined
  return { text: entries.map((name, i) => `${i + 1}. ${name}`).join("\n"), maxLines }
}

/** One line per app/window entry: name first, detail appended. */
function entryLine(entry: unknown): string {
  if (typeof entry === "string") return oneLine(entry, 80)
  const obj = asRecord(entry)
  const name = pickStr(obj, ["name", "title", "appId", "app", "id"]) ?? jsonPreview(entry, 60)
  const detail = pickStr(obj, ["pid", "bundleId", "bundle_id", "owner"])
  return oneLine(detail === undefined ? name : `${name} (${detail})`, 80)
}

export function extractListApps(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const entries = pickArray(obj, ["apps", "windows", "items", "list", "results"])
  if (entries === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [row(FIELDS.count, entries.length)]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(`×${entries.length}`),
    numberedBlock(entries.map(entryLine)),
  )
}

export interface ScreenshotViewModel extends ToolViewModel {
  /** Renderable source (data URI / http(s) URL) — the body draws an <img>. */
  src?: string
  /** Bare path fallback when the payload references a file on disk. */
  filePath?: string
}

/** True when the source can be drawn inline (same rule as the image grid). */
export function screenshotIsRenderable(vm: ScreenshotViewModel): boolean {
  return vm.src !== undefined && isRenderableImageSrc(vm.src)
}

export function extractScreenshot(input: unknown): ScreenshotViewModel {
  const obj = asRecord(input)
  const src = pickStr(obj, ["image", "src", "url", "data", "dataUrl", "data_url", "screenshot"])
  const filePath = pickStr(obj, ["path", "file", "filePath", "file_path"])
  const width = pickNum(obj, ["width", "w"])
  const height = pickNum(obj, ["height", "h"])
  if (src === undefined && filePath === undefined && width === undefined && height === undefined) {
    return { ...emptyVm() }
  }
  const dimensions = width !== undefined && height !== undefined ? `${width}×${height}` : undefined
  const rows: Array<RendererRow | undefined> = [
    dimensions === undefined ? undefined : row(FIELDS.preview, dimensions, true),
    src === undefined ? undefined : row(FIELDS.image, oneLine(src, 96), true),
    filePath === undefined ? undefined : row(FIELDS.path, filePath, true),
  ]
  return {
    ...vmFrom(
      rows.filter((r) => r !== undefined),
      oneLine(dimensions ?? filePath ?? "screenshot"),
    ),
    ...(src === undefined ? {} : { src }),
    ...(filePath === undefined ? {} : { filePath }),
  }
}
