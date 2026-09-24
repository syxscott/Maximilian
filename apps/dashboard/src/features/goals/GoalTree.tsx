// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * GoalTree — the goal tree component (deepseek ui-goal borrowing,
 * honest-data edition): a progress ring for the primary goal (the user
 * request), the plan's tasks as a sub-goal list (role color dot + state
 * icon + dependency indent from the dependsOn chain), and the derived
 * milestones. Every number on screen comes from the workspace payload —
 * the panel discloses which sources contributed and how the headline
 * percent was computed. There is no separate goals backend.
 */

import { useMemo } from "react"
import {
  Ban,
  CheckCircle2,
  Circle,
  Flag,
  ListTree,
  Loader2,
  SkipForward,
  Target,
  XCircle,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useLocale, t } from "@max/i18n"
import { deriveGoals, roleColor } from "./model"
import type { GoalMilestoneView, GoalTaskView } from "./model"

/** Ring geometry — pure SVG, no chart dependency. */
const RING_RADIUS = 28
const RING_STROKE = 5
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

const STATE_ICONS: Record<string, typeof Circle> = {
  completed: CheckCircle2,
  failed: XCircle,
  running: Loader2,
  pending: Circle,
  skipped: SkipForward,
  cancelled: Ban,
  unknown: Circle,
}

const STATE_ICON_CLASSES: Record<string, string> = {
  completed: "text-emerald-500",
  failed: "text-destructive",
  running: "text-blue-500 animate-spin",
  pending: "text-muted-foreground",
  skipped: "text-muted-foreground",
  cancelled: "text-muted-foreground",
  unknown: "text-muted-foreground",
}

const MILESTONE_ICONS: Record<string, typeof Circle> = {
  plan: ListTree,
  execution: Target,
  review: Flag,
}

function StateIcon({ state }: { state: string }) {
  const Icon = STATE_ICONS[state] ?? Circle
  return (
    <Icon
      className={`h-3.5 w-3.5 shrink-0 ${STATE_ICON_CLASSES[state] ?? STATE_ICON_CLASSES.unknown}`}
      aria-hidden
    />
  )
}

function MilestoneRow({ milestone }: { milestone: GoalMilestoneView }) {
  const Icon = MILESTONE_ICONS[milestone.key] ?? Circle
  return (
    <li
      className="flex items-center gap-1.5"
      data-testid={`goal-milestone-${milestone.key}`}
      data-done={milestone.done ? "true" : "false"}
    >
      {milestone.done ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
      ) : (
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span
        className={milestone.done ? "text-xs text-foreground" : "text-xs text-muted-foreground"}
      >
        {t(`goals.milestone.${milestone.key}`)}
      </span>
      {milestone.key === "plan" && milestone.taskCount !== null && milestone.taskCount > 0 && (
        <span className="text-[10px] text-muted-foreground">
          {t("goals.taskCount", { count: milestone.taskCount })}
        </span>
      )}
      {milestone.key === "review" && milestone.score !== null && (
        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
          {t("goals.reviewScore", { score: milestone.score })}
        </Badge>
      )}
      <span className="text-[10px] text-muted-foreground">
        {milestone.done ? t("goals.milestone.done") : t("goals.milestone.pending")}
      </span>
    </li>
  )
}

function SubGoalRow({ task }: { task: GoalTaskView }) {
  const deps =
    task.dependsOn.length > 0 ? t("goals.dependsOn", { deps: task.dependsOn.join(", ") }) : null
  return (
    <li
      className="flex items-start gap-2 rounded px-1 py-0.5"
      style={{ marginLeft: `${task.depth * 16}px` }}
      data-testid={`subgoal-${task.id}`}
      data-state={task.state}
      data-depth={task.depth}
    >
      <span
        className="mt-1 h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: roleColor(task.role) }}
        aria-hidden
      />
      <StateIcon state={task.state} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs" title={task.label}>
          {task.label || task.id}
        </span>
        <span className="block text-[10px] text-muted-foreground">
          {task.role} · {t(`goals.state.${task.state}`)}
          {deps && <span className="ml-1">{deps}</span>}
        </span>
      </span>
    </li>
  )
}

export function GoalTree({ workspace }: { workspace: unknown }) {
  useLocale()
  const view = useMemo(() => deriveGoals(workspace), [workspace])
  const dash = (view.primary.percent / 100) * RING_CIRCUMFERENCE

  return (
    <Card data-testid="goal-tree">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("goals.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("goals.description")}</p>
        {view.sources.length > 0 && (
          <p className="text-[10px] text-muted-foreground" data-testid="goal-sources">
            {t("goals.dataSource", {
              sources: view.sources.map((s) => t(`goals.source.${s}`)).join(" · "),
            })}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {view.sources.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="goals-empty">
            {t("goals.empty")}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3" data-testid="goal-primary">
              <svg
                width={RING_RADIUS * 2 + RING_STROKE * 2}
                height={RING_RADIUS * 2 + RING_STROKE * 2}
                viewBox={`0 0 ${RING_RADIUS * 2 + RING_STROKE * 2} ${RING_RADIUS * 2 + RING_STROKE * 2}`}
                role="img"
                aria-label={t("goals.summary.percent", { percent: view.primary.percent })}
                data-testid="goal-progress-ring"
              >
                <circle
                  cx={RING_RADIUS + RING_STROKE}
                  cy={RING_RADIUS + RING_STROKE}
                  r={RING_RADIUS}
                  fill="none"
                  stroke="currentColor"
                  className="text-muted"
                  strokeWidth={RING_STROKE}
                />
                <circle
                  cx={RING_RADIUS + RING_STROKE}
                  cy={RING_RADIUS + RING_STROKE}
                  r={RING_RADIUS}
                  fill="none"
                  stroke="currentColor"
                  className={view.primary.percent >= 100 ? "text-emerald-500" : "text-primary"}
                  strokeWidth={RING_STROKE}
                  strokeLinecap="round"
                  strokeDasharray={`${dash} ${RING_CIRCUMFERENCE - dash}`}
                  transform={`rotate(-90 ${RING_RADIUS + RING_STROKE} ${RING_RADIUS + RING_STROKE})`}
                />
                <text
                  x="50%"
                  y="50%"
                  dominantBaseline="central"
                  textAnchor="middle"
                  className="fill-current text-[10px] font-medium"
                >
                  {view.primary.percent}%
                </text>
              </svg>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("goals.primary")}
                </p>
                <p className="truncate text-sm" title={view.request}>
                  {view.request || t("goals.empty")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(`goals.status.${view.status}`)} ·{" "}
                  {t(`goals.basis.${view.primary.basis}`, {
                    completed: view.primary.completed,
                    total: view.primary.total,
                    failed: view.primary.failed,
                  })}
                </p>
              </div>
            </div>

            <ul className="flex flex-wrap gap-x-4 gap-y-1" data-testid="goal-milestones">
              {view.milestones.map((milestone) => (
                <MilestoneRow key={milestone.key} milestone={milestone} />
              ))}
            </ul>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{t("goals.subGoals")}</p>
              {view.subGoals.length === 0 ? (
                <p className="text-xs text-muted-foreground" data-testid="goals-no-plan">
                  {t("goals.noPlan")}
                </p>
              ) : (
                <ul className="space-y-0.5" data-testid="goal-subgoals">
                  {view.subGoals.map((task) => (
                    <SubGoalRow key={task.id} task={task} />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
