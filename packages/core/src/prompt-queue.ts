// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Chat prompt queue with merge rules — grok-build borrowing
 * (`crates/codegen/xai-prompt-queue/src/{types.rs,combine.rs}`).
 *
 * grok-build queues messages that arrive while the agent is busy and
 * *merges* consecutive short follow-ups into a single turn — one LLM call
 * instead of N, and the user is never interrupted mid-turn. Merged
 * messages keep their original texts (`texts` — the equivalent of
 * `combinedDisplayTexts`) so the UI can still show them individually.
 *
 * Queue entries carry a monotonic `version`; `edit()` on a stale version
 * is a no-op returning false (optimistic concurrency — grok-build's
 * `version` field). Only the latest queued item is editable.
 */

export interface MergedPrompt {
  /** Monotonic id of the queue entry (also the edit token). */
  version: number
  /**
   * Original texts in arrival order. A non-merged entry has exactly one;
   * merged entries keep every original so display can replay them.
   */
  texts: string[]
  merged: boolean
  enqueuedAt: number
  lastAt: number
}

export interface PromptQueueOptions {
  /**
   * Two consecutive entries are mergeable when their combined text stays
   * within this budget (grok-build's short-follow-up rule). Default 400.
   */
  maxMergeChars?: number
  /** Merge window: entries older than this are no longer merged. Default 2000ms. */
  mergeWindowMs?: number
  /** Max queued (not yet run) entries; beyond this the queue rejects. Default 16. */
  maxQueue?: number
  now?: () => number
  /** Invoked when a run callback throws; queue keeps draining regardless. */
  onError?: (err: Error) => void
}

export interface PromptQueueRunnerInput {
  texts: string[]
  merged: boolean
  version: number
}

export class ChatPromptQueue {
  private items: MergedPrompt[] = []
  private running = false
  private versionCounter = 0
  private readonly maxMergeChars: number
  private readonly mergeWindowMs: number
  private readonly maxQueue: number
  private readonly now: () => number
  private idleWaiters: Array<() => void> = []

  constructor(
    private readonly opts: PromptQueueOptions & {
      onRun: (input: PromptQueueRunnerInput) => Promise<void>
    },
  ) {
    this.maxMergeChars = opts.maxMergeChars ?? 400
    this.mergeWindowMs = opts.mergeWindowMs ?? 2_000
    this.maxQueue = opts.maxQueue ?? 16
    this.now = opts.now ?? Date.now
  }

  /**
   * Submit a user message. When idle it runs immediately; when busy it is
   * queued (and possibly merged into the last queued entry).
   * Returns the version token of the entry that now carries `text`.
   */
  enqueue(text: string): { version: number; queued: boolean; merged: boolean } {
    const trimmed = text.trim()
    if (!trimmed) throw new Error("ChatPromptQueue: empty message")
    const now = this.now()

    if (!this.running) {
      // Idle: run straight away.
      const version = ++this.versionCounter
      this.running = true
      void this.runOne({ texts: [trimmed], merged: false, version, enqueuedAt: now, lastAt: now })
      return { version, queued: false, merged: false }
    }

    if (this.items.length >= this.maxQueue) {
      throw new Error("ChatPromptQueue: queue full")
    }

    const last = this.items.at(-1)
    const mergeable =
      last !== undefined &&
      now - last.lastAt <= this.mergeWindowMs &&
      last.texts.join("\n").length + trimmed.length + 1 <= this.maxMergeChars

    if (last && mergeable) {
      last.texts.push(trimmed)
      last.merged = true
      last.lastAt = now
      return { version: last.version, queued: true, merged: true }
    }

    const version = ++this.versionCounter
    this.items.push({ texts: [trimmed], merged: false, version, enqueuedAt: now, lastAt: now })
    return { version, queued: true, merged: false }
  }

  /**
   * Replace the text of the most recent queued entry. A stale `version`
   * (already running, merged away, or unknown) is a no-op → false.
   */
  edit(version: number, text: string): boolean {
    const last = this.items.at(-1)
    if (!last || last.version !== version) return false
    const trimmed = text.trim()
    if (!trimmed) return false
    last.texts = [trimmed]
    last.merged = false
    last.lastAt = this.now()
    return true
  }

  /** Entries waiting to run (oldest first). */
  pending(): ReadonlyArray<Readonly<MergedPrompt>> {
    return this.items
  }

  get busy(): boolean {
    return this.running
  }

  /** Resolves when the queue is empty and nothing is running. */
  idle(): Promise<void> {
    if (!this.running && this.items.length === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  private async runOne(item: MergedPrompt): Promise<void> {
    // Errors are contained per-item: one failing turn must not reject the
    // fire-and-forget scheduler promise (that would be an unhandled
    // rejection) nor starve the queued turns behind it.
    let current: MergedPrompt | undefined = item
    while (current !== undefined) {
      try {
        await this.opts.onRun({
          texts: current.texts,
          merged: current.merged,
          version: current.version,
        })
      } catch (err) {
        this.opts.onError?.(err instanceof Error ? err : new Error(String(err)))
      }
      current = this.items.shift()
    }
    this.running = false
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const w of waiters) w()
  }
}
