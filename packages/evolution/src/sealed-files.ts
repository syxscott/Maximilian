// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Sealed files — tamper-evidence for the evolution evaluation loop.
 *
 * Borrowed from oh-my-claudecode `skills/self-improve`: benchmark files are
 * *sealed* — the evolution loop may read them for scoring but must never
 * modify them, and validation refuses to promote a candidate if a seal
 * broke. Without this, an evolution loop that (directly or through a
 * candidate prompt that instructs agents to "fix the failing test") edits
 * its own benchmark quietly stops measuring anything.
 *
 * Maximilian's adaptation: a `SealedFileVault` that snapshots SHA-256
 * hashes of every file matching a set of glob patterns (`seal`), and later
 * re-checks them (`verify`). `guard(fn)` wraps an evolution operation:
 * verify → run → verify again, throwing `SealedFileViolationError` if any
 * sealed file was created/modified/deleted while `fn` ran.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { writeFileAtomic } from "./atomic.js"

/** Directories never walked when sealing (build output, VCS, deps, our own manifest). */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".turbo", "coverage"])

export interface SealManifest {
  version: 1
  createdAt: string
  /** Glob patterns this manifest covers. */
  patterns: string[]
  /** Relative posix path → sha256(content). */
  files: Record<string, string>
}

export type SealViolationKind = "modified" | "missing" | "unsealed"

export interface SealViolation {
  kind: SealViolationKind
  /** Repo-relative posix path of the offending file. */
  file: string
  detail: string
}

export class SealedFileViolationError extends Error {
  readonly violations: SealViolation[]

  constructor(violations: SealViolation[]) {
    const lines = violations.map((v) => `  ${v.kind}: ${v.file} — ${v.detail}`)
    super(
      `Sealed files violated (${violations.length}):\n${lines.join("\n")}\n` +
        `The evaluation corpus must stay frozen across an evolution step; ` +
        `restore the files (git checkout) before promoting any candidate.`,
    )
    this.name = "SealedFileViolationError"
    this.violations = violations
  }
}

export interface SealedFileVaultOptions {
  /** Manifest file name, written inside `rootDir`. Default `.evolution-seals.json`. */
  manifestFile?: string
}

export class SealedFileVault {
  private readonly manifestPath: string

  constructor(
    private readonly rootDir: string,
    opts: SealedFileVaultOptions = {},
  ) {
    this.manifestPath = path.join(rootDir, opts.manifestFile ?? ".evolution-seals.json")
  }

  /**
   * Snapshot hashes of every file under `rootDir` matching `patterns` and
   * persist the manifest. Re-sealing overwrites the previous manifest.
   */
  async seal(patterns: string[]): Promise<SealManifest> {
    const files = await this.collect(patterns)
    const hashes: Record<string, string> = {}
    for (const rel of files) {
      hashes[rel] = await hashFile(path.join(this.rootDir, rel))
    }
    const manifest: SealManifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      patterns,
      files: hashes,
    }
    await writeFileAtomic(this.manifestPath, JSON.stringify(manifest, null, 2))
    return manifest
  }

  /**
   * Compare the on-disk state against the manifest.
   * - a sealed file whose hash changed → `modified`
   * - a sealed file that disappeared → `missing`
   * - a file matching the patterns that the manifest does not know → `unsealed`
   * Returns violations sorted by kind then path; empty means seals hold.
   */
  async verify(): Promise<SealViolation[]> {
    const manifest = await this.readManifest()
    const current = await this.collect(manifest.patterns)
    const violations: SealViolation[] = []

    for (const [rel, sealedHash] of Object.entries(manifest.files)) {
      const abs = path.join(this.rootDir, rel)
      let now: string | undefined
      try {
        now = await hashFile(abs)
      } catch {
        now = undefined
      }
      if (now === undefined) {
        violations.push({ kind: "missing", file: rel, detail: "sealed file no longer exists" })
      } else if (now !== sealedHash) {
        violations.push({ kind: "modified", file: rel, detail: "content hash differs from seal" })
      }
    }
    for (const rel of current) {
      if (!(rel in manifest.files)) {
        violations.push({
          kind: "unsealed",
          file: rel,
          detail: "file matches sealed patterns but is absent from the manifest",
        })
      }
    }
    violations.sort((a, b) =>
      a.kind === b.kind ? a.file.localeCompare(b.file) : a.kind.localeCompare(b.kind),
    )
    return violations
  }

  /** True when `verify()` is clean. */
  async isIntact(): Promise<boolean> {
    return (await this.verify()).length === 0
  }

  /**
   * Run `fn` under seal protection: verify before (fail fast if already
   * broken), run, verify again. Any post-run violation aborts the caller —
   * the evolution result must not be trusted when the corpus moved.
   */
  async guard<T>(fn: () => Promise<T>): Promise<T> {
    const pre = await this.verify()
    if (pre.length > 0) {
      throw new SealedFileViolationError(pre)
    }
    const out = await fn()
    const post = await this.verify()
    if (post.length > 0) {
      throw new SealedFileViolationError(post)
    }
    return out
  }

  async readManifest(): Promise<SealManifest> {
    const raw = await fs.readFile(this.manifestPath, "utf-8")
    const manifest = JSON.parse(raw) as SealManifest
    if (manifest.version !== 1 || typeof manifest.files !== "object") {
      throw new Error(`SealedFileVault: unreadable manifest at ${this.manifestPath}`)
    }
    return manifest
  }

  // ── internals ───────────────────────────────────────────────────────────

  /** Walk `rootDir` and return matching repo-relative posix paths, sorted. */
  private async collect(patterns: string[]): Promise<string[]> {
    const matched = new Set<string>()
    const compiled = patterns.map(compileGlob)
    const walk = async (dir: string): Promise<void> => {
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return // missing subtree simply matches nothing
      }
      for (const entry of entries) {
        if (entry.name === path.basename(this.manifestPath) && dir === this.rootDir) continue
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue
          await walk(abs)
          continue
        }
        if (!entry.isFile()) continue
        const rel = path.relative(this.rootDir, abs).split(path.sep).join("/")
        if (compiled.some((re) => re.test(rel))) matched.add(rel)
      }
    }
    await walk(this.rootDir)
    return [...matched].sort()
  }
}

async function hashFile(abs: string): Promise<string> {
  const buf = await fs.readFile(abs)
  return createHash("sha256").update(buf).digest("hex")
}

/**
 * Minimal glob → RegExp. Supports `**` (any path segments), `*` (within one
 * segment) and `?` (one char). A trailing `/` means "everything below".
 * Deliberately dependency-free — the vault only needs repo-internal paths.
 */
export function compileGlob(pattern: string): RegExp {
  let p = pattern.replace(/^\.\//, "")
  if (p.endsWith("/")) p += "**"
  let re = ""
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === "*") {
      if (p[i + 1] === "*") {
        // `**/` matches zero or more leading segments; `**` otherwise.
        if (p[i + 2] === "/") {
          re += "(?:.*/)?"
          i += 2
        } else {
          re += ".*"
          i += 1
        }
      } else {
        re += "[^/]*"
      }
    } else if (c === "?") {
      re += "[^/]"
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    }
  }
  return new RegExp(`^${re}$`)
}
