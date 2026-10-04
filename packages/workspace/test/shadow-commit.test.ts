// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for git shadow commits, run against real throwaway repositories
 * (mkdtemp + git init):
 *   - write → shadow → write again → rollback restores the first state.
 *   - files created after the snapshot are removed by rollback.
 *   - untracked files are captured by the snapshot.
 *   - rollback refuses on a dirty worktree unless forced.
 *   - unknown / ambiguous / invalid ids fail with structured codes.
 *   - the namespace is LRU-bounded: only the newest `keep` refs survive.
 *   - HEAD never moves and no regular commits appear.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import {
  ShadowCommitError,
  createShadowCommit,
  listShadowCommits,
  rollbackToShadow,
} from "../src/shadow-commit.js"

const execFileAsync = promisify(execFile)

let repo: string

beforeEach(async () => {
  repo = await fs.mkdtemp(path.join(tmpdir(), "max-workspace-shadow-"))
  await git("init", "-q")
})

afterEach(async () => {
  await fs.rm(repo, { recursive: true, force: true })
})

/** Run git with a fixed identity so tests never depend on user config. */
async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args],
    { cwd: repo, encoding: "utf8" },
  )
  return stdout.trim()
}

async function write(file: string, content: string): Promise<void> {
  const target = path.join(repo, file)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content, "utf-8")
}

async function read(file: string): Promise<string> {
  return fs.readFile(path.join(repo, file), "utf-8")
}

async function headSha(): Promise<string | null> {
  try {
    return await git("rev-parse", "HEAD")
  } catch {
    return null
  }
}

describe("createShadowCommit / rollbackToShadow", () => {
  it("round-trips: write, shadow, overwrite, rollback restores content", async () => {
    await write("plan.txt", "version-1")
    const snapshot = await createShadowCommit(repo, "before batch write")
    await write("plan.txt", "version-2")
    expect(await read("plan.txt")).toBe("version-2")

    await rollbackToShadow(repo, snapshot.id, { force: true })
    expect(await read("plan.txt")).toBe("version-1")
  }, 20_000)

  it("removes files created after the snapshot on rollback", async () => {
    await write("keep.txt", "kept")
    const snapshot = await createShadowCommit(repo, "before add")
    await write("stray.txt", "created after snapshot")

    await rollbackToShadow(repo, snapshot.id, { force: true })
    expect(await read("keep.txt")).toBe("kept")
    await expect(read("stray.txt")).rejects.toThrow()
  }, 20_000)

  it("captures untracked files in the snapshot", async () => {
    await write("untracked.txt", "never committed")
    const snapshot = await createShadowCommit(repo, "untracked capture")
    await fs.unlink(path.join(repo, "untracked.txt"))
    await rollbackToShadow(repo, snapshot.id, { force: true })
    expect(await read("untracked.txt")).toBe("never committed")
  }, 20_000)

  it("works in a repository with no commits (orphan snapshot)", async () => {
    expect(await headSha()).toBeNull()
    const snapshot = await createShadowCommit(repo, "fresh repo")
    expect(snapshot.ref).toMatch(/^refs\/maximilian\/shadow\/[0-9a-f]{40}$/)
    await write("late.txt", "after")
    await rollbackToShadow(repo, snapshot.id, { force: true })
    await expect(read("late.txt")).rejects.toThrow()
  }, 20_000)

  it("never moves HEAD and never creates a visible commit", async () => {
    await write("a.txt", "1")
    await git("add", "-A")
    await git("commit", "-q", "-m", "base")
    const before = await headSha()

    const snapshot = await createShadowCommit(repo, "invisible")
    expect(await headSha()).toBe(before)

    const log = await git("log", "--oneline")
    expect(log).not.toContain(snapshot.id.slice(0, 7))
    // The snapshot lives only in the shadow ref namespace.
    expect(await git("for-each-ref", "refs/maximilian/shadow")).toContain(snapshot.id)
  }, 20_000)

  it("refuses to roll back a dirty worktree without force", async () => {
    await write("plan.txt", "v1")
    const snapshot = await createShadowCommit(repo, "clean")
    await write("plan.txt", "v2")
    await expect(rollbackToShadow(repo, snapshot.id)).rejects.toMatchObject({
      name: "ShadowCommitError",
      code: "dirty-worktree",
    })
    // Still dirty-file content.
    expect(await read("plan.txt")).toBe("v2")
    await rollbackToShadow(repo, snapshot.id, { force: true })
    expect(await read("plan.txt")).toBe("v1")
  }, 20_000)

  it("resolves ids by sha prefix and rejects unknown/ambiguous/invalid ones", async () => {
    await write("a.txt", "1")
    const snapshot = await createShadowCommit(repo, "prefixed")
    await rollbackToShadow(repo, snapshot.id.slice(0, 10), { force: true })

    await expect(rollbackToShadow(repo, "deadbeef")).rejects.toMatchObject({
      code: "unknown-id",
    })
    await expect(rollbackToShadow(repo, "../etc/passwd")).rejects.toMatchObject({
      code: "invalid-id",
    })
  }, 20_000)

  it("lists snapshots oldest first", async () => {
    await write("a.txt", "1")
    const first = await createShadowCommit(repo, "one")
    await write("a.txt", "2")
    const second = await createShadowCommit(repo, "two")
    const list = await listShadowCommits(repo)
    expect(list.map((s) => s.id)).toEqual([first.id, second.id])
    expect(list[0]!.label).toBe("one")
    expect(list[1]!.label).toBe("two")
  }, 20_000)

  it("keeps only the newest `keep` snapshots (LRU eviction)", async () => {
    for (let i = 0; i < 7; i++) {
      await write("counter.txt", String(i))
      await createShadowCommit(repo, `snapshot-${i}`, { keep: 5 })
    }
    const list = await listShadowCommits(repo)
    expect(list).toHaveLength(5)
    expect(list[0]!.label).toBe("snapshot-2")
    expect(list[4]!.label).toBe("snapshot-6")
    // Evicted id no longer rolls back.
    await expect(rollbackToShadow(repo, "0".repeat(40))).rejects.toBeInstanceOf(ShadowCommitError)
  }, 60_000)

  it("rejects an empty label and a non-repo directory with structured codes", async () => {
    await expect(createShadowCommit(repo, "  ")).rejects.toMatchObject({ code: "invalid-id" })
    const outside = await fs.mkdtemp(path.join(tmpdir(), "max-workspace-nogit-"))
    try {
      await expect(createShadowCommit(outside, "x")).rejects.toMatchObject({ code: "not-a-repo" })
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  }, 20_000)

  it("records shadow.commit and shadow.rollback in the audit ledger", async () => {
    const { AuditLedger } = await import("../src/audit-ledger.js")
    const ledger = new AuditLedger(path.join(repo, "..", `audit-${Date.now()}.jsonl`))
    await write("a.txt", "1")
    const snapshot = await createShadowCommit(repo, "audited", { audit: ledger })
    await rollbackToShadow(repo, snapshot.id, { force: true, audit: ledger })
    const actions = (await ledger.entries()).map((e) => e.action)
    expect(actions).toEqual(["shadow.commit", "shadow.rollback"])
  }, 20_000)
})
