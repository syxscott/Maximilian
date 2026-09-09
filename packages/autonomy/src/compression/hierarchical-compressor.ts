// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Hierarchical Context Compression (mirrored from Kosmos compressor).
 *
 * 4-layer tiered compression at 20:1 ratio target:
 *   Tier 1 (Task): notebook/artifact -> 2-line summary + stats (300:1)
 *   Tier 2 (Cycle): 10 tasks -> 1 cycle overview (10:1)
 *   Tier 3 (Final): 20 cycles -> research narrative (5:1)
 *   Tier 4 (Detail): lazy-loaded full content on demand
 *
 * Kosmos reference:
 *   https://raw.githubusercontent.com/jimmc414/Kosmos/master/kosmos/compression/compressor.py
 */

export interface Tier1Task {
  taskId: string;
  summary: string;
  stats: {
    pValue?: number;
    effectSize?: number;
    sampleSize?: number;
  };
  status: "completed" | "failed";
}

export interface Tier2Cycle {
  cycleId: number;
  overview: string;
  taskCount: number;
  completedCount: number;
  failedCount: number;
  keyFinding?: string;
}

export interface Tier3Narrative {
  narrative: string;
  cycleCount: number;
  totalTasks: number;
  domains: string[];
}

export interface CompressionConfig {
  tier1TargetRatio: number;
  tier2TargetRatio: number;
  tier3TargetRatio: number;
}

const DEFAULT_CONFIG: CompressionConfig = {
  tier1TargetRatio: 300,
  tier2TargetRatio: 10,
  tier3TargetRatio: 5,
};

/** Extract statistical summaries from task results (regex-based for common formats). */
function extractStats(content: string): Tier1Task["stats"] {
  const stats: Tier1Task["stats"] = {};
  const pMatch = content.match(/p\s*[=:]\s*([0-9.]+)/);
  if (pMatch) stats.pValue = parseFloat(pMatch[1]);
  const effectMatch = content.match(/effect\s*size[:\s=]+([0-9.]+)/i);
  if (effectMatch) stats.effectSize = parseFloat(effectMatch[1]);
  const nMatch = content.match(/n\s*[=:]\s*(\d+)/);
  if (nMatch) stats.sampleSize = parseInt(nMatch[1], 10);
  return stats;
}

/** Tier 1: compress a task output to 2-line summary + stats. */
export function compressTask(
  taskId: string,
  content: string,
  _config: CompressionConfig = DEFAULT_CONFIG,
): Tier1Task {
  // Heuristic: take first line + last significant line
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const summary = lines.length > 0 ? lines[0].slice(0, 120) : "(empty)";
  return {
    taskId,
    summary: summary + (lines.length > 1 ? " ... " + lines[lines.length - 1].slice(0, 80) : ""),
    stats: extractStats(content),
    status: content.includes("error") ? "failed" : "completed",
  };
}

/** Tier 2: compress a cycle's tasks into a cycle overview. */
export function compressCycle(
  cycleId: number,
  tasks: Tier1Task[],
  _config: CompressionConfig = DEFAULT_CONFIG,
): Tier2Cycle {
  const completed = tasks.filter((t) => t.status === "completed");
  const failed = tasks.filter((t) => t.status === "failed");
  const keyFinding = completed.find((t) => t.stats.pValue)?.taskId ?? completed[0]?.taskId;
  return {
    cycleId,
    overview: `Cycle ${cycleId}: ${completed.length} completed, ${failed.length} failed`,
    taskCount: tasks.length,
    completedCount: completed.length,
    failedCount: failed.length,
    keyFinding: keyFinding ? `Task ${keyFinding}` : undefined,
  };
}

/** Tier 3: compress cycles into research narrative. */
export function compressNarrative(
  cycles: Tier2Cycle[],
  _config: CompressionConfig = DEFAULT_CONFIG,
): Tier3Narrative {
  const domains = [...new Set(
    cycles.flatMap((c) => c.overview.split(" ")).filter((w) => w.length > 5).slice(0, 10),
  )];
  return {
    narrative: cycles.map((c) => c.overview).join("; "),
    cycleCount: cycles.length,
    totalTasks: cycles.reduce((a, c) => a + c.taskCount, 0),
    domains,
  };
}

export { DEFAULT_CONFIG };
