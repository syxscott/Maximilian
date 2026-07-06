/**
 * PlannerObserver — self-refinement after each plan step (借鉴 crewAI).
 *
 * crewAI's PlannerObserver hooks into the step executor and runs after
 * EVERY step (not just failures). It analyzes what happened via an LLM
 * and emits structured events: StepObservationStarted/Completed/Failed,
 * PlanRefinement, PlanReplanTriggered, GoalAchievedEarly. It can also
 * apply in-memory refinements to remaining todos without a second LLM call.
 *
 * Maximilian's adaptation runs after each stall observation / wave in
 * AgentRuntime and emits a `plan-observation` runtime event carrying:
 *   - stepSuccess: did the last wave make progress?
 *   - refinedRemaining: optional list of refined task descriptions
 *   - replanSuggested: should the caller invoke a replanner?
 *   - goalAchievedEarly: is the workspace done before all tasks run?
 *
 * The observer is purely informational — it does NOT mutate the plan
 * itself. Callers (or the AgentRuntime's onStall hook) decide whether
 * to act on its suggestions.
 */

import type { Task, Result } from "./types.js"

export type ObservationReason =
  | "progress"
  | "stall"
  | "loop"
  | "all-tasks-completed"
  | "goal-achieved-early"

export interface StepObservation {
  reason: ObservationReason
  /** Did the last wave make progress? */
  stepSuccess: boolean
  /** Free-form message describing the observation. */
  message: string
  /** Optional list of refined task descriptions (sharper scope/wording). */
  refinedRemaining?: Array<{ taskId: string; newDescription: string }>
  /** True if the observer thinks the plan should be re-planned entirely. */
  replanSuggested: boolean
  /** True if the goal appears to be met before all tasks run. */
  goalAchievedEarly: boolean
}

/**
 * Observe a step's progress + remaining tasks and return a StepObservation.
 *
 * Heuristic rules (mirrors crewAI's heuristic_observation):
 *   - If no remaining tasks → "all-tasks-completed" with goalAchievedEarly=true
 *   - If last wave had any completed tasks → "progress"
 *   - If last wave had no completions → "stall"
 *   - If results contain repeated identical outputs (3+ in a row) → "loop"
 */
export function observeStep(
  prevCompleted: number,
  currentCompleted: number,
  remainingTasks: Task[],
  results: Result[],
): StepObservation {
  const progressed = currentCompleted > prevCompleted

  if (remainingTasks.length === 0) {
    return {
      reason: "all-tasks-completed",
      stepSuccess: true,
      message: "All remaining tasks consumed — workspace done.",
      goalAchievedEarly: true,
      replanSuggested: false,
    }
  }

  if (progressed) {
    return {
      reason: "progress",
      stepSuccess: true,
      message: `Made progress: ${currentCompleted - prevCompleted} new completed tasks.`,
      goalAchievedEarly: false,
      replanSuggested: false,
    }
  }

  // No progress: check for repeating outputs (loop detection, lightweight).
  if (detectRepeatingOutputs(results)) {
    return {
      reason: "loop",
      stepSuccess: false,
      message: "Detected repeating outputs across recent results — likely in a loop.",
      goalAchievedEarly: false,
      replanSuggested: true,
    }
  }

  // Stalled — no progress, no loop.
  return {
    reason: "stall",
    stepSuccess: false,
    message: "No progress in last wave — stall suspected.",
    goalAchievedEarly: false,
    replanSuggested: remainingTasks.length > 0,
  }
}

/**
 * Cheap loop heuristic: if the last 3 results have identical output (after
 * a quick normalization), we suspect the agent is repeating itself.
 * This is intentionally simpler than StallDetector's 4-gram hash —
 * it operates on whole outputs and only needs ≥3 matches.
 */
function detectRepeatingOutputs(results: Result[]): boolean {
  if (results.length < 3) return false
  const tail = results.slice(-3).map((r) => normalize(r.output))
  return tail[0] !== "" && tail.every((t) => t === tail[0])
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim()
}