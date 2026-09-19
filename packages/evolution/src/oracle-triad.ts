// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Oracle-triad protocol (C2C borrowing, §A.3.1 + Table 1).
 *
 * Before investing in a lesson corpus, measure the CEILING of injection
 * value: run the SAME task three times with the ONLY variable being what
 * context is injected —
 *
 *   direct    = base manifest, no memory prelude
 *   few-shot  = base manifest + the CURRENT auto-collected memory prelude
 *   oracle    = base manifest + hand-curated oracle lessons (the best
 *               injection a strong teacher could give)
 *
 * PGR (performance-gap-recovered) = (few-shot − direct) / (oracle − direct):
 * how much of the achievable gain the current corpus actually recovers.
 * A small oracle−direct gap means the bottleneck is NOT context injection
 * — stop investing in lessons; a large gap with low PGR means the corpus
 * needs work.
 *
 * Discipline (from the paper): the oracle corpus must be DISJOINT from the
 * evaluation tasks (no leakage); decoding config and judging must be
 * identical across the three arms.
 */

import { promises as fs } from "node:fs"
import path from "node:path"
import type { AgentManifest, Task } from "@max/core"
import type { AgentProfile } from "./types.js"
import { AgentMemoryStore } from "./memory.js"
import type { ProfileStore } from "./profile-store.js"

export interface OracleTriadVariantResult {
  arm: "direct" | "few-shot" | "oracle"
  /** Judge quality 0..10 for this arm. */
  quality: number
  durationMs: number
  raw: unknown
}

export interface OracleTriadReport {
  role: string
  taskId: string
  direct: OracleTriadVariantResult
  fewShot: OracleTriadVariantResult
  oracle: OracleTriadVariantResult
  /**
   * Share of the oracle gap recovered by the current corpus, 0..1+.
   * undefined when the oracle arm does not beat direct (no recoverable gap).
   */
  pgr: number | undefined
  interpretation: string
}

export interface OracleTriadExecutor {
  /** Execute a task with the given manifest (system prompt determines the arm). */
  executeWithManifest(
    task: Task,
    manifest: AgentManifest,
  ): Promise<{ output: string; durationMs?: number }>
}

export interface OracleTriadDeps {
  profiles: ProfileStore
  executor: OracleTriadExecutor
  /** Directory of hand-curated lessons: `<dir>/<role>.md`. MUST be disjoint from eval tasks. */
  oracleLessonsDir: string
  /** Scoring function shared by all three arms (identical judging discipline). */
  judge: (output: string, task: Task) => Promise<number> | number
}

export class OracleLessonsMissingError extends Error {
  readonly role: string
  constructor(role: string, dir: string) {
    super(
      `oracle lessons not curated for role "${role}" (expected ${path.join(dir, `${role}.md`)})`,
    )
    this.name = "OracleLessonsMissingError"
    this.role = role
  }
}

async function runArm(
  arm: OracleTriadVariantResult["arm"],
  task: Task,
  base: AgentManifest,
  prelude: string,
  deps: OracleTriadDeps,
): Promise<OracleTriadVariantResult> {
  const manifest: AgentManifest = prelude
    ? { ...base, systemPrompt: `${base.systemPrompt}\n${prelude}` }
    : { ...base }
  const started = Date.now()
  const result = await deps.executor.executeWithManifest(task, manifest)
  const durationMs = result.durationMs ?? Date.now() - started
  return { arm, quality: await deps.judge(result.output, task), durationMs, raw: result }
}

/**
 * Run the three-arm triad for one (role, task). Never throws for missing
 * oracle lessons unless `requireOracle` is set — a missing corpus is the
 * signal to curate one, and the caller may want to surface that as a task.
 */
export async function runOracleTriad(
  deps: OracleTriadDeps,
  task: Task,
  opts: {
    role: string
    baseManifest: AgentManifest
    requireOracle?: boolean
  },
): Promise<OracleTriadReport> {
  // role is an open string (DAGS-generated slugs like "reviewer-2" are
  // valid); the core AgentRole union only covers the built-in quartet.
  const profile: AgentProfile = await deps.profiles.getOrCreate(opts.role as never, opts.baseManifest)
  const currentPrelude = AgentMemoryStore.toPrelude(profile.memory)

  const oracleFile = path.join(deps.oracleLessonsDir, `${opts.role}.md`)
  let oracleLessons: string
  try {
    oracleLessons = await fs.readFile(oracleFile, "utf8")
  } catch {
    if (opts.requireOracle) throw new OracleLessonsMissingError(opts.role, deps.oracleLessonsDir)
    oracleLessons = ""
  }
  const oraclePrelude = oracleLessons.trim()
    ? `# Oracle lessons (hand-curated; disjoint from evaluation tasks)\n${oracleLessons.trim()}`
    : ""

  const direct = await runArm("direct", task, opts.baseManifest, "", deps)
  const fewShot = await runArm("few-shot", task, opts.baseManifest, currentPrelude, deps)
  const oracle = await runArm("oracle", task, opts.baseManifest, oraclePrelude, deps)

  const gap = oracle.quality - direct.quality
  const pgr = gap > 0.05 ? Math.max(0, (fewShot.quality - direct.quality) / gap) : undefined

  let interpretation: string
  if (pgr === undefined) {
    interpretation =
      "oracle ≤ direct: context injection has no recoverable headroom for this role/task — stop investing in the lesson corpus"
  } else if (pgr >= 0.7) {
    interpretation = "current corpus recovers most of the achievable gain — maintain"
  } else if (pgr >= 0.3) {
    interpretation = "current corpus recovers part of the gap — curate more/better lessons"
  } else {
    interpretation =
      "large headroom but the corpus recovers almost none of it — corpus quality is the bottleneck"
  }

  return { role: opts.role, taskId: task.id, direct, fewShot, oracle, pgr, interpretation }
}
