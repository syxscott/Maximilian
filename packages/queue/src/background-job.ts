// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * BackgroundJob (借鉴 opencode - core/src/background-job.ts).
 *
 * 长任务的 start/extend/wait/promote/cancel 生命周期,基于 in-process Promise
 * + Map。与 BullMQ 并存:BullMQ 处理跨进程任务队列;BackgroundJobRegistry
 * 处理 in-memory 短期 job(如 evaluation、training、recovery scan)。
 */

import { randomUUID } from "node:crypto"

// 借鉴 opencode - Status union
export type JobStatus = "running" | "completed" | "error" | "cancelled"

export interface JobInfo {
  id: string
  type: string
  title?: string
  status: JobStatus
  startedAt: number
  completedAt?: number
  output?: string
  error?: string
  metadata?: Record<string, unknown>
}

type Active = {
  info: JobInfo
  resolveDone: (info: JobInfo) => void
  rejectDone: (err: unknown) => void
}

/**
 * 借鉴 opencode - 进程内 BackgroundJobRegistry
 * - start(): 注册 job,返回 id 和 done Promise
 * - extend(): 把同一个 id 上的新 run() 链接到现有 job(用于阶段续传)
 * - wait(): 等待某个 id 完成
 * - cancel(): 标记为 cancelled(若 job 仍在 running,run() 仍会跑完但结果被丢弃)
 * - list() / get(): 查询
 */
export class BackgroundJobRegistry {
  private readonly jobs = new Map<string, Active>()

  start(opts: {
    id?: string
    type: string
    title?: string
    metadata?: Record<string, unknown>
    run: () => Promise<string>
  }): { id: string; done: Promise<JobInfo> } {
    const id = opts.id ?? randomUUID()
    const existing = this.jobs.get(id)
    if (existing) {
      // 借鉴 opencode - extend: 若 id 已存在,链接新的 run 到现有 active
      void this.extendRun(id, opts.run)
      return { id, done: new Promise<JobInfo>((res, rej) => {
        existing.resolveDone = res
        existing.rejectDone = rej
      }) }
    }

    const info: JobInfo = {
      id,
      type: opts.type,
      title: opts.title,
      status: "running",
      startedAt: Date.now(),
      metadata: opts.metadata,
    }
    let resolveDone!: (j: JobInfo) => void
    const done = new Promise<JobInfo>((res) => {
      resolveDone = res
    })
    const active: Active = {
      info,
      resolveDone,
      rejectDone: () => {},
    }
    this.jobs.set(id, active)

    void this.runJob(active, opts.run)
    return { id, done }
  }

  private async runJob(active: Active, run: () => Promise<string>): Promise<void> {
    try {
      const output = await run()
      active.info.status = "completed"
      active.info.completedAt = Date.now()
      active.info.output = output
      active.resolveDone({ ...active.info })
    } catch (err) {
      active.info.status = "error"
      active.info.completedAt = Date.now()
      active.info.error = err instanceof Error ? err.message : String(err)
      active.resolveDone({ ...active.info })
    } finally {
      // 借鉴 opencode - 完成后保留 60s 便于查询
      setTimeout(() => this.jobs.delete(active.info.id), 60_000)
    }
  }

  private async extendRun(id: string, run: () => Promise<string>): Promise<void> {
    const active = this.jobs.get(id)
    if (!active) return
    active.info.status = "running"
    active.info.completedAt = undefined
    active.info.error = undefined
    void this.runJob(active, run)
  }

  /** 借鉴 opencode - wait(id, timeout?) */
  async wait(id: string, timeoutMs?: number): Promise<JobInfo | undefined> {
    const job = this.jobs.get(id)
    if (!job) return undefined
    const done = new Promise<JobInfo>((res) => job.resolveDone = res)
    if (timeoutMs === undefined) return done
    return Promise.race([
      done,
      new Promise<JobInfo | undefined>((res) =>
        setTimeout(() => res(undefined), timeoutMs),
      ),
    ])
  }

  /** 借鉴 opencode - cancel(id) */
  cancel(id: string): boolean {
    const job = this.jobs.get(id)
    if (!job) return false
    job.info.status = "cancelled"
    job.info.completedAt = Date.now()
    job.resolveDone({ ...job.info })
    return true
  }

  get(id: string): JobInfo | undefined {
    return this.jobs.get(id)?.info
  }

  list(): JobInfo[] {
    return [...this.jobs.values()].map((a) => a.info)
  }

  size(): number {
    return this.jobs.size
  }
}