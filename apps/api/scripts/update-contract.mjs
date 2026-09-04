#!/usr/bin/env node
// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Regenerate the API contract snapshot (openapi-paths.json).
 *
 * The snapshot lists every route registered via `createRoute()` in
 * src/routes/*.ts. `test/api-contract.test.ts` compares the live scan
 * against it, so adding/removing an endpoint always lands as a conscious,
 * reviewable contract change (opencode httpapi-codegen borrowing, adapted:
 * the spec is the contract, CI fails on drift).
 *
 * Usage: node scripts/update-contract.mjs   (or: pnpm --filter @max/api contract:update)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const routesDir = join(here, "..", "src", "routes")
const outFile = join(here, "..", "openapi-paths.json")

const METHOD_PATH = /method:\s*"(get|post|put|delete|patch)"[^}]*?path:\s*"([^"]+)"/g

const entries = new Set()
for (const file of readdirSync(routesDir).sort()) {
  if (!file.endsWith(".ts")) continue
  const text = readFileSync(join(routesDir, file), "utf-8")
  for (const m of text.matchAll(METHOD_PATH)) {
    entries.add(`${m[1].toUpperCase()} ${m[2]}`)
  }
}

const list = [...entries].sort()
writeFileSync(outFile, `${JSON.stringify(list, null, 2)}\n`)
console.log(`wrote ${list.length} routes to ${relative(process.cwd(), outFile) || outFile}`)
