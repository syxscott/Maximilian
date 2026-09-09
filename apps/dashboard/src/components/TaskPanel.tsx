import { useLocale, t } from "@max/i18n"
import { WaveIndicator, computeWaves } from "./_helpers/WaveIndicator"
import type { Workspace } from "../api"

interface Props {
  workspace: Workspace | null
}

type Phase = "plan" | "runtime" | "done"

function detectPhase(tasks: Array<{ status: string }>): Phase {
  const has = (s: string) => tasks.some((t) => t.status === s)
  if (has("running")) return "runtime"
  if (has("completed") || has("failed")) {
    return tasks.every((t) => t.status === "completed" || t.status === "failed")
      ? "done"
      : "runtime"
  }
  return "plan"
}

function topoLevel(
  taskId: string,
  byId: Map<string, { dependsOn: string[] }>,
  cache = new Map<string, number>(),
  visiting = new Set<string>(),
): number {
  if (cache.has(taskId)) return cache.get(taskId)!
  // Cycle protection: a poisoned task with a self-cycle or A→B→A would
  // otherwise recurse until the JS engine throws "Maximum call stack size
  // exceeded" and unmounts the entire workspace sidebar. Treat already-
  // visiting nodes as level 0 so the layout still renders.
  if (visiting.has(taskId)) return 0
  const t = byId.get(taskId)
  if (!t || t.dependsOn.length === 0) {
    cache.set(taskId, 0)
    return 0
  }
  visiting.add(taskId)
  const level = 1 + Math.max(...t.dependsOn.map((d) => topoLevel(d, byId, cache, visiting)))
  visiting.delete(taskId)
  cache.set(taskId, level)
  return level
}

function durationLabel(startedAt: string | undefined, completedAt: string | undefined): string {
  if (!startedAt) return ""
  const startMs = new Date(startedAt).getTime()
  if (!Number.isFinite(startMs)) return ""
  const endMs = completedAt ? new Date(completedAt).getTime() : Date.now()
  if (!Number.isFinite(endMs)) return ""
  const ms = endMs - startMs
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

const STATUS_DOT: Record<string, string> = {
  pending: "bg-muted-foreground/40",
  running: "bg-[color:var(--mx-status-running)]",
  completed: "bg-[color:var(--mx-status-done)]",
  failed: "bg-[color:var(--mx-status-error)]",
  // Will never run — hollow grey, visually distinct from "pending".
  skipped: "border border-[color:var(--mx-status-skipped)] bg-transparent",
}

export function TaskPanel({ workspace }: Props) {
  useLocale()
  const tasks = workspace?.plan?.tasks ?? []
  if (tasks.length === 0) {
    return (
      <div className="task-panel px-3 py-6 text-xs text-muted-foreground font-mono">
        {t("task.empty")}
      </div>
    )
  }

  const phase = detectPhase(tasks)
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const waves = phase === "runtime" ? computeWaves(tasks) : []

  return (
    <div className="task-panel divide-y divide-border">
      {workspace?.plan?.rationale && (
        <p className="px-3 py-2 text-[11px] text-muted-foreground font-mono leading-relaxed border-b border-border">
          {workspace.plan.rationale}
        </p>
      )}
      {phase === "runtime" && waves.length > 0 && (
        <div className="px-3 py-2 border-b border-border">
          <WaveIndicator waves={waves} />
        </div>
      )}
      {phase === "runtime" && (
        <ul className="divide-y divide-border">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="task-row flex items-center gap-2 px-3 py-1.5 text-xs font-mono"
            >
              <span
                className={`task-row__status task-row__status--${task.status} inline-block w-1.5 h-1.5 rounded-full ${STATUS_DOT[task.status] ?? STATUS_DOT.pending}`}
              />
              <span className="flex-1 truncate" title={task.description}>
                {task.description}
              </span>
              {task.dependsOn.length > 0 && (
                <span className="text-[10px] text-muted-foreground font-mono">
                  ← {task.dependsOn.join(", ")}
                </span>
              )}
              <span className="text-muted-foreground tabular-nums w-14 text-right">
                {durationLabel(task.startedAt, task.completedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {phase === "done" && (
        <ol className="px-3 py-2 space-y-1 text-xs font-mono">
          {[...tasks]
            .sort(
              (a, b) =>
                new Date(a.completedAt ?? 0).getTime() - new Date(b.completedAt ?? 0).getTime(),
            )
            .map((task) => {
              const depth = topoLevel(task.id, byId)
              const dur = durationLabel(task.startedAt, task.completedAt)
              return (
                <li
                  key={task.id}
                  className="task-row flex items-center gap-2"
                  style={{ paddingLeft: depth * 16 }}
                >
                  <span
                    className={
                      task.status === "failed"
                        ? "text-[color:var(--mx-red-600)]"
                        : task.status === "skipped"
                          ? "text-[color:var(--mx-status-skipped)]"
                          : "text-[color:var(--mx-green-600)]"
                    }
                  >
                    {task.status === "failed" ? "✕" : task.status === "skipped" ? "–" : "✓"}
                  </span>
                  <span className="truncate flex-1">{task.description}</span>
                  {task.error && (
                    <span className="text-[10px] text-[color:var(--mx-red-600)] font-mono">
                      {t("task.error")}: {task.error}
                    </span>
                  )}
                  <span className="text-muted-foreground tabular-nums w-14 text-right">{dur}</span>
                </li>
              )
            })}
        </ol>
      )}
      {phase === "plan" && (
        <ul className="px-3 py-2 space-y-1 text-xs font-mono">
          {tasks.map((task) => {
            const depth = topoLevel(task.id, byId)
            return (
              <li
                key={task.id}
                className="task-row flex items-center gap-2 opacity-80 hover:opacity-100"
                style={{ paddingLeft: depth * 16 }}
                title={task.description}
              >
                <span className="text-muted-foreground">▸</span>
                <span className="truncate flex-1">{task.description}</span>
                {task.dependsOn.length > 0 && (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    ← {task.dependsOn.join(", ")}
                  </span>
                )}
                <span className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  {task.agentRole}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
