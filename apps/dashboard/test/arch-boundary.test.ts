// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Architecture guard test (OpenHands `no-direct-agent-server-calls`
 * borrowing): dashboard components must go through the API layer
 * (`src/api.ts` `fetchJson`, or the data hooks) — never call `fetch()` or
 * open their own `EventSource`. A single chokepoint is what makes auth
 * headers, error shaping, base-URL handling and (future) generated SDK
 * clients enforceable.
 *
 * When this test fails because you genuinely need a new escape hatch,
 * extend the allowlist explicitly — never silence the check inline.
 */

import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const SRC_ROOT = join(__dirname, "..", "src")

/** Files allowed to touch the network directly. */
const ALLOWED_PREFIXES = ["api.ts", "hooks/"]

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      collectTsFiles(full, out)
    } else if (/\.(tsx?|mjs)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

const FETCH_CALL = /\bfetch\s*\(/
const EVENT_SOURCE = /\bnew\s+EventSource\b/
const RAW_XHR = /\bnew\s+XMLHttpRequest\b/

describe("dashboard API boundary", () => {
  const files = collectTsFiles(SRC_ROOT)

  it("discovers dashboard source files", () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it("routes all network access through the API layer", () => {
    const violations: string[] = []
    for (const file of files) {
      const rel = relative(SRC_ROOT, file).split(sep).join("/")
      if (ALLOWED_PREFIXES.some((p) => rel === p || rel.startsWith(p))) continue
      const text = readFileSync(file, "utf-8")
      if (FETCH_CALL.test(text) || EVENT_SOURCE.test(text) || RAW_XHR.test(text)) {
        violations.push(rel)
      }
    }
    expect(violations).toEqual([])
  })

  it("keeps src/api.ts as the fetchJson chokepoint", () => {
    const api = readFileSync(join(SRC_ROOT, "api.ts"), "utf-8")
    expect(api).toMatch(/export\s+(async\s+)?function\s+fetchJson/)
  })
})
