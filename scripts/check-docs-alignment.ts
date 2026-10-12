// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Docs-alignment guard (agentos 4e1e79f4 borrowing) — the cheap drift gate
 * for the surfaces most likely to rot:
 *
 *   1. Every relative markdown link in README.md and docs/ (recursive)
 *      resolves to an existing file (no dangling references).
 *   2. Every "packages/<name>" path mentioned in README.md exists.
 *
 * Deliberately NOT checked here (they have their own gates): config-key
 * documentation coverage (docs:drift:check) and prompt surfaces
 * (prompt-surface:check). Exit 1 with a list on any violation.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, dirname, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const violations: string[] = []

function walkMarkdown(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "storybook") continue
      walkMarkdown(full, out)
    } else if (entry.endsWith(".md")) {
      out.push(full)
    }
  }
  return out
}

const files = [join(root, "README.md"), ...walkMarkdown(join(root, "docs"))]
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g

for (const file of files) {
  if (!existsSync(file)) {
    violations.push(`missing docs file referenced by the guard itself: ${file}`)
    continue
  }
  const text = readFileSync(file, "utf-8")
  for (const match of text.matchAll(LINK_RE)) {
    const target = match[1]
    if (
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("#") ||
      target.startsWith("mailto:")
    ) {
      continue
    }
    const withoutAnchor = target.split("#")[0]
    if (withoutAnchor.length === 0) continue
    const resolved = resolve(dirname(file), withoutAnchor)
    if (!existsSync(resolved)) {
      violations.push(`${file}: dangling link -> ${target}`)
    }
  }
}

const readme = readFileSync(join(root, "README.md"), "utf-8")
for (const match of readme.matchAll(/`packages\/([a-z0-9-]+)`/g)) {
  if (!existsSync(join(root, "packages", match[1]))) {
    violations.push(`README.md: mentions packages/${match[1]} which does not exist`)
  }
}

if (violations.length > 0) {
  console.error(`docs-alignment: ${violations.length} violation(s):`)
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}
console.log(`docs-alignment OK (${files.length} markdown files checked)`)
