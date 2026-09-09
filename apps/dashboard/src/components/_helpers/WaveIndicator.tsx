import { Fragment } from "react"
import { useLocale, t } from "@max/i18n"

export type WaveStatus = "queued" | "active" | "done"

export interface WaveDescriptor {
  status: WaveStatus
  tickCount: number
  activeCount?: number
}

export interface WaveIndicatorProps {
  waves: WaveDescriptor[]
  className?: string
}

export function WaveIndicator({ waves, className }: WaveIndicatorProps) {
  useLocale()
  if (waves.length === 0) return null

  const currentIdx = waves.findIndex((w) => w.status === "active")
  const current = currentIdx >= 0 ? currentIdx : waves.length - 1
  const currentActive = waves[current]?.activeCount ?? 0

  return (
    <div
      className={["wave-indicator", className].filter(Boolean).join(" ")}
      aria-label={t("task.waves.aria", { total: waves.length, active: currentActive })}
    >
      <div role="list" className="flex items-center gap-0.5">
        {waves.flatMap((wave, i) => (
          <Fragment key={i}>
            {Array.from({ length: wave.tickCount }).map((_, j) => (
              <span
                key={`${i}-${j}`}
                data-testid="wave-tick"
                role="listitem"
                className={`wave-indicator__tick wave-indicator__tick--${wave.status}${wave.status === "active" ? " wave-indicator__tick--active" : ""}`}
              />
            ))}
            {i < waves.length - 1 && <span aria-hidden className="wave-indicator__divider" />}
          </Fragment>
        ))}
      </div>
      <div className="wave-indicator__legend font-mono tabular-nums">
        <span>
          {t("task.wave.label", { current: current + 1, total: waves.length })}
        </span>
        {currentActive > 0 && (
          <>
            <span aria-hidden>·</span>
            <span>{t("task.wave.parallel", { n: currentActive })}</span>
          </>
        )}
      </div>
    </div>
  )
}

export function computeWaves(
  tasks: Array<{ status: string; completedAt?: string; startedAt?: string }>,
): WaveDescriptor[] {
  const done = tasks
    .filter((t) => t.status === "completed" && t.completedAt)
    .map((t) => new Date(t.completedAt!).getTime())
  const running = tasks.filter((t) => t.status === "running").length
  const queued = tasks.filter((t) => t.status === "pending").length

  if (done.length === 0 && running === 0 && queued === 0) return []

  const groups: number[][] = []
  const sortedDone = [...done].sort((a, b) => a - b)
  for (const ts of sortedDone) {
    const last = groups[groups.length - 1]
    if (!last || ts - last[last.length - 1] > 250) {
      groups.push([ts])
    } else {
      last.push(ts)
    }
  }

  const waves: WaveDescriptor[] = groups.map((g) => ({
    status: "done" as const,
    tickCount: g.length,
  }))
  if (running > 0) {
    waves.push({ status: "active", tickCount: Math.max(running, 1), activeCount: running })
  }
  if (queued > 0) {
    waves.push({ status: "queued", tickCount: queued })
  }
  return waves
}
