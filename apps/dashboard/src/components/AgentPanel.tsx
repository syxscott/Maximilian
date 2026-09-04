import { useLocale, t } from "@max/i18n"
import { StatusDot } from "./_helpers/StatusDot"
import type { Workspace } from "../api"

const ROLE_TINT: Record<string, { token: string; muted: string; monogram: string }> = {
  frontend: {
    token: "var(--mx-role-frontend)",
    muted: "var(--mx-role-frontend-muted)",
    monogram: "F",
  },
  backend: {
    token: "var(--mx-role-backend)",
    muted: "var(--mx-role-backend-muted)",
    monogram: "B",
  },
  review: { token: "var(--mx-role-review)", muted: "var(--mx-role-review-muted)", monogram: "R" },
  general: {
    token: "var(--mx-role-general)",
    muted: "var(--mx-role-general-muted)",
    monogram: "G",
  },
}

export interface AgentPanelProps {
  workspace: Workspace | null
  /** Task ids currently parked on a permission/approval gate (rendered as
   *  the amber "waiting" status dot). */
  parkedTaskIds?: ReadonlySet<string>
}

function statusFromTask(
  s: string,
  error?: string,
  isParked = false,
): "idle" | "running" | "done" | "error" | "waiting" | "skipped" {
  if (error) return "error"
  // Parked on a permission/approval gate: nominally "running" in the
  // runtime, but the visual language must distinguish "waiting on a
  // human" (static amber) from "making progress" (pulsing blue).
  if (isParked) return "waiting"
  if (s === "running") return "running"
  if (s === "completed" || s === "done") return "done"
  // Will never run (dependency failed / terminated) — muted grey, not idle.
  if (s === "skipped") return "skipped"
  return "idle"
}

function durationSince(start: string | undefined, now: number): string {
  if (!start) return ""
  const ms = now - new Date(start).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

export function AgentPanel({ workspace, parkedTaskIds }: AgentPanelProps) {
  useLocale()
  const tasks = workspace?.plan?.tasks ?? []
  const taskErrors = new Map<string, string>(
    tasks.filter((task) => task.error).map((task) => [task.id, task.error as string]),
  )

  if (tasks.length === 0) {
    return (
      <div className="agent-panel px-3 py-6 text-xs text-muted-foreground font-mono">
        {t("agent.empty")}
      </div>
    )
  }

  const now = Date.now()

  return (
    <div className="agent-panel divide-y divide-border">
      {tasks.map((task) => {
        const role = ROLE_TINT[task.agentRole] ?? ROLE_TINT.general!
        const status = statusFromTask(
          task.status,
          taskErrors.get(task.id),
          parkedTaskIds?.has(task.id) ?? false,
        )
        const dur = durationSince(task.startedAt, now)
        return (
          <div
            key={task.id}
            className={`agent-row agent-row--${task.agentRole} flex items-center gap-3 px-3 py-2${
              status === "error"
                ? " border-l-4 border-l-[color:var(--mx-red-600)]"
                : status === "waiting"
                  ? " border-l-4 border-l-[color:var(--mx-status-waiting)]"
                  : ""
            }`}
          >
            <span
              aria-hidden
              className="flex items-center justify-center w-6 h-6 rounded text-[10px] font-mono font-bold"
              style={{ background: role.muted, color: role.token }}
            >
              {role.monogram}
            </span>
            <StatusDot status={status} />
            <span className="flex-1 text-xs font-mono truncate" title={task.description}>
              {task.description}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
              {task.agentRole}
            </span>
            <span className="text-xs text-muted-foreground font-mono tabular-nums w-14 text-right">
              {dur || "—"}
            </span>
          </div>
        )
      })}
    </div>
  )
}
