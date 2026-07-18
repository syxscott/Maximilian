// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Task prioritizer (借鉴 AutoGPT TaskPrioritizer).
 * @see https://github.com/Significant-Gravitas/AutoGPT/blob/master/autogpt/app/task_prioritizer.py
 *
 * After each wave, the runtime calls `TaskPrioritizer.reRank()` to reorder
 * the remaining tasks based on recent execution results and the overall goal.
 * This lets the planner adapt dynamically rather than following a static order.
 */

import type { Provider } from "@max/providers";
import type { ChatMessage } from "@max/providers";
import type { Task, TaskPriority } from "./types.js";
import type { Result } from "./types.js";

/**
 * Options for constructing a TaskPrioritizer.
 */
export interface TaskPrioritizerOptions {
  /** LLM provider to use for re-ranking. */
  llm: Provider;
  /** Model to use (default: provider default). */
  model?: string;
}

/**
 * Prompt template for task re-ranking.
 * The LLM receives the current goal, recent results, and the pending task
 * list, and returns a prioritized ordering with optional scope changes.
 */
function buildReRankPrompt(
  tasks: Task[],
  context: { recentResults: Result[]; goal: string },
): string {
  const taskList = tasks
    .map(
      (t, i) =>
        `${i + 1}. [${t.agentRole}] ${t.description}${t.dependsOn.length > 0 ? ` (depends on: ${t.dependsOn.join(", ")})` : ""}`,
    )
    .join("\n");

  const resultSummary = context.recentResults
    .slice(-5)
    .map((r) => `[${r.agentRole}] ${r.output.slice(0, 150)}`)
    .join("\n");

  return `You are a task prioritization agent. Given the overall goal and recent execution results,
re-order the pending tasks to maximize progress toward the goal.

Goal: ${context.goal}

Recent results (last 5):
${resultSummary || "(no results yet)"}

Pending tasks:
${taskList}

Respond with a JSON array of task priorities. Each entry specifies the task index (1-based),
a priority level, and optionally a revised scope for the task:
[
  { "taskId": "<task id>", "priority": "high" | "medium" | "low", "newScope": "<optional revised description>" },
  ...
]

Rules:
- high = do next, medium = do later, low = deprioritize
- If a task's scope is wrong or too broad, use newScope to tighten it
- Preserve dependency constraints (don't move a task before its dependency)
- Respond with ALL tasks, not just the high-priority ones
- Respond with valid JSON only, no markdown or explanation`;
}

/**
 * Task prioritizer using LLM-based re-ranking.
 * After each wave, the runtime passes pending tasks and recent results to
 * this class to get a revised ordering that adapts to what was learned.
 */
export class TaskPrioritizer {
  constructor(private opts: TaskPrioritizerOptions) {}

  /**
   * Re-rank a list of tasks based on recent results and the overall goal.
   *
   * @param tasks - current pending tasks (all tasks from the plan)
   * @param context - goal string and recent results for context
   * @returns array of TaskPriority with new ordering/priorities/scopes
   */
  async reRank(
    tasks: Task[],
    context: { recentResults: Result[]; goal: string },
  ): Promise<TaskPriority[]> {
    const prompt = buildReRankPrompt(tasks, context);

    const messages: ChatMessage[] = [{ role: "user", content: prompt }];

    const response = await this.opts.llm.chat(messages, {
      model: this.opts.model,
      temperature: 0.3, // slightly creative for re-scoping
    });

    let parsed: TaskPriority[] | null;
    try {
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      const raw = jsonMatch ? jsonMatch[0]! : response.content;
      const value = JSON.parse(raw);
      parsed = Array.isArray(value) ? value : null;
    } catch {
      parsed = null;
    }
    if (!parsed) {
      // Fallback: return tasks in their original order with medium priority
      parsed = tasks.map((t) => ({ taskId: t.id, priority: "medium" as const }));
    }

    // Validate: ensure all task ids are present
    const taskIds = new Set(tasks.map((t) => t.id));
    const valid = parsed.filter((p) => taskIds.has(p.taskId));
    if (valid.length !== tasks.length) {
      // Some ids didn't match — supplement with medium-priority for missing ones
      const covered = new Set(valid.map((p) => p.taskId));
      for (const t of tasks) {
        if (!covered.has(t.id)) {
          valid.push({ taskId: t.id, priority: "medium" });
        }
      }
    }

    return valid;
  }
}
