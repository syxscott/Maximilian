#!/usr/bin/env node
// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// i18n key audit — compares translation keys used in dashboard source against
// the merged core + feature-domain dictionaries (zh-CN and en-US).
//
// Reports:
//   1. missing  — keys referenced via t("key") / tn("key") / ts("key") in
//      apps/dashboard/src that are absent from a locale's merged dictionary
//   2. unused   — dictionary keys never referenced in source (report only;
//      nothing is deleted)
//   3. keySetDiff — keys present in one locale's dictionary but not the other
//
// Usage:
//   node scripts/i18n-audit.mjs           # human-readable report
//   node scripts/i18n-audit.mjs --json    # machine-readable report on stdout
//   node scripts/i18n-audit.mjs --json --out <path>   # also write JSON file
//
// Exit codes: 0 = no missing keys and no key-set differences, 1 = findings.
// (Unused keys do NOT fail the audit.) The structured `runAudit()` export is
// consumed by apps/dashboard/test/i18n-coverage.test.ts as its assertion
// source, so the test and the CLI can never drift apart.

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SRC_DIR = join(REPO_ROOT, "apps", "dashboard", "src")
const CORE_LOCALES_DIR = join(REPO_ROOT, "packages", "i18n", "src", "locales")
const DOMAIN_LOCALES_DIR = join(REPO_ROOT, "apps", "dashboard", "src", "locales")
const AUDITED_LOCALES = ["zh-CN", "en-US"]

/** ICU-style plural suffixes used by the `tn()` helper. */
const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"]

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** Recursively collect .ts/.tsx files under `dir`. */
export function listSourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSourceFiles(full))
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out.sort()
}

/** Strip block comments so t() calls inside them are not counted. */
function stripBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
}

/**
 * Extract string-literal keys from t() / tn() / ts() calls.
 * Returns { keys: Map<key, string[]>, dynamicCalls: number } where the value
 * is the list of source files (relative to `root`) referencing the key.
 * Dynamic calls (template literals / variables) are counted but not resolved.
 */
export function extractUsedKeys(files, root) {
  const keys = new Map()
  let dynamicCalls = 0
  // Whole-word t( / tn( / ts( whose first argument is a plain string literal.
  const callRe = /(?<![A-Za-z0-9$])(?:tn|ts|t)\(\s*(["'])((?:[^"'\\\n])*)\1/g
  const dynamicRe = /(?<![A-Za-z0-9$])(?:tn|ts|t)\(\s*(?!["'`])([A-Za-z_$])/g
  for (const file of files) {
    const rel = relative(root, file)
    const text = stripBlockComments(readFileSync(file, "utf8"))
    for (const rawLine of text.split("\n")) {
      // Skip obvious comment lines (JSDoc continuations, TODOs).
      const trimmed = rawLine.trimStart()
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue
      for (const m of rawLine.matchAll(callRe)) {
        const key = m[2]
        if (!keys.has(key)) keys.set(key, [])
        keys.get(key).push(rel)
      }
      dynamicCalls += [...rawLine.matchAll(dynamicRe)].length
    }
  }
  return { keys, dynamicCalls }
}

// ---------------------------------------------------------------------------
// Dictionaries
// ---------------------------------------------------------------------------

/** Flatten a nested JSON tree to dotted keys, mirroring locales/index.ts. */
export function flattenTree(tree, prefix = "", out = new Map()) {
  for (const [key, value] of Object.entries(tree)) {
    const dotted = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      flattenTree(value, dotted, out)
    } else {
      out.set(dotted, String(value))
    }
  }
  return out
}

/**
 * Load the merged dictionary for one locale: core (@max/i18n) + every
 * apps/dashboard/src/locales/<domain>.<locale>.json file, flattened.
 */
export function loadMergedDict(locale) {
  const merged = new Map()
  const sources = []
  const corePath = join(CORE_LOCALES_DIR, `${locale}.json`)
  const core = JSON.parse(readFileSync(corePath, "utf8"))
  flattenTree(core, "", merged)
  sources.push(relative(REPO_ROOT, corePath))
  for (const entry of readdirSync(DOMAIN_LOCALES_DIR)) {
    if (!entry.endsWith(`.${locale}.json`)) continue
    const tree = JSON.parse(readFileSync(join(DOMAIN_LOCALES_DIR, entry), "utf8"))
    flattenTree(tree, "", merged)
    sources.push(relative(REPO_ROOT, join(DOMAIN_LOCALES_DIR, entry)))
  }
  return { dict: merged, sources }
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/** A plural base key is satisfied when any suffixed form exists. */
function keySatisfied(dict, key) {
  if (dict.has(key)) return true
  return PLURAL_SUFFIXES.some((form) => dict.has(`${key}.${form}`))
}

export function runAudit(opts = {}) {
  const root = opts.root ?? REPO_ROOT
  const srcDir = opts.srcDir ?? SRC_DIR
  const files = listSourceFiles(srcDir)
  const { keys: used, dynamicCalls } = extractUsedKeys(files, root)

  const perLocale = {}
  for (const locale of AUDITED_LOCALES) {
    const { dict, sources } = loadMergedDict(locale)
    const missing = []
    for (const [key, refs] of used) {
      if (!keySatisfied(dict, key)) missing.push({ key, refs: [...new Set(refs)] })
    }
    missing.sort((a, b) => a.key.localeCompare(b.key))
    const usedSet = new Set(used.keys())
    // A dict key is "used" if referenced directly, or if it is a plural form
    // of a referenced base key (tn("x") resolves to "x.one"/"x.other"/...).
    const unused = [...dict.keys()].filter(
      (k) =>
        !usedSet.has(k) &&
        !PLURAL_SUFFIXES.some(
          (form) => k.endsWith(`.${form}`) && usedSet.has(k.slice(0, -(form.length + 1))),
        ),
    )
    unused.sort((a, b) => a.localeCompare(b))
    perLocale[locale] = {
      dictSize: dict.size,
      sources,
      missing,
      unused,
    }
  }

  const zhKeys = new Set(loadMergedDict("zh-CN").dict.keys())
  const enKeys = new Set(loadMergedDict("en-US").dict.keys())
  const onlyInZh = [...zhKeys].filter((k) => !enKeys.has(k)).sort()
  const onlyInEn = [...enKeys].filter((k) => !zhKeys.has(k)).sort()

  return {
    generatedAt: new Date().toISOString(),
    srcDir: relative(root, srcDir),
    scannedFiles: files.length,
    dynamicTCalls: dynamicCalls,
    usedKeyCount: used.size,
    locales: AUDITED_LOCALES,
    perLocale,
    keySetDiff: { onlyInZh, onlyInEn },
  }
}

/** True when the audit is clean enough for CI: no missing keys, no diff. */
export function auditIsClean(report) {
  return (
    report.perLocale["zh-CN"].missing.length === 0 &&
    report.perLocale["en-US"].missing.length === 0 &&
    report.keySetDiff.onlyInZh.length === 0 &&
    report.keySetDiff.onlyInEn.length === 0
  )
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function humanReport(report) {
  const lines = []
  lines.push("i18n audit — dashboard t() key usage vs merged dictionaries")
  lines.push(
    `scanned ${report.scannedFiles} files under ${report.srcDir}; ${report.usedKeyCount} distinct literal keys (${report.dynamicTCalls} dynamic t() calls not resolved)`,
  )
  lines.push("")
  for (const locale of report.locales) {
    const { dictSize, missing, unused } = report.perLocale[locale]
    lines.push(`[${locale}] dictionary: ${dictSize} keys`)
    lines.push(`  missing (${missing.length}):`)
    for (const { key, refs } of missing) {
      lines.push(
        `    - ${key}  ←  ${refs.slice(0, 3).join(", ")}${refs.length > 3 ? ` (+${refs.length - 3})` : ""}`,
      )
    }
    lines.push(
      `  unused (${unused.length}): ${unused.slice(0, 20).join(", ")}${unused.length > 20 ? " …" : ""}`,
    )
    lines.push("")
  }
  const { onlyInZh, onlyInEn } = report.keySetDiff
  lines.push(
    `[key-set diff] zh-only (${onlyInZh.length}): ${onlyInZh.slice(0, 20).join(", ")}${onlyInZh.length > 20 ? " …" : ""}`,
  )
  lines.push(
    `[key-set diff] en-only (${onlyInEn.length}): ${onlyInEn.slice(0, 20).join(", ")}${onlyInEn.length > 20 ? " …" : ""}`,
  )
  lines.push("")
  lines.push(
    auditIsClean(report)
      ? "RESULT: clean"
      : "RESULT: findings (missing keys or key-set differences)",
  )
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function main(argv) {
  const json = argv.includes("--json")
  const outIdx = argv.indexOf("--out")
  const outPath = outIdx >= 0 ? argv[outIdx + 1] : undefined

  const report = runAudit()
  if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
  if (json) process.stdout.write(JSON.stringify(report, null, 2) + "\n")
  else process.stdout.write(humanReport(report) + "\n")
  return auditIsClean(report) ? 0 : 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)))
}
