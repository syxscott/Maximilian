// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SubagentsPanel — live "what are my agents doing" rows (ZCode GUI
 * borrowing: the subagent session side panes). One row per task derived
 * from the workspace event stream: role, state, last tool + outcome,
 * parked-permission flag, steering count. Pure derivation — no fetching.
 */

import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useLocale, t } from "@max/i18n"
import { deriveAgentRuns, type AgentRunState } from "@/lib/agent-events"
import type { RuntimeEvent } from "@/api"
import { useSessionProjectionStore } from "@/stores/sessionProjectionStore"

const STATE_BADGE: Record<
  AgentRunState,
  { variant: "default" | "secondary" | "destructive" | "outline"; key: string }
> = {
  running: { variant: "default", key: "subagents.state.running" },
  completed: { variant: "secondary", key: "subagents.state.completed" },
  failed: { variant: "destructive", key: "subagents.state.failed" },
  skipped: { variant: "outline", key: "subagents.state.skipped" },
}

export function SubagentsPanel({ events: eventsProp }: { events?: RuntimeEvent[] }) {
  useLocale()
  // Session projection store (App injects the workspace event stream via
  // setEvents); an explicit prop still wins so callers can render in isolation.
  const storeEvents = useSessionProjectionStore((s) => s.events)
  const events = eventsProp ?? storeEvents
  const runs = useMemo(() => [...deriveAgentRuns(events).values()], [events])
  // Running first, then failures, then the rest — newest task ids first
  // within a group (Map preserves insertion order = stream order).
  const ordered = useMemo(
    () =>
      [...runs].sort((a, b) => {
        const rank = (s: AgentRunState) => (s === "running" ? 0 : s === "failed" ? 1 : 2)
        return rank(a.state) - rank(b.state)
      }),
    [runs],
  )

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {t("subagents.title")}
          <span className="ml-2 text-xs text-muted-foreground">
            {runs.filter((r) => r.state === "running").length} {t("subagents.runningCount")}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {ordered.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("subagents.empty")}</p>
        ) : (
          <ul className="space-y-2" data-testid="subagents-list">
            {ordered.map((run) => (
              <li key={run.taskId} className="rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-medium">{run.agentRole}</span>
                  <Badge variant={STATE_BADGE[run.state].variant} className="h-4 px-1 text-[10px]">
                    {t(STATE_BADGE[run.state].key)}
                  </Badge>
                  {run.permissionPending && (
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">
                      {t("subagents.permissionPending")}
                    </Badge>
                  )}
                  {run.steeringCount > 0 && (
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">
                      ⇄ {run.steeringCount}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {run.lastTool
                    ? `${t("subagents.lastTool")}: ${run.lastTool.name}${run.lastTool.ok === false ? ` · ${t("subagents.toolFailed")}` : ""}`
                    : run.agentId
                      ? `${t("subagents.agent")}: ${run.agentId}`
                      : run.taskId}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
