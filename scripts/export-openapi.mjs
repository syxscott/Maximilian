#!/usr/bin/env node
// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * export-openapi — boot the API, capture the full schema-carrying
 * OpenAPI document from GET /api/openapi.json, and persist it as
 * apps/api/openapi.json (input for generate-api-client.mjs).
 *
 * Usage: node scripts/export-openapi.mjs
 * Requires: the api process to boot cleanly (same env as `pnpm dev`).
 */

import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."))
const OUT = join(root, "apps", "api", "openapi.json")
const PORT = process.env.PORT || 3001
const URL = `http://127.0.0.1:${PORT}/api/openapi.json`

const child = spawn("node", ["--import", "tsx/esm", join(root, "apps", "api", "src", "index.ts")], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env },
})

child.stdout.on("data", () => {})
child.stderr.on("data", () => {})

async function waitForDoc(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(URL)
      if (res.ok) return await res.json()
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`openapi doc never became available at ${URL}`)
}

try {
  const doc = await waitForDoc()
  writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n")
  const paths = Object.keys(doc.paths ?? {}).length
  console.log(`wrote ${OUT} (${paths} paths)`)
} finally {
  child.kill("SIGTERM")
}
