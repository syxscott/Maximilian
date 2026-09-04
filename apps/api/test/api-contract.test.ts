// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * API contract guard (opencode httpapi-codegen borrowing, adapted): the
 * route list in `openapi-paths.json` is the committed contract. Any new,
 * removed or reshaped endpoint shows up here as a diff the reviewer must
 * approve — and the SDK/consumers get updated in the same change instead
 * of drifting silently.
 *
 * After an intentional change, run: pnpm --filter @max/api contract:update
 */

import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const ROUTES_DIR = join(__dirname, "..", "src", "routes")
const SNAPSHOT = join(__dirname, "..", "openapi-paths.json")

const METHOD_PATH = /method:\s*"(get|post|put|delete|patch)"[^}]*?path:\s*"([^"]+)"/g

function scanLiveRoutes(): string[] {
  const entries = new Set<string>()
  for (const file of readdirSync(ROUTES_DIR).sort()) {
    if (!file.endsWith(".ts")) continue
    const text = readFileSync(join(ROUTES_DIR, file), "utf-8")
    for (const m of text.matchAll(METHOD_PATH)) {
      entries.add(`${m[1].toUpperCase()} ${m[2]}`)
    }
  }
  return [...entries].sort()
}

describe("API contract snapshot", () => {
  it("matches the committed openapi-paths.json", () => {
    const live = scanLiveRoutes()
    const committed: string[] = JSON.parse(readFileSync(SNAPSHOT, "utf-8"))

    const added = live.filter((r) => !committed.includes(r))
    const removed = committed.filter((r) => !live.includes(r))

    if (added.length > 0 || removed.length > 0) {
      const parts = [
        added.length > 0 ? `added: ${added.join(", ")}` : undefined,
        removed.length > 0 ? `removed: ${removed.join(", ")}` : undefined,
        "If intentional, update the snapshot with: pnpm --filter @max/api contract:update",
      ].filter(Boolean)
      throw new Error(`API contract drift.\n${parts.join("\n")}`)
    }
    expect(live).toEqual(committed)
  })

  it("snapshot covers a meaningful API surface", () => {
    const committed: string[] = JSON.parse(readFileSync(SNAPSHOT, "utf-8"))
    expect(committed.length).toBeGreaterThan(30)
  })
})
