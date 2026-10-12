// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Docs-drift ratchet (hermes 4e8fe569e4 + 7bc05085f0 borrowing): every
 * config key in packages/config/src/schema.ts must be documented in docs/.
 *
 * A key counts as documented when the docs mention it verbatim (prose, a
 * table row, or a `KEY=value` example line), or when a placeholder code
 * span covers it (`EVOLUTION_*`, `MAXIMILIAN_<NAME>_PATH`). What was
 * undocumented when the ratchet landed lives in
 * scripts/docs-drift-baseline.json; only NEW gaps fail, so the gate never
 * blocks an unrelated PR, and documenting a baselined key never fails
 * (`--update` prunes the baseline). Deterministic, no network.
 *
 *   pnpm docs:drift:check            # exit 1 on new undocumented keys
 *   pnpm docs:drift:update           # rewrite the baseline to current gaps
 *   tsx scripts/check-docs-drift.ts --self-test  # ratchet semantics check
 */

import { existsSync, readFileSync } from "node:fs"
import { readdir, readFile, writeFile, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { ConfigSchema } from "../packages/config/src/schema.ts"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DOCS = path.join(ROOT, "docs")
const BASELINE = path.join(ROOT, "scripts", "docs-drift-baseline.json")

/** Every config leaf key, from the zod schema itself (not a regex copy). */
export function configKeys(): string[] {
  return Object.keys(ConfigSchema.shape).sort()
}

async function docsFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await docsFiles(full)))
    else if (/\.(md|mdx)$/.test(entry.name)) out.push(full)
  }
  return out.sort()
}

/**
 * Placeholder code spans: `EVOLUTION_*` / `MAXIMILIAN_<NAME>_PATH` style —
 * an underscore-separated skeleton with one wildcard segment covers every
 * key that matches it. Repeated wildcards are fine (hermes 7bc05085f0: a
 * second `<...>` segment must not end the pattern).
 */
function placeholderPatterns(text: string): RegExp[] {
  const patterns: RegExp[] = []
  for (const span of text.matchAll(/`([^`\n]+)`/g)) {
    const skeleton = span[1]!.trim()
    if (!/^[A-Z][A-Z0-9_]*(\*|<[a-z-]+>)([A-Z0-9_]*(\*|<[a-z-]+>))*$/.test(skeleton)) continue
    const source = skeleton
      .replaceAll("*", "[A-Z0-9_]+")
      .replace(/<([a-z-]+)>/g, "[A-Z0-9]+")
      .replaceAll("[A-Z0-9_]+", "_?[A-Z0-9]+_?")
    patterns.push(new RegExp(`^${source}$`))
  }
  return patterns
}

export interface DocsDriftResult {
  documented: string[]
  undocumented: string[]
}

export function findGaps(keys: string[], docsText: string): DocsDriftResult {
  const placeholders = placeholderPatterns(docsText)
  const documented: string[] = []
  const undocumented: string[] = []
  for (const key of keys) {
    // Verbatim token mention: prose, a table row, or a KEY=value example.
    if (new RegExp(`(?<![\\w])${key}(?![\\w])`).test(docsText)) {
      documented.push(key)
      continue
    }
    if (placeholders.some((re) => re.test(key))) {
      documented.push(key)
      continue
    }
    undocumented.push(key)
  }
  return { documented, undocumented }
}

function loadBaseline(): { config: string[] } {
  if (!existsSync(BASELINE)) return { config: [] }
  return JSON.parse(readFileSync(BASELINE, "utf-8"))
}

function failureMessage(newGaps: string[]): string {
  const lines = [
    "Undocumented config keys (docs drift ratchet):",
    "  document each key in docs/ (prose, a table row, or a KEY=value example),",
    "  or cover it with a placeholder code span like `EVOLUTION_*`.",
    "  Deliberately undocumented? `pnpm docs:drift:update` adds it to the",
    "  baseline; reviewers see that in the diff.",
  ]
  for (const key of newGaps) lines.push(`  ${key}`)
  return lines.join("\n")
}

async function currentGaps(): Promise<DocsDriftResult> {
  const files = await docsFiles(DOCS)
  const text = (await Promise.all(files.map((f) => readFile(f, "utf-8")))).join("\n")
  return findGaps(configKeys(), text)
}

async function check(): Promise<number> {
  const { undocumented } = await currentGaps()
  const baseline = new Set(loadBaseline().config)
  const newGaps = undocumented.filter((key) => !baseline.has(key))
  const pruned = [...baseline].filter((key) => !undocumented.includes(key))
  if (pruned.length > 0) {
    console.log(
      `note: ${pruned.length} baselined key(s) now documented or removed; ` +
        "`pnpm docs:drift:update` shrinks the baseline",
    )
  }
  if (newGaps.length > 0) {
    console.error(failureMessage(newGaps))
    return 1
  }
  console.log(
    `docs drift: ok (${undocumented.length} keys still baselined, ` +
      `${documentedCount(await currentGaps())} documented)`,
  )
  return 0
}

function documentedCount(result: DocsDriftResult): number {
  return result.documented.length
}

async function update(): Promise<number> {
  const { undocumented } = await currentGaps()
  await writeFile(BASELINE, JSON.stringify({ config: undocumented }, null, 2) + "\n", "utf-8")
  console.log(`baseline: ${undocumented.length} undocumented config keys`)
  return 0
}

/** The ratchet's self-test: only NEW gaps fail; baselined or fixed never do. */
export async function selfTest(): Promise<number> {
  const keys = ["ALPHA_ONE", "ALPHA_TWO", "BETA_ONE"]
  const checks: Array<[string, string[], string[], string[], boolean]> = [
    // [name, docsText, baseline, expectNewGaps, shouldFail]
    ["a fully documented schema passes", ["ALPHA_ONE", "ALPHA_TWO", "BETA_ONE"], [], [], false],
    [
      "a NEW undocumented key fails even with a baseline",
      ["ALPHA_ONE"],
      ["ALPHA_TWO"],
      ["BETA_ONE"],
      true,
    ],
    ["a baselined key alone never fails", ["ALPHA_ONE"], ["ALPHA_TWO", "BETA_ONE"], [], false],
    [
      "documenting a baselined key never fails",
      ["ALPHA_ONE", "ALPHA_TWO", "BETA_ONE"],
      ["ALPHA_TWO", "BETA_ONE"],
      [],
      false,
    ],
    [
      "a placeholder span covers wildcarded keys",
      ["`BETA_*`", "ALPHA_ONE", "ALPHA_TWO"],
      [],
      [],
      false,
    ],
  ]
  let failures = 0
  for (const [name, docs, baseline, expectNew, shouldFail] of checks) {
    const gaps = findGaps(keys, docs.join("\n"))
    const baselineSet = new Set(baseline)
    const newGaps = gaps.undocumented.filter((key) => !baselineSet.has(key))
    const failed = newGaps.length > 0
    const ok = failed === shouldFail && JSON.stringify(newGaps) === JSON.stringify(expectNew)
    if (!ok) {
      failures++
      console.error(
        `self-test FAILED: ${name} (newGaps=${JSON.stringify(newGaps)}, failed=${failed})`,
      )
    } else {
      console.log(`self-test ok: ${name}`)
    }
  }
  // The example-nesting path: a fence line `KEY=value` counts as a mention.
  const gaps = findGaps(["ALPHA_ONE"], "```bash\nALPHA_ONE=1\n```")
  if (gaps.undocumented.length !== 0) {
    failures++
    console.error("self-test FAILED: a KEY=value example line does not count as documented")
  } else {
    console.log("self-test ok: a KEY=value example line documents the key")
  }
  // The temp-dir exercise proves the file-level flow end to end.
  const tmp = await mkdtemp(path.join(os.tmpdir(), "docs-drift-selftest-"))
  try {
    await writeFile(path.join(tmp, "config.md"), "# config\n\n`ALPHA_TWO`\n", "utf-8")
    const text = await readFile(path.join(tmp, "config.md"), "utf-8")
    const gaps = findGaps(keys, text)
    if (gaps.documented.length !== 1 || gaps.undocumented.length !== 2) {
      failures++
      console.error(`self-test FAILED: file-level gap detection (${JSON.stringify(gaps)})`)
    } else {
      console.log("self-test ok: file-level gap detection")
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
  if (failures > 0) {
    console.error(`self-test: ${failures} failure(s)`)
    return 1
  }
  console.log("self-test: all ratchet semantics hold")
  return 0
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--self-test")) return selfTest()
  if (argv.includes("--update")) return update()
  return check()
}

const invokedDirectly = import.meta.url === `file://${path.resolve(process.argv[1] ?? "")}`
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exit(code)
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
}
