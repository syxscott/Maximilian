// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Git shadow commits: snapshot-and-rollback for batched workspace writes
 * (oh-my-claudecode checkpoint borrowing, reworked onto Maximilian's
 * async/workspace conventions).
 *
 * A shadow commit captures the full working tree (tracked, modified, and
 * untracked-but-not-ignored files) into a commit object stored under
 * `refs/maximilian/shadow/<sha>`. It never touches HEAD, the real index,
 * or any regular ref — snapshots are cheap (no file copying), complete
 * (untracked files included), and invisible to `git log`. `rollbackToShadow`
 * restores worktree + index from a snapshot and removes files created after
 * it (`git clean -fd`, which keeps ignored paths like node_modules).
 *
 * The ref namespace is bounded: only the most recent `keep` snapshots
 * (default 5) survive; older ones are LRU-evicted via `git update-ref -d`.
 *
 * Ordering: git commit timestamps have second resolution, so two snapshots
 * in the same second would tie under a creatordate sort. Each commit
 * subject therefore carries a strictly-increasing process-local millisecond
 * stamp (`@<15-digit>` suffix) that the listing sorts on — deterministic
 * LRU within the owning process, near-deterministic across processes.
 */

import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type { AuditLedger } from "./audit-ledger.js"

const execFileAsync = promisify(execFile)

const GIT_TIMEOUT_MS = 60_000
const SHADOW_REF_PREFIX = "refs/maximilian/shadow/"
/** Author/committer identity for shadow commits — never the user's git config. */
const SHADOW_IDENTITY = [
  "-c",
  "user.name=maximilian shadow",
  "-c",
  "user.email=shadow@maximilian.invalid",
]
const DEFAULT_KEEP = 5
const SUBJECT_PREFIX = "maximilian shadow: "
/** Fixed-width so lexical order equals numeric order in listings. */
const TS_WIDTH = 15
const TS_SUFFIX = /\s@(\d{15})$/

/** Structured failure codes surfaced to callers (never raw git stderr only). */
export type ShadowCommitErrorCode =
  | "not-a-repo"
  | "invalid-id"
  | "unknown-id"
  | "ambiguous-id"
  | "not-a-commit"
  | "dirty-worktree"
  | "git-failed"

export class ShadowCommitError extends Error {
  constructor(
    readonly code: ShadowCommitErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "ShadowCommitError"
  }
}

export interface ShadowCommitInfo {
  /** Full commit sha — also the basename of the shadow ref. */
  readonly id: string
  readonly ref: string
  readonly label: string
  readonly createdAt: string
}

export interface ShadowCommitEntry {
  readonly id: string
  readonly ref: string
  readonly createdAt: string
  readonly label: string
}

export interface ShadowCommitOptions {
  /** Max snapshots retained (LRU). Default 5. */
  readonly keep?: number
  /** Audit sink — when set, create/rollback/timeout events are recorded. */
  readonly audit?: AuditLedger
}

async function git(
  repoDir: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoDir,
      env: env === undefined ? undefined : { ...process.env, ...env },
      timeout: GIT_TIMEOUT_MS,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    })
    return stdout.trim()
  } catch (error) {
    const err = error as { stderr?: string; message: string; code?: string }
    if (err.code === "ENOENT") {
      throw new ShadowCommitError("git-failed", "git executable not found on PATH")
    }
    const detail = (err.stderr ?? err.message ?? "").trim()
    throw new ShadowCommitError("git-failed", `git ${String(args[0])} failed: ${detail}`)
  }
}

/**
 * Resolve the enclosing repository toplevel, failing closed outside git.
 * Success/failure of `rev-parse --show-toplevel` is the signal — stderr is
 * localized by git and must never be pattern-matched.
 */
async function repoToplevel(repoDir: string): Promise<string> {
  try {
    const toplevel = await git(repoDir, ["rev-parse", "--show-toplevel"])
    if (!toplevel) {
      throw new ShadowCommitError("not-a-repo", `${repoDir} is not inside a git repository`)
    }
    return toplevel
  } catch (err) {
    if (err instanceof ShadowCommitError) {
      throw new ShadowCommitError(
        "not-a-repo",
        `${repoDir} is not inside a git repository (${err.message})`,
      )
    }
    throw err
  }
}

/** Strictly increasing process-local stamp: Date.now(), never repeating. */
let lastShadowTs = 0
function nextShadowTs(): number {
  lastShadowTs = Math.max(Date.now(), lastShadowTs + 1)
  return lastShadowTs
}

function subjectFor(label: string, ts: number): string {
  return `${SUBJECT_PREFIX}${label} @${String(ts).padStart(TS_WIDTH, "0")}`
}

function parseShadowSubject(sha: string, subject: string): ShadowCommitEntry {
  const tsMatch = subject.match(TS_SUFFIX)
  const ts = tsMatch !== null ? Number(tsMatch[1]) : 0
  const label = subject.replace(/^maximilian shadow: /, "").replace(TS_SUFFIX, "")
  return {
    id: sha,
    ref: `${SHADOW_REF_PREFIX}${sha}`,
    createdAt: new Date(ts).toISOString(),
    label,
  }
}

export async function createShadowCommit(
  repoDir: string,
  label: string,
  opts: ShadowCommitOptions = {},
): Promise<ShadowCommitInfo> {
  if (typeof label !== "string" || label.trim().length === 0) {
    throw new ShadowCommitError("invalid-id", "shadow commit label must not be empty")
  }
  const toplevel = await repoToplevel(repoDir)
  // Build the tree from the live worktree through a temporary index so the
  // user's real index and HEAD are never touched.
  const tmpIndexDir = await mkdtemp(join(tmpdir(), "maximilian-shadow-"))
  try {
    const indexEnv = { GIT_INDEX_FILE: join(tmpIndexDir, "index") }
    await git(toplevel, ["add", "-A", "--"], indexEnv)
    const tree = await git(toplevel, ["write-tree"], indexEnv)

    // Parent onto HEAD when the repository has commits; orphan commits are
    // valid snapshots for freshly-initialized repositories.
    let hasHead = true
    try {
      await git(toplevel, ["rev-parse", "--verify", "--quiet", "HEAD"])
    } catch {
      hasHead = false
    }
    const parentArgs = hasHead ? ["-p", "HEAD"] : []
    const commit = await git(toplevel, [
      ...SHADOW_IDENTITY,
      "commit-tree",
      tree,
      ...parentArgs,
      "-m",
      subjectFor(label, nextShadowTs()),
    ])
    const ref = `${SHADOW_REF_PREFIX}${commit}`
    await git(toplevel, ["update-ref", ref, commit])

    const keep = opts.keep ?? DEFAULT_KEEP
    const evicted = await evictShadowCommits(toplevel, keep)
    if (opts.audit) {
      await opts.audit.append("shadow.commit", { id: commit, ref, label, evicted })
    }
    return { id: commit, ref, label, createdAt: new Date().toISOString() }
  } finally {
    await rm(tmpIndexDir, { recursive: true, force: true })
  }
}

/** List shadow snapshots, oldest first (by creation stamp, not by git date). */
export async function listShadowCommits(repoDir: string): Promise<ShadowCommitEntry[]> {
  const toplevel = await repoToplevel(repoDir)
  const raw = await git(toplevel, [
    "for-each-ref",
    "--format=%(objectname)%09%(subject)",
    SHADOW_REF_PREFIX,
  ])
  if (!raw) return []
  const entries = raw.split("\n").map((line) => {
    const [sha, subject = ""] = line.split("\t")
    return parseShadowSubject(sha ?? "", subject)
  })
  return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/**
 * Keep only the newest `keep` snapshots; delete older refs. Returns the
 * evicted ids (oldest first). No-op when the namespace is within bounds.
 */
export async function evictShadowCommits(repoDir: string, keep: number): Promise<string[]> {
  const snapshots = await listShadowCommits(repoDir)
  if (snapshots.length <= keep) return []
  const evict = snapshots.slice(0, snapshots.length - keep)
  for (const snapshot of evict) {
    await git(repoDir, ["update-ref", "-d", snapshot.ref])
  }
  return evict.map((s) => s.id)
}

/**
 * Restore worktree + index from a shadow snapshot.
 *
 * Files created after the snapshot are removed (`git clean -fd` keeps
 * ignored paths such as node_modules). Refuses when the worktree is dirty
 * unless `force` is set, because rollback discards uncommitted work.
 */
export async function rollbackToShadow(
  repoDir: string,
  id: string,
  opts: ShadowCommitOptions & { force?: boolean } = {},
): Promise<ShadowCommitEntry> {
  if (!/^[0-9a-f]{4,40}$/.test(id)) {
    throw new ShadowCommitError("invalid-id", `invalid shadow commit id "${id}"`)
  }
  const toplevel = await repoToplevel(repoDir)

  // Resolve against the shadow namespace by sha prefix. Ref names do not
  // support prefix lookup, so match candidates via for-each-ref; ambiguity
  // is an error rather than a guess.
  const candidates = (
    await git(toplevel, ["for-each-ref", "--format=%(objectname)", SHADOW_REF_PREFIX])
  )
    .split("\n")
    .filter((sha) => sha.startsWith(id))
  if (candidates.length === 0) {
    throw new ShadowCommitError("unknown-id", `unknown shadow commit "${id}"`)
  }
  if (candidates.length > 1) {
    throw new ShadowCommitError(
      "ambiguous-id",
      `ambiguous shadow commit id "${id}"; use more characters`,
    )
  }
  const full = candidates[0]!

  // The resolved object must be a commit — never a blob or tree an attacker
  // planted at a colliding ref path. Fail closed otherwise.
  const objectType = await git(toplevel, ["cat-file", "-t", full])
  if (objectType !== "commit") {
    throw new ShadowCommitError("not-a-commit", `shadow commit "${id}" is not a valid snapshot`)
  }

  const snapshots = await listShadowCommits(toplevel)
  const entry = snapshots.find((s) => s.id === full)
  if (!entry) {
    throw new ShadowCommitError("unknown-id", `unknown shadow commit "${id}"`)
  }

  if (opts.force !== true && (await git(toplevel, ["status", "--porcelain"])).length > 0) {
    throw new ShadowCommitError(
      "dirty-worktree",
      "working tree has uncommitted changes; rollback would discard them. Pass force to proceed.",
    )
  }

  // An empty snapshot tree (repo was empty at capture time) cannot be the
  // source of a restore — ':/' matches nothing and git errors out. Roll
  // back to "nothing" instead: point the index at the empty tree and let
  // clean remove every now-untracked file.
  const snapshotIsEmpty = (await git(toplevel, ["ls-tree", full, "--name-only"])).length === 0
  if (snapshotIsEmpty) {
    await git(toplevel, ["read-tree", full])
  } else {
    await git(toplevel, ["restore", "--source", full, "--staged", "--worktree", ":/"])
  }
  await git(toplevel, ["clean", "-fd"])
  if (opts.audit) {
    await opts.audit.append("shadow.rollback", { id: full, ref: entry.ref })
  }
  return entry
}
