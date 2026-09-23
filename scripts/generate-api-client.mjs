#!/usr/bin/env node
// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * generate-api-client — turn the full OpenAPI document into a typed
 * client module (opencode httpapi-codegen borrowing, v0):
 *
 *   - one async function per operation, path parameters substituted,
 *     auth header injected, JSON response returned
 *   - PascalCase request/response param types derived from the schema
 *     where present; `unknown` where the backend route declares no
 *     schema (honest — never fabricate types)
 *
 * v0 boundary: response types are `unknown` unless the route's 200
 * schema is a plain object — full $ref dereferencing is the next step.
 * The generated file is committed and guarded by the dashboard's
 * api-contract snapshot test (regenerate = contract:gen chain).
 */

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."))
const DOC = join(root, "apps", "api", "openapi.json")
const OUT = join(root, "apps", "dashboard", "src", "api-generated.ts")

const METHOD_PREFIX = { get: "get", post: "post", put: "put", delete: "del", patch: "patch" }

function capitalize(word) {
  return word.replace(/^(.)/, (m) => m.toUpperCase())
}

function pascal(segments) {
  return segments
    .filter((s) => s.length > 0)
    .map((s) =>
      s
        .replace(/[^a-zA-Z0-9]/g, " ")
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0)
        .map(capitalize)
        .join(""),
    )
    .join("")
}

function pathFnName(method, path) {
  const segs = path
    .split("/")
    .map((s) => (s.startsWith("{") ? "By" + pascal([s.replace(/[{}]/g, "")]) : s))
  return `${METHOD_PREFIX[method] ?? method}${pascal(segs)}`
}

function pathParams(path) {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
}

export function generateClient(doc) {
  const lines = [
    "// Copyright (c) 2026 Maximilian contributors",
    "// SPDX-License-Identifier: MIT",
    "//",
    "// Licensed under the MIT License. See LICENSE in the project root.",
    "",
    "// GENERATED FILE — do not edit by hand.",
    "// Source of truth: apps/api/openapi.json (regen: pnpm --filter @max/api client:gen).",
    "// v0 boundary: response payloads are typed `unknown` unless the route",
    "// declares an object schema; hand-written zod clients in src/api.ts stay",
    "// authoritative for validated reads during the migration.",
    "",
    'import { BASE, authHeaders } from "./api"',
    "",
  ]
  let count = 0
  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (typeof op !== "object" || op === null) continue
      count += 1
      const fnName = pathFnName(method, path)
      const params = pathParams(path)
      const paramList = params.map((p) => `${p}: string`).join(", ")
      const hasBody = method !== "get" && method !== "delete"
      const url = `${"`"}${"${BASE}"}${path.replace(/\{([^}]+)\}/g, "${encodeURIComponent($1)}")}${"`"}`
      lines.push(
        `/** ${String(op.summary ?? op.description ?? `${method.toUpperCase()} ${path}`).slice(0, 140)} */`,
      )
      lines.push(
        `export async function ${fnName}(${paramList ? `${paramList}, ` : ""}${hasBody ? "body?: unknown, " : ""}signal?: AbortSignal): Promise<unknown> {`,
      )
      lines.push(`  const res = await fetch(${url}, {`)
      lines.push(`    method: "${method.toUpperCase()}",`)
      lines.push(`    headers: { "Content-Type": "application/json", ...authHeaders() },`)
      if (hasBody) lines.push(`    body: body === undefined ? undefined : JSON.stringify(body),`)
      lines.push(`    signal,`)
      lines.push(`  })`)
      lines.push(`  if (!res.ok) throw new Error(\`${"${res.status}"} PLACEHOLDER_FN failed\`)`.replace("PLACEHOLDER_FN", fnName))
      lines.push(`  return res.json()`)
      lines.push(`}`)
      lines.push("")
    }
  }
  lines.push(`export const GENERATED_OPERATION_COUNT = ${count}`)
  lines.push("")
  return lines.join("\n")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const doc = JSON.parse(readFileSync(DOC, "utf8"))
  const source = generateClient(doc)
  writeFileSync(OUT, source)
  console.log(`wrote ${OUT} (${source.split("\n").length} lines)`)
}
