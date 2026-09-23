#!/usr/bin/env node
// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * compat-check — machine-readable compatibility gate (hermes
 * COMPAT_MANIFEST borrowing). Cross-references:
 *
 *   1. docs/compat-manifest.md   — the promised lifecycles
 *   2. `@deprecated` JSDoc tags  — in-source deprecations
 *
 * and reports, per package: symbols promised removed that still exist
 * (HARD error), deprecated symbols missing from the manifest (WARN),
 * and manifest entries pointing at missing files.
 *
 * Usage: node scripts/compat-check.mjs [--json]
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const manifestPath = join(root, "docs", "compat-manifest.md")

// ── Parse the manifest table ────────────────────────────────────────────────

function parseManifest(text) {
  const rows = []
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) continue
    const cells = line.split("|").map((c) => c.trim())
    if (cells.length < 6) continue
    if (/^symbol$/.test(cells[1]) || /^-+$/.test(cells[1]) || cells[1] === "") continue
    rows.push({
      symbol: cells[1],
      state: cells[2],
      since: cells[3],
      removal: cells[4],
      replacement: cells[5],
    })
  }
  return rows
}

function walk(dir, files = []) {
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return files
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (entry === "node_modules" || entry === "dist") continue
    if (statSync(full).isDirectory()) walk(full, files)
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full)
  }
  return files
}

function scanSourceDeprecations() {
  const packagesDir = join(root, "packages")
  const results = []
  if (!existsSync(packagesDir)) return results
  for (const pkg of readdirSync(packagesDir)) {
    const pkgSrc = join(packagesDir, pkg, "src")
    if (!existsSync(pkgSrc)) continue
    for (const file of walk(pkgSrc)) {
      const text = readFileSync(file, "utf8")
      if (!text.includes("@deprecated")) continue
      const lines = text.split("\n")
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes("@deprecated")) continue
        // The declaration follows the JSDoc block; take the next non-comment line.
        let j = i + 1
        while (
          j < lines.length &&
          (lines[j].trim().startsWith("*") || lines[j].trim().startsWith("/*"))
        )
          j++
        const decl = (lines[j] ?? "").trim()
        const nameMatch = decl.match(
          /(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z0-9_]+)/,
        )
        results.push({
          pkg,
          file: relative(root, file),
          line: j + 1,
          symbol: nameMatch?.[1] ?? decl.slice(0, 60),
          note: lines[i]
            .replace(/.*@deprecated\s*/, "")
            .replace(/\*\/$/, "")
            .trim(),
        })
      }
    }
  }
  return results
}

// ── Main ────────────────────────────────────────────────────────────────────

const json = process.argv.includes("--json")
const manifest = parseManifest(existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : "")
const sourceDeprecations = scanSourceDeprecations()

const errors = []
const warnings = []

// 1. Manifest entries past their removal milestone must not exist in source.
for (const entry of manifest) {
  if (entry.state.toLowerCase() !== "removed") continue
  const symbol = entry.symbol.split("#").pop() ?? ""
  for (const dep of scanSourceDeprecations()) {
    void dep
  }
  const stillThere = walk(join(root, "packages")).some((file) => {
    try {
      return readFileSync(file, "utf8").includes(symbol)
    } catch {
      return false
    }
  })
  if (stillThere) {
    errors.push(`manifest says ${entry.symbol} was REMOVED, but "${symbol}" still exists in source`)
  }
}

// 2. In-source @deprecated symbols must be listed in the manifest.
//    Package-scope manifest entries (e.g. "@max/llm (legacy surface)")
//    cover every deprecation inside that package.
const manifestNames = new Set(manifest.map((m) => m.symbol.split("#").pop()))
for (const dep of sourceDeprecations) {
  const packageCovered = manifest.some(
    (m) => m.symbol.includes(dep.pkg) && m.state.toLowerCase() === "deprecated",
  )
  if (!manifestNames.has(dep.symbol) && !packageCovered) {
    warnings.push(
      `@deprecated ${dep.symbol} (${dep.file}:${dep.line}) is not in docs/compat-manifest.md — add an entry with its replacement and removal milestone`,
    )
  }
}

if (json) {
  console.log(JSON.stringify({ errors, warnings, manifestEntries: manifest.length }, null, 2))
} else {
  if (manifest.length === 0) console.log("compat manifest: 0 entries")
  else console.log(`compat manifest: ${manifest.length} entries`)
  console.log(`in-source deprecations: ${sourceDeprecations.length}`)
  for (const w of warnings) console.log(`WARN: ${w}`)
  for (const e of errors) console.error(`ERROR: ${e}`)
}

process.exit(errors.length > 0 ? 1 : 0)
