// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Stable request hash + results persistence for incremental reruns
 * (borrowing MiniMax-Provider-Verifier verify.py:27-30 compute_hash,
 * verify.py:240-246 read_result_jsonl, verify.py:432-477 incremental
 * validate_file).
 *
 * `compute_hash` in the verifier is `md5(json.dumps(obj, sort_keys=True,
 * ensure_ascii=False))`; the TS counterpart is canonical JSON (object
 * keys recursively sorted, arrays in order, non-ASCII kept raw) + md5.
 */

import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import type { BenchmarkResult } from "./types.js"

/**
 * Canonical JSON with sort_keys semantics: object keys recursively
 * sorted, array order preserved, non-ASCII characters kept raw (Python
 * `ensure_ascii=False`).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

/** md5 of the canonical JSON — stable across processes and runs. */
export function stableHash(value: unknown): string {
  return createHash("md5").update(canonicalJson(value)).digest("hex")
}

/**
 * The prepared request a benchmark case corresponds to (verify.py
 * `prepare_request` + hash input). The assertion function is NOT part of
 * the request — it is local evaluation logic, not something sent to the
 * model — so editing it alone does not invalidate a successful result.
 */
export function prepareBenchmarkRequest(task: {
  id: string
  domain: string
  difficulty: string
  input: string
  context: Record<string, unknown>
  systemPrompt: string
  userMessage: string
}): Record<string, unknown> {
  return {
    taskId: task.id,
    domain: task.domain,
    difficulty: task.difficulty,
    input: task.input,
    context: task.context,
    systemPrompt: task.systemPrompt,
    userMessage: task.userMessage,
  }
}

/**
 * Load existing results from a results JSONL file (verify.py
 * read_result_jsonl). Lines that fail to parse or lack the result shape
 * are skipped so a torn last line from a crashed run degrades to
 * "that case reruns".
 */
export async function loadPersistedResults(path: string): Promise<BenchmarkResult[]> {
  let raw: string
  try {
    raw = await fs.readFile(path, "utf-8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
    throw err
  }
  const results: BenchmarkResult[] = []
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (isBenchmarkResult(parsed)) results.push(parsed)
    } catch {
      // Torn/corrupt line — skip; the affected case will rerun.
    }
  }
  return results
}

function isBenchmarkResult(value: unknown): value is BenchmarkResult {
  if (typeof value !== "object" || value === null) return false
  const r = value as Record<string, unknown>
  return (
    typeof r["taskId"] === "string" &&
    typeof r["passed"] === "boolean" &&
    typeof r["quality"] === "number" &&
    typeof r["output"] === "string"
  )
}

/** Write results as JSONL (one BenchmarkResult per line). */
export async function saveResultsJsonl(
  path: string,
  results: readonly BenchmarkResult[],
): Promise<void> {
  const body = results.map((r) => JSON.stringify(r)).join("\n")
  const tmp = `${path}.${process.pid}.tmp`
  await fs.writeFile(tmp, body + (results.length > 0 ? "\n" : ""), "utf-8")
  await fs.rename(tmp, path)
}
