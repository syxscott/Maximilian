// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * WorkspaceAdapter (借鉴 opencode - control-plane/workspace-adapter-runtime.ts).
 *
 * 把 workspace 抽象成可插拔后端。目前提供 LocalAdapter(fs),
 * 后续可加 RemoteAdapter(http/ssh/git) — 只需实现 create/remove/list 三个方法。
 */

export interface WorkspaceInfo {
  id: string
  name: string
  type: string
  directory?: string | null
  branch?: string | null
  projectID: string
  extra?: Record<string, unknown> | null
}

export interface WorkspaceAdapter {
  readonly name: string
  readonly description: string
  create(info: WorkspaceInfo): Promise<void>
  remove(info: WorkspaceInfo): Promise<void>
  list(): Promise<WorkspaceInfo[]>
  get(id: string): Promise<WorkspaceInfo | undefined>
}

/**
 * 借鉴 opencode - LocalAdapter
 * 把 workspace 落到本地文件系统根目录下的子目录。
 */
export class LocalAdapter implements WorkspaceAdapter {
  readonly name = "local"
  readonly description = "Local filesystem workspace"
  /** 内存索引(进程内);持久化由 FileWorkspaceStore 负责 */
  private index = new Map<string, WorkspaceInfo>()

  constructor(private readonly root: string) {}

  async create(info: WorkspaceInfo): Promise<void> {
    const { mkdirSync } = await import("node:fs")
    const { join } = await import("node:path")
    if (!info.directory) {
      throw new Error("LocalAdapter requires directory (借鉴 opencode)")
    }
    mkdirSync(join(this.root, info.directory), { recursive: true })
    this.index.set(info.id, info)
  }

  async remove(info: WorkspaceInfo): Promise<void> {
    const { rmSync } = await import("node:fs")
    const { join } = await import("node:path")
    if (info.directory) {
      rmSync(join(this.root, info.directory), { recursive: true, force: true })
    }
    this.index.delete(info.id)
  }

  async list(): Promise<WorkspaceInfo[]> {
    return [...this.index.values()]
  }

  async get(id: string): Promise<WorkspaceInfo | undefined> {
    return this.index.get(id)
  }

  /** 借鉴 opencode - 由 FileWorkspaceStore 在加载时调用,填充索引 */
  hydrate(items: WorkspaceInfo[]): void {
    for (const it of items) this.index.set(it.id, it)
  }
}