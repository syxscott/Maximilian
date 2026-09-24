// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Browser-automation tool model layer: browser-navigate, browser-action —
 * the control-browser surface (distinct from the OS-level computer-use
 * family: a session-scoped browser, so the session id is a first-class
 * field). extractBrowserNavigate keys on url/title/session,
 * extractBrowserAction on the act verb (click/type/fill/press/…), its
 * selector and the typed text; host derivation reuses web.model.ts
 * urlHost.
 */

import {
  FIELDS,
  asRecord,
  emptyVm,
  oneLine,
  pickNum,
  pickStr,
  row,
  vmFrom,
  type RendererRow,
  type ToolViewModel,
} from "./shared.model"
import { urlHost } from "./web.model"

export function extractBrowserNavigate(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const url = pickStr(obj, ["url", "href", "target", "uri"])
  const title = pickStr(obj, ["title", "pageTitle", "page_title"])
  const session = pickStr(obj, ["sessionId", "session_id", "session", "tabId", "tab_id"])
  const status = pickNum(obj, ["status", "statusCode", "status_code"])
  if (url === undefined && title === undefined && session === undefined) return emptyVm()
  const host = url === undefined ? undefined : urlHost(url)
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.url, url, true),
    row(FIELDS.host, host),
    row(FIELDS.title, title),
    session === undefined ? undefined : row(FIELDS.session, session, true),
    status === undefined ? undefined : row(FIELDS.status, status),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(host ?? url ?? title ?? ""),
  )
}

export function extractBrowserAction(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const method = pickStr(obj, ["action", "method", "type", "op", "name"])
  const selector = pickStr(obj, ["selector", "target", "element", "ref", "role"])
  const text = pickStr(obj, ["text", "value", "content", "query"])
  const session = pickStr(obj, ["sessionId", "session_id", "session", "tabId", "tab_id"])
  if (method === undefined && selector === undefined && text === undefined) return emptyVm()
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.method, method),
    row(FIELDS.selector, selector, true),
    row(FIELDS.text, text),
    session === undefined ? undefined : row(FIELDS.session, session, true),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine([method, selector].filter((p) => p !== undefined).join(" · ")),
  )
}
