// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Goals feature domain (deepseek ui-goal borrowing, honest-data
 * edition): the goal tree is derived entirely from real workspace
 * objects — user request, plan tasks, results, review — with the data
 * provenance disclosed in the UI. Public surface only — consumers
 * import from here, never from domain internals.
 */

export { GoalTree } from "./GoalTree"
export { GoalSummaryCard } from "./GoalSummaryCard"
export { GoalEvolutionPanel } from "./GoalEvolutionPanel"
export {
  deriveGoals,
  dependencyDepths,
  roleColor,
  matchRoleEntries,
  normalizeAcceptance,
  parseRoleDetail,
} from "./model"
export type {
  GoalMilestoneKey,
  GoalMilestoneView,
  GoalProgress,
  GoalProgressBasis,
  GoalSourceKey,
  GoalSummaryView,
  GoalTaskState,
  GoalTaskView,
  GoalsView,
  RolePerformanceEntry,
  RoleEvolutionDetail,
} from "./model"
