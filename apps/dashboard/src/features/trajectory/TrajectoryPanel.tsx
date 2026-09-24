// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * TrajectoryPanel — per-task model/tool trajectory (ZCode GUI borrowing:
 * the modelTrajectory side pane). Renders the chronological decision
 * stream for one task: task lifecycle, tool calls with outcomes, LLM
 * retry waves, permission prompts, steering waves. Pure derivation from
 * the workspace event stream (see lib/agent-events.ts) — no fetching.
 */

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useLocale, t } from "@max/i18n"
import { deriveTrajectory, type TrajectoryEntry } from "@/lib/agent-events"
import {
  useTrajectoryExpanded,
  useTrajectoryToggleExpanded,
  useTrajectoryWindowSize,
  windowTrajectoryEntries,
} from "@/stores/trajectoryStore"
import type { RuntimeEvent } from "@/api"
import { useSessionProjectionStore } from "@/stores/sessionProjectionStore"
import { useTaskSelectionStore, useSelectedTaskId } from "@/stores/taskSelectionStore"

const KIND_STYLE: Record<TrajectoryEntry["kind"], string> = {
  task: "text-foreground",
  tool: "text-muted-foreground",
  retry: "text-amber-600 dark:text-amber-400",
  permission: "text-blue-600 dark:text-blue-400",
  steering: "text-purple-600 dark:text-purple-400",
}

/** Distinct task ids seen on the stream, in arrival order (filter options). */
function deriveTaskIds(events: RuntimeEvent[]): string[] {
  const ids: string[] = []
  for (const e of events) {
    const id = (e as { taskId?: unknown }).taskId
    if (typeof id === "string" && !ids.includes(id)) ids.push(id)
  }
  return ids
}

export function TrajectoryPanel({
  events: eventsProp,
  taskIds: taskIdsProp,
}: {
  /** Live events; omitted = read the sessionProjectionStore (App-injected). */
  events?: RuntimeEvent[]
  /** Task ids seen in this workspace (for the filter select); omitted =
   *  derived from the sessionProjectionStore events. */
  taskIds?: string[]
}) {
  useLocale()
  // Session projection store (App injects the workspace event stream via
  // setEvents); explicit props still win so callers can render in isolation.
  const storeEvents = useSessionProjectionStore((s) => s.events)
  const events = eventsProp ?? storeEvents
  const taskIds = useMemo(() => taskIdsProp ?? deriveTaskIds(events), [taskIdsProp, events])
  // Cross-pane task selection: the filter reads the same store the task
  // panel writes ("taskPanel" source), so selecting a task there focuses
  // this pane's timeline. Picking a task here records a "timeline" source;
  // picking "all" clears the shared selection.
  const selectedTaskId = useSelectedTaskId()
  const expanded = useTrajectoryExpanded()
  const toggleExpanded = useTrajectoryToggleExpanded()
  const windowSize = useTrajectoryWindowSize()
  const filter = selectedTaskId ?? "all"

  const entries = useMemo(() => {
    const all = deriveTrajectory(events, filter === "all" ? undefined : filter)
    return windowTrajectoryEntries(all, windowSize, expanded)
  }, [events, filter, expanded])

  const onFilterChange = (value: string) => {
    if (value === "all") {
      useTaskSelectionStore.getState().clear()
    } else {
      useTaskSelectionStore.getState().select(value, "timeline")
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{t("trajectory.title")}</CardTitle>
        <div className="flex items-center gap-2">
          <select
            aria-label={t("trajectory.filter")}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
          >
            <option value="all">{t("trajectory.filter.all")}</option>
            {taskIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("trajectory.empty")}</p>
        ) : (
          <>
            <ol className="space-y-1 font-mono text-xs" data-testid="trajectory-list">
              {entries.map((entry, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className={KIND_STYLE[entry.kind]}>
                    {entry.kind === "task"
                      ? "●"
                      : entry.kind === "retry"
                        ? "↻"
                        : entry.kind === "permission"
                          ? "-key"
                          : entry.kind === "steering"
                            ? "⇄"
                            : "▸"}
                  </span>
                  <span className={KIND_STYLE[entry.kind]}>{entry.label}</span>
                  {entry.detail && (
                    <span className="truncate text-muted-foreground">{entry.detail}</span>
                  )}
                  {entry.ok === false && (
                    <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                      {t("trajectory.failed")}
                    </Badge>
                  )}
                </li>
              ))}
            </ol>
            {(filter === "all" ? deriveTrajectory(events).length > 40 : false) && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-6 text-xs"
                onClick={toggleExpanded}
              >
                {expanded ? t("trajectory.collapse") : t("trajectory.expand")}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
