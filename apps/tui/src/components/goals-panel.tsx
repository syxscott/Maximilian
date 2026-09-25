import React, { useCallback, useEffect, useState } from "react"
import { t } from "@max/i18n"
import { Box, Text, useInput } from "ink"
import Spinner from "ink-spinner"

import type { ExecutionTrace } from "../api"
import { useSDK } from "../context/sdk"
import {
  dependsOnSummary,
  deriveGoals,
  failureSummary,
  taskStateColor,
  type GoalsView,
} from "./goals-model"
import "../locales/tui-panels"

/**
 * Goals panel — the TUI face of the dashboard's features/goals derivation:
 * there is no goals backend, the tree is derived from the current
 * workspace object (GET /api/workspaces/{id}) with the same semantics as
 * the dashboard (primary goal ← userRequest × status; sub-goals ←
 * plan.tasks with dependsOn depth; milestones ← plan / execution / review,
 * including the review score).
 *
 * "Current workspace" resolution, honest by construction: an explicit
 * `workspaceId` prop wins; otherwise the latest execution's workspaceId
 * (the same source the --continue flag uses); otherwise the panel shows an
 * empty state instead of pretending.
 */
export interface GoalsPanelProps {
  workspaceId?: string
}

export function GoalsPanel(props: GoalsPanelProps) {
  const sdk = useSDK()
  const [goals, setGoals] = useState<GoalsView | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(props.workspaceId ?? null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    const ctrl = new AbortController()
    let cancelled = false

    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        // Resolve which workspace to derive from (explicit prop > latest run).
        let target = props.workspaceId ?? null
        if (target == null) {
          const executions = await sdk.client.get<{ count: number; executions: ExecutionTrace[] }>(
            "/api/obs/executions",
          )
          if (cancelled || ctrl.signal.aborted) return
          const list = Array.isArray(executions?.executions) ? executions.executions : []
          target =
            list.find((e) => e && typeof e.workspaceId === "string" && e.workspaceId.length > 0)
              ?.workspaceId ?? null
        }
        if (target == null) {
          if (cancelled || ctrl.signal.aborted) return
          setWorkspaceId(null)
          setGoals(null)
          setIsLoading(false)
          return
        }
        const workspace = await sdk.client.get<unknown>(
          `/api/workspaces/${encodeURIComponent(target)}`,
        )
        if (cancelled || ctrl.signal.aborted) return
        setWorkspaceId(target)
        setGoals(deriveGoals(workspace))
      } catch (err) {
        if (cancelled || ctrl.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled && !ctrl.signal.aborted) setIsLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [sdk.client, props.workspaceId, nonce])

  useInput((input) => {
    if (input === "r") refresh()
  })

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>
          {t("tui.goals", "Goals")}
          {workspaceId != null ? <Text dimColor> · {workspaceId}</Text> : null}
        </Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {isLoading && goals === null ? (
          <Text color="gray">
            <Spinner type="dots" /> {t("tui.goals.loading", "Loading goals…")}
          </Text>
        ) : error ? (
          <Text color="red">
            {t("tui.goals.error", { error }, `Failed to load goals: ${error}`)}
          </Text>
        ) : goals === null ? (
          <Text color="gray">
            {t("tui.goals.empty", "No workspace runs yet — send a prompt to start one.")}
          </Text>
        ) : (
          <GoalTree goals={goals} />
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{t("tui.goals.hints", "r refresh · esc close")}</Text>
      </Box>
    </Box>
  )
}

function GoalTree({ goals }: { goals: GoalsView }) {
  const themeWidth = 28
  const filled = Math.round((goals.primary.percent / 100) * themeWidth)
  const bar = "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, themeWidth - filled))
  const request = goals.request || t("tui.goals.noRequest", "(no request recorded)")
  const review = goals.milestones.find((m) => m.key === "review")
  const failures = failureSummary(goals.subGoals)
  // Error summary discloses at most 3 labels inline; the count stays honest.
  const failureLabels =
    failures != null
      ? failures.entries.slice(0, 3).join(", ") + (failures.entries.length > 3 ? ", …" : "")
      : ""
  return (
    <Box flexDirection="column">
      {/* Primary goal — the user request, colored by workspace status. */}
      <Box flexDirection="row">
        <Text
          color={
            goals.status === "failed" ? "red" : goals.status === "completed" ? "green" : "yellow"
          }
        >
          ●{" "}
        </Text>
        <Text bold>{request}</Text>
      </Box>
      <Text dimColor>
        {" "}
        status: {goals.status} ·{" "}
        {t(
          "tui.goals.progress",
          {
            percent: goals.primary.percent,
            completed: goals.primary.completed,
            total: goals.primary.total,
            failed: goals.primary.failed,
          },
          `${goals.primary.percent}% · ${goals.primary.completed}/${goals.primary.total} tasks done · ${goals.primary.failed} failed`,
        )}
      </Text>
      <Text color={goals.primary.percent >= 100 ? "green" : "cyan"}>
        {" "}
        [{bar}] {goals.primary.percent}%
      </Text>
      {/* Milestones — plan / execution / review (with the review score). */}
      <Box marginTop={1} flexDirection="row">
        <Text> </Text>
        {goals.milestones.map((m) => (
          <Text key={m.key} color={m.done ? "green" : "gray"}>
            [{m.done ? "x" : " "}] {t(`tui.goals.milestone.${m.key}`, m.key)}
            {m.key === "plan" && m.taskCount != null ? ` (${m.taskCount})` : ""}
            {"  "}
          </Text>
        ))}
      </Box>
      {review != null && review.score != null && (
        <Text color="green">
          {" "}
          ★ {t("tui.goals.reviewScore", { score: review.score }, `review score ${review.score}`)}
        </Text>
      )}
      {/* Sub-goal tree — plan.tasks with dependsOn indent depth. */}
      {goals.subGoals.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          {goals.subGoals.map((task) => {
            const deps = dependsOnSummary(task)
            const failed = task.state === "failed"
            return (
              <Box key={task.id} flexDirection="column">
                <Box flexDirection="row">
                  <Text>{"  ".repeat(task.depth)} </Text>
                  <Text color={taskStateColor(task.state)}>
                    {task.state === "running" ? "◐" : "●"}{" "}
                  </Text>
                  <Text color={failed ? "red" : undefined} bold={failed}>
                    {task.label || task.id}
                  </Text>
                  {task.role !== "unknown" ? <Text dimColor> · {task.role}</Text> : null}
                </Box>
                {/* Dependency chain, indented one level past the task. */}
                {deps != null ? (
                  <Text dimColor>
                    {"  "}
                    {"  ".repeat(task.depth)}↳{" "}
                    {t("tui.goals.dependsOn", { deps }, `depends: {deps}`)}
                  </Text>
                ) : null}
              </Box>
            )
          })}
        </Box>
      ) : null}
      {/* Error summary — only when something actually failed. */}
      {failures != null ? (
        <Text color="red">
          {" "}
          ✗{" "}
          {t(
            "tui.goals.failedSummary",
            { count: failures.count, labels: failureLabels },
            `{count} failed: {labels}`,
          )}
        </Text>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>
          {t(
            "tui.goals.sources",
            { sources: goals.sources.join(", ") || "—" },
            `derived from: ${goals.sources.join(", ") || "—"}`,
          )}
        </Text>
      </Box>
    </Box>
  )
}

export default GoalsPanel
