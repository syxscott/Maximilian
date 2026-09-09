// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SnapshotSaver (借鉴 opencode - snapshot/index.ts).
 *
 * 基于 git 的 file-level patch 跟踪。每个 snapshot = 一个 patch hash。
 * 支持 track/patch/restore/diff。
 *
 * 与现有 checkpoint/(memory-saver.ts / pg-saver.ts)并存:
 *   - BaseCheckpointSaver: LangGraph 风格 channel-based(已在用)
 *   - SnapshotSaver: git-based file-level revert(本模块)
 */

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"

// 借鉴 opencode - prune 7 days, 2 MiB limit
const PRUNE_DAYS = 7
const LIMIT_BYTES = 2 * 1024 * 1024
const GIT_CORE = [
  "-c",
  "core.longpaths=true",
  "-c",
  "core.symlinks=true",
  "-c",
  "core.autocrlf=false",
  "-c",
  "core.quotepath=false",
]

export interface Patch {
  hash: string
  files: string[]
}

export interface FileDiff {
  file?: string
  patch?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

export interface SnapshotInfo {
  hash: string
  createdAt: number
  files: string[]
  sizeBytes: number
}

/**
 * 借鉴 opencode - Snapshot.Service (file-system 版本)
 * 通过 child_process 调用 git 命令读写工作树。
 */
export class SnapshotSaver {
  constructor(
    private readonly root: string,
    private readonly snapshotDir: string = join(root, ".maximilian", "snapshots"),
  ) {}

  /** 借鉴 opencode - init(): 确保 .maximilian/snapshots 目录存在 */
  init(): void {
    mkdirSync(this.snapshotDir, { recursive: true })
  }

  /**
   * 借鉴 opencode - track(): 把当前工作树状态记录为一个 snapshot,
   * 返回 snapshot hash;若没有变更返回 undefined。
   * 使用 `git add -N` (intent-to-add) 让 untracked 文件也出现在 diff 中。
   */
  track(): string | undefined {
    this.init()
    // 让 untracked 文件进入 intent-to-add 状态(不写入 index)
    this.git("add", ["-N", "."])
    const status = this.git("status", ["--porcelain"])
    if (!status.trim()) {
      this.git("reset", ["-q", "HEAD", "."]) // 撤销 add -N
      return undefined
    }
    const hash = createHash("sha1")
      .update(status)
      .update(String(Date.now()))
      .digest("hex")
      .slice(0, 12)
    const patchFile = this.patchFile(hash)
    const diff = this.git("diff", ["--binary", "--no-color", "HEAD"])
    writeFileSync(patchFile, diff)
    return hash
  }

  /**
   * 借鉴 opencode - restore(snapshot): 把工作树恢复到 snapshot 时的状态。
   * 我们的 snapshot 记录的是 "当前偏离 baseline 的 patch",所以 restore 用 --reverse 反向应用。
   */
  restore(snapshot: string): void {
    const patchFile = this.patchFile(snapshot)
    if (!existsSync(patchFile)) {
      throw new Error(`Snapshot not found: ${snapshot} (借鉴 opencode)`)
    }
    this.git("apply", ["--reverse", "--whitespace=nowarn", patchFile])
  }

  /** 借鉴 opencode - diff(snapshot): 返回 raw patch 文本 */
  diff(snapshot: string): string {
    const patchFile = this.patchFile(snapshot)
    return existsSync(patchFile) ? readFileSync(patchFile, "utf8") : ""
  }

  /** 借鉴 opencode - list(): 所有 snapshot hash 列表 */
  list(): SnapshotInfo[] {
    if (!existsSync(this.snapshotDir)) return []
    const { readdirSync } = require("node:fs") as typeof import("node:fs")
    const out: SnapshotInfo[] = []
    for (const name of readdirSync(this.snapshotDir)) {
      if (!name.endsWith(".patch")) continue
      const hash = name.slice(0, -".patch".length)
      const filePath = this.patchFile(hash)
      const stat = statSync(filePath)
      const content = readFileSync(filePath, "utf8")
      const files = parseFilesFromPatch(content)
      out.push({
        hash,
        createdAt: stat.mtimeMs,
        sizeBytes: stat.size,
        files,
      })
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  }

  /** 借鉴 opencode - cleanup(): 删除超过 PRUNE_DAYS 的快照 */
  cleanup(maxAgeMs = PRUNE_DAYS * 24 * 60 * 60 * 1000): number {
    if (!existsSync(this.snapshotDir)) return 0
    const { readdirSync, unlinkSync } = require("node:fs") as typeof import("node:fs")
    const now = Date.now()
    let removed = 0
    for (const name of readdirSync(this.snapshotDir)) {
      if (!name.endsWith(".patch")) continue
      const filePath = this.patchFile(name.replace(/\.patch$/, ""))
      const stat = statSync(filePath)
      if (now - stat.mtimeMs > maxAgeMs) {
        unlinkSync(filePath)
        removed++
      }
    }
    return removed
  }

  private patchFile(hash: string): string {
    return join(this.snapshotDir, `${hash}.patch`)
  }

  private git(cmd: string, args: string[]): string {
    try {
      return execFileSync(
        "git",
        [...GIT_CORE, cmd, ...args],
        {
          cwd: this.root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          maxBuffer: LIMIT_BYTES,
        },
      )
    } catch {
      return ""
    }
  }
}

function parseFilesFromPatch(patch: string): string[] {
  const files = new Set<string>()
  for (const line of patch.split("\n")) {
    const m = /^diff --git a\/(.+?) b\//.exec(line)
    if (m) files.add(m[1]!)
  }
  return [...files]
}