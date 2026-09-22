#!/usr/bin/env node
// scripts/architecture-check.mjs
//
// Machine-checkable architecture governance (ZCode borrowing:
// architecture-policy.yaml + architecture:check).
//
// Validates, against architecture-policy.yaml:
//   1. every declared module's publicEntrypoint exists on disk
//   2. no source file deep-imports another declared package's internals
//      (`@max/<mod>/src/...`) — modules may only import each other's
//      public entry
//   3. apps never import other apps
//
// Exits 1 on any violation. Add a rule here only together with the policy
// entry, and only when the tree already passes.

import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import process from "node:process"

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")

// ── minimal YAML subset parser for our flat policy shape ──
function parsePolicy(text) {
  const modules = []
  let current = null
  let inModules = false
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\t/g, "  ")
    if (/^modules:/.test(line)) {
      inModules = true
      continue
    }
    if (/^version:/.test(line) || /^globals:/.test(line)) {
      inModules = false
      continue
    }
    if (!inModules) continue
    const id = line.match(/^\s+- id: (\S+)/)
    if (id) {
      current = { id: id[1], entrypoint: null }
      modules.push(current)
      continue
    }
    const ep = line.match(/^\s+entrypoint: (\S+)/)
    if (ep && current) current.entrypoint = ep[1]
  }
  return modules
}

const policyPath = path.join(root, "architecture-policy.yaml")
const policyText = readFileSync(policyPath, "utf8")
const modules = parsePolicy(policyText)

const violations = []

// 1. entrypoints exist
for (const m of modules) {
  if (!m.entrypoint || !existsSync(path.join(root, m.entrypoint))) {
    violations.push(`module "${m.id}": entrypoint missing: ${m.entrypoint ?? "(none declared)"}`)
  }
}

// module id set for deep-import detection
const moduleIds = modules.map((m) => m.id)

// 2. no deep imports of declared packages' internals
const deepImportRe = new RegExp(
  `from ["'](@max/(?:${moduleIds.join("|")}))/(?:src|dist)/[^"']+["']`,
)

import { readdirSync, statSync } from "node:fs"
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", "dist", "coverage", ".git", ".turbo"].includes(entry)) continue
    const full = path.join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) yield* walk(full)
    else if (/\.(ts|tsx|mts|mjs)$/.test(entry)) yield full
  }
}

for (const file of walk(root)) {
  const rel = path.relative(root, file)
  if (rel.startsWith("apps") || rel.startsWith("packages") || rel.startsWith("scripts")) {
    const src = readFileSync(file, "utf8")
    for (const line of src.split("\n")) {
      const m = line.match(deepImportRe)
      if (m) {
        violations.push(`${rel}: deep import of package internals — ${m[0]} (import the public entry instead)`)
      }
    }
  }
}

// 3. apps never import other apps
const appIds = ["api", "worker", "dashboard", "tui"]
for (const app of appIds) {
  const appDir = path.join(root, "apps", app)
  if (!existsSync(appDir)) continue
  for (const file of walk(appDir)) {
    const src = readFileSync(file, "utf8")
    for (const other of appIds) {
      if (other === app) continue
      const re = new RegExp(`from ["'][^"']*apps/${other}/`)
      if (re.test(src)) {
        violations.push(`${path.relative(root, file)}: app "${app}" imports app "${other}"`)
      }
    }
  }
}

if (violations.length > 0) {
  console.error("architecture policy violations:")
  for (const v of violations) console.error("  - " + v)
  process.exit(1)
}

console.log(`architecture policy OK (${modules.length} modules)`)
