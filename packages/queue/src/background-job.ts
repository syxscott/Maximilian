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
 *
 * 排队期可取消（borrowing: MiniApps minimax-bot engine.mjs, commit
 * 0e8c24a）:原实现里 cancel() 只认已注册的 run,而 job 在被 start() 真正
 * 启动前存在一个「queued」窗口——此时 cancel 静默返回 false,随后 run 照常
 * 执行。现补齐两段语义:
 *   - enqueue(): 只注册不启动,状态 queued;
 *   - start(id): 领取 queued job 并启动;若排队期间已被 cancel,直接返回
 *     cancelled 结果且不调用 run();
 *   - runJob() 启动守卫:状态不是 running 就拒绝执行,覆盖 start 与 cancel
 *     之间的竞态。
 * cancel() 同时是落盘+广播点(可选 hooks),对应上游的 save()+broadcast()。
 */

import { randomUUID } from "node:crypto"

// 借鉴 opencode - Status union;queued 是本仓库补充的排队态。
export type JobStatus = "queued" | "running" | "completed" | "error" | "cancelled"

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

/** 可选的落盘/广播出口——由调用方(注册表宿主)注入,registry 本身不碰 I/O。 */
export interface BackgroundJobHooks {
  /**
   * 状态迁移时通知 durable store(借鉴 engine.mjs 的 store.save())。
   * 尽力而为:抛错被吞掉,绝不阻塞 cancel/start。
   */
  persist?: (info: JobInfo) => void | Promise<void>
  /** 状态迁移时通知本进程观察者(借鉴 engine.mjs 的 broadcastHelpers())。 */
  broadcast?: (info: JobInfo) => void
}

type Active = {
  info: JobInfo
  /** 已完成结果缓存,wait() 立即返回。修复 HIGH 4 race condition */
  lastResult?: JobInfo
  /** 等待当前 run 的 resolveDone;runJob 完成时被调用 */
  resolveDone: (info: JobInfo) => void
  /** start()/enqueue() 返回给调用方的 done promise。 */
  done: Promise<JobInfo>
}

function createActive(info: JobInfo): Active {
  let resolveDone!: (j: JobInfo) => void
  const done = new Promise<JobInfo>((res) => {
    resolveDone = res
  })
  return { info, resolveDone, done }
}

/**
 * 借鉴 opencode - 进程内 BackgroundJobRegistry
 * - enqueue(): 注册 queued job(未启动)
 * - start(): 注册并立刻运行,或领取已 enqueue 的 job
 * - extend(): 把同一个 id 上的新 run() 链接到现有 job(用于阶段续传)
 * - wait(): 等待某个 id 完成(若已完成立即返回)
 * - cancel(): 标记为 cancelled(含排队期)
 * - list() / get(): 查询
 */
export class BackgroundJobRegistry {
  private readonly jobs = new Map<string, Active>()
  private readonly hooks: BackgroundJobHooks

  constructor(hooks: BackgroundJobHooks = {}) {
    this.hooks = hooks
  }

  /**
   * 排队：注册一个尚未开始运行的 job。调用方随后用 start({ id }) 领取它;
   * 在领取前 cancel(id) 会直接把它标成 cancelled,start() 不会再跑。
   */
  enqueue(opts: {
    id?: string
    type: string
    title?: string
    metadata?: Record<string, unknown>
  }): { id: string; done: Promise<JobInfo> } {
    const id = opts.id ?? randomUUID()
    if (this.jobs.has(id)) throw new Error(`background job ${id} is already tracked`)
    const active = createActive({
      id,
      type: opts.type,
      title: opts.title,
      status: "queued",
      startedAt: Date.now(),
      metadata: opts.metadata,
    })
    this.jobs.set(id, active)
    this.emit(active.info)
    return { id, done: active.done }
  }

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
      if (existing.info.status === "cancelled") {
        // 排队期已取消:不得再启动,回缓存结果。
        return { id, done: Promise.resolve(existing.lastResult ?? { ...existing.info }) }
      }
      if (existing.info.status === "queued") {
        // 排队期领取。
        return { id, done: this.beginQueued(existing, opts.run) }
      }
      // 借鉴 opencode - extend: 若 id 已存在,链接新的 run 到现有 active
      void this.extendRun(id, opts.run)
      // 修复 HIGH 4 - 等待新的 run 完成;extendRun 会重置 lastResult 和 resolveDone
      let resolveDone!: (j: JobInfo) => void
      const done = new Promise<JobInfo>((res) => {
        resolveDone = res
      })
      existing.resolveDone = resolveDone
      existing.done = done
      return { id, done }
    }

    const active = createActive({
      id,
      type: opts.type,
      title: opts.title,
      status: "running",
      startedAt: Date.now(),
      metadata: opts.metadata,
    })
    this.jobs.set(id, active)
    this.emit(active.info)

    void this.runJob(active, opts.run)
    return { id, done: active.done }
  }

  private async runJob(active: Active, run: () => Promise<string>): Promise<void> {
    // 启动守卫(0e8c24a):排队期被取消的 job 不得执行。
    if (active.info.status !== "running") return
    try {
      const output = await run()
      active.info.status = "completed"
      active.info.completedAt = Date.now()
      active.info.output = output
    } catch (err) {
      active.info.status = "error"
      active.info.completedAt = Date.now()
      active.info.error = err instanceof Error ? err.message : String(err)
    } finally {
      // 修复 HIGH 4 - 先缓存结果再 resolve,这样后续 wait() 立即能拿到
      active.lastResult = { ...active.info }
      active.resolveDone(active.lastResult)
      this.emit(active.lastResult)
      // 借鉴 opencode - 完成后保留 60s 便于查询
      setTimeout(() => this.jobs.delete(active.info.id), 60_000)
    }
  }

  /** 领取 queued job:已取消则直接回缓存;否则置 running 并启动。 */
  private beginQueued(active: Active, run: () => Promise<string>): Promise<JobInfo> {
    if (active.info.status === "cancelled") {
      return Promise.resolve(active.lastResult ?? { ...active.info })
    }
    active.info.status = "running"
    active.info.completedAt = undefined
    active.info.error = undefined
    active.info.output = undefined
    this.emit(active.info)
    void this.runJob(active, run)
    return active.done
  }

  private async extendRun(id: string, run: () => Promise<string>): Promise<void> {
    const active = this.jobs.get(id)
    if (!active) return
    // 修复 HIGH 4 - 重置前先清掉 lastResult,否则新 start() 拿到旧值
    active.lastResult = undefined
    active.info.status = "running"
    active.info.completedAt = undefined
    active.info.error = undefined
    active.info.output = undefined
    void this.runJob(active, run)
  }

  /** 借鉴 opencode - wait(id, timeout?). 已完成立即返回缓存的 lastResult */
  async wait(id: string, timeoutMs?: number): Promise<JobInfo | undefined> {
    const job = this.jobs.get(id)
    if (!job) return undefined
    // 修复 HIGH 4 - 已完成时直接返回缓存,避免挂起
    if (job.lastResult) return job.lastResult
    const done = new Promise<JobInfo>((res) => {
      job.resolveDone = res
    })
    if (timeoutMs === undefined) return done
    return Promise.race([
      done,
      new Promise<JobInfo | undefined>((res) => setTimeout(() => res(undefined), timeoutMs)),
    ])
  }

  /**
   * 借鉴 opencode - cancel(id)。已注册(含 queued)的 job 标记 cancelled +
   * completedAt(=endedAt),并通过 hooks 落盘/广播;未注册返回 false。
   */
  cancel(id: string): boolean {
    const job = this.jobs.get(id)
    if (!job) return false
    job.info.status = "cancelled"
    job.info.completedAt = Date.now()
    job.lastResult = { ...job.info }
    job.resolveDone(job.lastResult)
    this.emit(job.lastResult)
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

  /** 尽力而为地通知 hooks:persist 异步吞错,broadcast 同步吞错。 */
  private emit(info: JobInfo): void {
    if (this.hooks.persist !== undefined) {
      try {
        void Promise.resolve(this.hooks.persist(info)).catch(() => {})
      } catch {
        // 落盘失败不能反过来弄坏内存状态机
      }
    }
    try {
      this.hooks.broadcast?.(info)
    } catch {
      // 广播失败同上
    }
  }
}
