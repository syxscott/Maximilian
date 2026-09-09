// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Background Reflector — the "reflection fork" from NousResearch/hermes-agent
 * (`agent/background_review.py`).
 *
 * Hermes forks a helper thread after each session that replays the
 * conversation and decides "is there a skill/memory worth keeping?" — the
 * main session never waits for it. The Maximilian adaptation: after a task
 * completes, `BackgroundReflector.schedule()` enqueues a reflection job and
 * returns immediately. Jobs drain serially (memory writes must not race),
 * each job produces candidate *lessons*, and the facade applies them to the
 * profile — so a slow or failing reflector can never delay or crash task
 * execution.
 *
 * Lessons, not incident logs (hermes c240e65399): the default reflector
 * *generalizes* incidents — paths, ids and numbers become placeholders — so
 * the corpus accumulates rules ("Avoid: connection refused to <host>")
 * rather than replayed events.
 */

import type { AgentRole } from "@max/core"
import { isPolicyDeniedMessage } from "@max/core"
import type { MetricRecord } from "./types.js"

export interface ReflectionInput {
  record: MetricRecord
  /** Task output text, when the task produced one. */
  output?: string
}

export type Reflector = (input: ReflectionInput) => Promise<string[]> | string[]

export interface BackgroundReflectorOptions {
  /** Lesson extractor. Default: `defaultReflector`. */
  reflect?: Reflector
  /** Applied lessons sink (persisted by the facade). */
  onLessons: (role: AgentRole, lessons: string[]) => Promise<void>
  /** Drop jobs when the pending queue exceeds this. Default 64. */
  maxQueue?: number
}

export interface ReflectorStats {
  scheduled: number
  completed: number
  failed: number
  dropped: number
  lessonsEmitted: number
}

export class BackgroundReflector {
  stats: ReflectorStats = {
    scheduled: 0,
    completed: 0,
    failed: 0,
    dropped: 0,
    lessonsEmitted: 0,
  }

  private readonly queue: ReflectionInput[] = []
  private draining = false
  private readonly idleWaiters: Array<() => void> = []

  constructor(private readonly opts: BackgroundReflectorOptions) {
    if (!opts.onLessons) throw new Error("BackgroundReflector: `onLessons` is required")
  }

  /** Fire-and-forget: enqueue a job and return at once. Never throws. */
  schedule(input: ReflectionInput): void {
    this.stats.scheduled += 1
    const maxQueue = this.opts.maxQueue ?? 64
    if (this.queue.length >= maxQueue) {
      this.stats.dropped += 1
      return
    }
    this.queue.push(input)
    void this.pump()
  }

  /** Resolves when the queue is fully drained (tests, graceful shutdown). */
  drain(): Promise<void> {
    if (!this.draining && this.queue.length === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  private async pump(): Promise<void> {
    if (this.draining) return
    this.draining = true
    while (this.queue.length > 0) {
      const input = this.queue.shift()!
      try {
        const lessons = await (this.opts.reflect ?? defaultReflector)(input)
        const safe = lessons.filter((l) => l.trim().length > 0)
        if (safe.length > 0) {
          await this.opts.onLessons(input.record.agentRole, safe)
          this.stats.lessonsEmitted += safe.length
        }
        this.stats.completed += 1
      } catch {
        // Reflection must never bubble: count and move on.
        this.stats.failed += 1
      }
    }
    this.draining = false
    while (this.idleWaiters.length > 0) {
      this.idleWaiters.shift()!()
    }
  }
}

/**
 * Replace incident-specific details with placeholders so a lesson states a
 * rule rather than replaying an event (hermes "lessons, not incident logs").
 */
export function generalizeIncident(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hash>")
    .replace(/(?:\/[\w.@-]+){2,}/g, "<path>")
    .replace(/\b(?:[\w-]+\/)+[\w.-]+\.[a-z]{1,6}\b/gi, "<path>")
    .replace(/\b\d[\d.,:]*\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Default heuristic reflector. Derives at most one lesson per job:
 *   - runtime error  → "Avoid repeating: <generalized>"
 *   - low review     → "scored <n>/10 — be more thorough" (bounded phrasing)
 *   - high review    → "Pattern that worked: <generalized snippet>"
 * Real deployments pass an LLM reflector; the shape stays the same.
 */
export const defaultReflector: Reflector = (input) => {
  const { record, output } = input
  if (record.error) {
    // deny≠failure: a governance rejection is not a lesson-worthy failure —
    // the policy already IS the lesson, and it was applied by a human or a
    // gate, not by the model doing something wrong.
    if (isPolicyDeniedMessage(record.error)) return []
    return [
      `Avoid repeating this failure pattern: ${generalizeIncident(record.error).slice(0, 200)}`,
    ]
  }
  if (record.reviewScore !== undefined && record.reviewScore < 6) {
    return [
      `Recent ${record.agentRole} work scored ${record.reviewScore}/10 — double-check completeness before submitting.`,
    ]
  }
  if (
    record.reviewScore !== undefined &&
    record.reviewScore >= 8 &&
    output &&
    output.trim().length > 0
  ) {
    return [`Pattern that worked: ${generalizeIncident(output).slice(0, 160)}`]
  }
  return []
}
