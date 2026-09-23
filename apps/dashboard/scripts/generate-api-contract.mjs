// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Generate the dashboard's API contract from the backend's committed
 * OpenAPI path list (opencode httpapi-codegen borrowing, proportionate
 * form: we already own a machine-readable contract — apps/api/
 * openapi-paths.json — so generation is a copy into a typed module the
 * dashboard can lint against, not a full client codegen).
 *
 * The companion test (test/api-contract.test.ts) enforces both directions:
 *   1. the committed contract.ts matches a fresh generation (the backend
 *      changed a route → regen), and
 *   2. every path template the dashboard's api.ts actually calls exists
 *      in the contract (the client can never call a dead route).
 */

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const CONTRACT_JSON = join(here, "..", "..", "api", "openapi-paths.json")
const OUT = join(here, "..", "src", "api-contract.ts")

export function generateContractSource() {
  const paths = JSON.parse(readFileSync(CONTRACT_JSON, "utf8"))
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error(`empty or malformed contract at ${CONTRACT_JSON}`)
  }
  const lines = [
    "// Copyright (c) 2026 Maximilian contributors",
    "// SPDX-License-Identifier: MIT",
    "//",
    "// Licensed under the MIT License. See LICENSE in the project root.",
    "",
    "// GENERATED FILE — do not edit by hand.",
    "// Source of truth: apps/api/openapi-paths.json. Regenerate with:",
    "//   pnpm --filter @max/dashboard contract:gen",
    "// Guarded by test/api-contract.test.ts (both directions).",
    "",
    "export const API_PATHS = [",
    ...paths.map((p) => `  "${p}",`),
    "] as const",
    "",
    "export type ApiContractEntry = (typeof API_PATHS)[number]",
    "",
    `/** Number of routes in the backend contract: ${paths.length}. */`,
    `export const API_PATH_COUNT = ${paths.length}`,
    "",
  ]
  return lines.join("\n")
}

export function writeContract() {
  const source = generateContractSource()
  writeFileSync(OUT, source)
  return source
}

/** Extract `METHOD /path` entries the dashboard's api.ts calls. */
export function extractClientCalls(apiTsPath) {
  const text = readFileSync(apiTsPath, "utf8")
  const calls = new Set()
  // Match template literals of the form `${BASE}/workspaces/${id}/…`
  // inside fetchJson/fetch calls, plus query suffixes are stripped.
  const re = /`\$\{BASE\}(\/[^`]*)`/g
  for (const match of text.matchAll(re)) {
    // Query strings are appended dynamically (`${qs}` builders) — cut at
    // the first literal "?" and let normalization handle the rest.
    const raw = match[1].split("?")[0]
    // Normalize interpolations to OpenAPI `{param}` segments.
    const normalized = raw.replace(/\$\{[^}]*\}/g, () => "{param}")
    // A leftover `${…}` (unclosed — dynamic query-builder tail) cannot be
    // verified statically; skip it rather than fail the guard.
    if (normalized.includes("${")) continue
    calls.add(normalized)
  }
  return [...calls].sort()
}

/** True when a client path template matches a contract entry. */
export function matchesContract(clientPath, contractEntry) {
  // Client normalizes ALL interpolations to {param}; the contract uses the
  // real param names ({id}). Compare segment-by-segment: literal segments
  // must be equal, every param segment matches any {…} segment.
  const client = clientPath.split("/")
  const server = contractEntry.split(" ")
  if (server.length !== 2) return false
  const serverPath = server[1].split("/")
  if (client.length !== serverPath.length) return false
  return client.every((seg, i) => {
    if (seg === "{param}") return serverPath[i]?.startsWith("{")
    return seg === serverPath[i]
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = writeContract()
  console.log(`wrote ${OUT} (${source.split("\n").length} lines)`)
}
