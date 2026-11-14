// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * JSON body gate (OpenAgentCore wire-semantics.md table row 5 borrowing):
 * every JSON route passes one gate — a request that declares a JSON
 * content-type and carries a body must not contain duplicate object keys
 * at ANY depth. `JSON.parse` silently collapses duplicates to the last
 * value (Hono's c.req.json() does not check), so an ambiguous payload
 * would flow into the validators with whatever value happened to win.
 *
 * Error (first repeat in document order, wire contract):
 *   400 "Invalid body: duplicate JSON key '<key>' at '<path>'. Duplicate
 *        JSON keys are not supported."
 * The path joins object keys with `.` and omits array indices, e.g.
 * `metadata.k` or `tools.type`. Keys compare after unescaping and
 * case-sensitively.
 *
 * Performance: only requests with a JSON content-type AND a body are
 * scanned, once, over the raw text (Hono bodyCache keeps the bytes for
 * the downstream validators — nothing is parsed twice). Malformed JSON is
 * NOT rejected here: the scan bails out and the route's own validator
 * produces its usual parse error.
 */

import type { Context, Next } from "hono"

export interface DuplicateKeyScan {
  /** First duplicate key's dotted path, or null when none was found. */
  readonly path: string | null
  /** False when the text is not parseable JSON (scan inconclusive). */
  readonly ok: boolean
}

export const DUPLICATE_JSON_KEY_MESSAGE_PREFIX = "Invalid body: duplicate JSON key"

/**
 * Single-pass JSON scanner that reports the first duplicate object key.
 * It walks the raw text with a recursive-descent-lite walk: strings
 * (with escape decoding for keys), literals and numbers are skipped,
 * objects track the keys already seen in THAT object, and arrays are
 * transparent (paths omit indices, per the wire contract).
 */
export function findDuplicateJsonKeyPath(text: string): DuplicateKeyScan {
  const n = text.length
  let i = 0
  let duplicatePath: string | null = null

  const skipWs = (): boolean => {
    while (i < n) {
      const ch = text[i]
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") i++
      else break
    }
    return i < n
  }

  /** Skip a string VALUE (no decoding — values are irrelevant to keys). */
  const skipString = (): boolean => {
    i++ // opening quote
    while (i < n) {
      const ch = text[i]
      if (ch === "\\") {
        i += 2
        continue
      }
      if (ch === '"') {
        i++
        return true
      }
      i++
    }
    return false
  }

  /** Read a key with escape decoding (keys compare AFTER unescaping). */
  const readKey = (): string | null => {
    i++ // opening quote
    let key = ""
    while (i < n) {
      const ch = text[i]
      if (ch === '"') {
        i++
        return key
      }
      if (ch === "\\") {
        const esc = text[i + 1]
        i += 2
        switch (esc) {
          case '"':
            key += '"'
            break
          case "\\":
            key += "\\"
            break
          case "/":
            key += "/"
            break
          case "b":
            key += "\b"
            break
          case "f":
            key += "\f"
            break
          case "n":
            key += "\n"
            break
          case "r":
            key += "\r"
            break
          case "t":
            key += "\t"
            break
          case "u": {
            const hex = text.slice(i, i + 4)
            const code = Number.parseInt(hex, 16)
            if (Number.isNaN(code)) return null
            key += String.fromCharCode(code)
            i += 4
            break
          }
          default:
            return null
        }
        continue
      }
      key += ch
      i++
    }
    return null
  }

  /** Skip and validate a non-structural value (number / true / false / null). */
  const skipLiteral = (): boolean => {
    const start = i
    while (i < n) {
      const ch = text[i]
      if (
        ch === "," ||
        ch === "}" ||
        ch === "]" ||
        ch === " " ||
        ch === "\t" ||
        ch === "\n" ||
        ch === "\r"
      ) {
        break
      }
      i++
    }
    const token = text.slice(start, i)
    if (
      token === "true" ||
      token === "false" ||
      token === "null" ||
      /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(token)
    ) {
      return true
    }
    return false
  }

  const parseValue = (path: string): boolean => {
    if (!skipWs()) return false
    const ch = text[i]
    if (ch === '"') return skipString()
    if (ch === "{") return parseObject(path)
    if (ch === "[") return parseArray(path)
    return skipLiteral()
  }

  const parseObject = (path: string): boolean => {
    i++ // {
    if (!skipWs()) return false
    if (text[i] === "}") {
      i++
      return true
    }
    const keys = new Set<string>()
    for (;;) {
      if (!skipWs() || text[i] !== '"') return false
      const key = readKey()
      if (key === null) return false
      if (keys.has(key)) {
        // First repeat in document order wins (wire contract).
        duplicatePath = path ? `${path}.${key}` : key
        return false
      }
      keys.add(key)
      if (!skipWs() || text[i] !== ":") return false
      i++
      if (!parseValue(path ? `${path}.${key}` : key)) return false
      if (!skipWs()) return false
      if (text[i] === ",") {
        i++
        continue
      }
      if (text[i] === "}") {
        i++
        return true
      }
      return false
    }
  }

  const parseArray = (path: string): boolean => {
    i++ // [
    if (!skipWs()) return false
    if (text[i] === "]") {
      i++
      return true
    }
    for (;;) {
      // Elements keep the parent path — array indices are omitted.
      if (!parseValue(path)) return false
      if (!skipWs()) return false
      if (text[i] === ",") {
        i++
        continue
      }
      if (text[i] === "]") {
        i++
        return true
      }
      return false
    }
  }

  const ok = parseValue("")
  // A duplicate short-circuits the walk (ok=false) — surface it, and only
  // it; a malformed document without a duplicate is the validator's job.
  if (duplicatePath !== null) return { path: duplicatePath, ok: true }
  return { path: null, ok }
}

export interface JsonBodyGateOptions {
  /**
   * Extra paths exempt from the gate (matched against the request path).
   * The probes never carry JSON bodies, but explicit exemptions keep the
   * gate honest if that ever changes.
   */
  exempt?: (path: string) => boolean
}

/** Methods whose requests may carry a JSON body worth gating. */
const GATED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

export function jsonBodyGate(opts?: JsonBodyGateOptions) {
  return async (c: Context, next: Next) => {
    if (!GATED_METHODS.has(c.req.method)) return next()
    if (opts?.exempt?.(c.req.path)) return next()
    const contentType = (c.req.header("content-type") ?? "").toLowerCase()
    if (!contentType.includes("application/json")) return next()

    let text = ""
    try {
      // Cached by Hono (bodyCache): downstream c.req.json() in the route
      // validators reuses these bytes instead of re-reading the stream.
      text = await c.req.text()
    } catch {
      return next() // unreadable body — let the route handle it
    }
    if (text.length === 0) return next()

    const scan = findDuplicateJsonKeyPath(text)
    if (scan.path !== null) {
      const key = scan.path.slice(scan.path.lastIndexOf(".") + 1)
      return c.json(
        {
          error: "invalid_request",
          message:
            `${DUPLICATE_JSON_KEY_MESSAGE_PREFIX} '${key}' at '${scan.path}'. ` +
            "Duplicate JSON keys are not supported.",
          path: scan.path,
        },
        400,
      )
    }
    await next()
  }
}
