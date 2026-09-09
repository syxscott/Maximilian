// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SkillDiscovery (借鉴 opencode - skill/discovery.ts).
 *
 * 从 URL 拉 SKILL.md 索引,并发下载,落到 ~/.maximilian/skills/<name>/。
 * 7 天 TTL 缓存避免重复拉取。
 *
 * 与现有 claude-skills.ts 共存:
 *   - claude-skills: 本地 ~/.claude/skills/ 加载
 *   - skill-discovery: 远程 URL 索引加载
 *   - 运行时两者并联(本地优先,远程 fallback)
 */

import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

// 借鉴 opencode - skillConcurrency=4, fileConcurrency=8
export const SKILL_CONCURRENCY = 4
export const FILE_CONCURRENCY = 8

/** 借鉴 opencode - 七天 prune 缓存 */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface SkillIndexEntry {
  name: string
  files: string[]
}

export interface SkillIndex {
  skills: SkillIndexEntry[]
}

export interface PullOptions {
  /** 覆盖缓存根目录(默认 ~/.maximilian/skills) */
  cacheDir?: string
  /** 中止信号 */
  signal?: AbortSignal
}

export const DEFAULT_SKILL_CACHE_DIR = join(homedir(), ".maximilian", "skills")

/**
 * 借鉴 opencode - SkillDiscovery.pull
 * 拉取 URL 的 SKILL.md 索引,返回成功下载的 skill 名称列表。
 * 索引拉取失败返回 [];不抛异常。
 */
export async function pullSkillIndex(
  url: string,
  opts: PullOptions = {},
): Promise<string[]> {
  const base = url.endsWith("/") ? url : `${url}/`
  const cacheRoot = opts.cacheDir ?? DEFAULT_SKILL_CACHE_DIR
  mkdirSync(cacheRoot, { recursive: true })

  let index: SkillIndex
  try {
    const res = await fetch(new URL("index.json", base).href, {
      signal: opts.signal,
    })
    if (!res.ok) return []
    index = (await res.json()) as SkillIndex
  } catch {
    return []
  }

  // 借鉴 opencode - 跳过缺少 SKILL.md 的条目
  const valid = index.skills.filter((s) => s.files.includes("SKILL.md"))

  // 串行(避免对本地文件系统过度并发);借鉴 opencode 并发语义
  const results: string[] = []
  for (const entry of valid) {
    const skillDir = join(cacheRoot, entry.name)
    let ok = true
    for (const f of entry.files) {
      const downloaded = await downloadFile(
        `${base}${entry.name}/${f}`,
        join(skillDir, f),
      )
      if (!downloaded) ok = false
    }
    if (ok) results.push(entry.name)
  }
  return results
}

/**
 * 借鉴 opencode - 下载单个文件,缓存 TTL=7 天。
 * 返回 true 表示成功或命中缓存。
 */
export async function downloadFile(url: string, dest: string): Promise<boolean> {
  try {
    if (existsSync(dest)) {
      const ageMs = Date.now() - statSync(dest).mtimeMs
      if (ageMs < CACHE_TTL_MS) return true
    }
    const res = await fetch(url)
    if (!res.ok) return false
    mkdirSync(join(dest, ".."), { recursive: true })
    writeFileSync(dest, await res.text())
    return true
  } catch {
    return false
  }
}

/**
 * 借鉴 opencode - 默认 skill registry(本地 + 远程合并)
 * 返回去重后的 skill 名称列表。
 */
export async function discoverSkills(opts: {
  localDir?: string
  remoteUrl?: string
  cacheDir?: string
  signal?: AbortSignal
}): Promise<string[]> {
  const local: string[] = []
  if (opts.localDir && existsSync(opts.localDir)) {
    try {
      const { readdirSync } = await import("node:fs")
      local.push(...readdirSync(opts.localDir))
    } catch {
      // ignore
    }
  }
  const remote = opts.remoteUrl ? await pullSkillIndex(opts.remoteUrl, opts) : []
  return [...new Set([...local, ...remote])]
}