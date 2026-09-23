// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * WorkflowRunsPanel (P4) — the workflow-engine consumer view: known runs
 * in this process with step counts and script identity (ZCode workflow
 * timeline borrowing, minimal form).
 */

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useLocale, t } from "@max/i18n"
import { workflowApi } from "@/api"

export function WorkflowRunsPanel() {
  useLocale()
  const { data, isLoading } = useQuery({
    queryKey: ["workflows", "runs"],
    queryFn: ({ signal }) => workflowApi.list(signal),
    staleTime: 15_000,
    refetchInterval: 15_000,
  })
  const runs = data?.runs ?? []

  return (
    <Card data-testid="workflow-runs">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("workflows.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : runs.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("workflows.empty")}</p>
        ) : (
          <ul className="space-y-1" data-testid="workflow-run-list">
            {runs.map((run) => (
              <li
                key={run.runId}
                className="flex items-center justify-between rounded border px-2 py-1.5"
              >
                <span className="font-mono text-xs">{run.runId}</span>
                <div className="flex items-center gap-1.5">
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    ✓ {run.completedSteps}
                  </Badge>
                  {run.failedSteps > 0 && (
                    <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                      ✗ {run.failedSteps}
                    </Badge>
                  )}
                  {run.scriptHash && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {run.scriptHash}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
