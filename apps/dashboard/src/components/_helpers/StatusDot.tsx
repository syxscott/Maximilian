import { useReducedMotion } from "framer-motion"
import { useLocale, t } from "@max/i18n"

const STATUS_KEYS: Record<StatusDotProps["status"], string> = {
  idle: "statusDot.idle",
  running: "statusDot.running",
  done: "statusDot.done",
  error: "statusDot.error",
}

export interface StatusDotProps {
  status: "idle" | "running" | "done" | "error"
  /** Override the default 8px size for compact contexts. */
  size?: number
  className?: string
}

export function StatusDot({ status, size = 8, className }: StatusDotProps) {
  useLocale()
  const reduced = useReducedMotion()
  const allowPulse = status === "running" && !reduced
  const baseClass = `status-dot status-dot--${status}${allowPulse ? " status-dot--pulse" : ""}`
  const label = t(STATUS_KEYS[status])
  return (
    <span
      role="status"
      aria-label={label}
      className={[baseClass, className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
    >
      <span className="sr-only">{label}</span>
    </span>
  )
}
