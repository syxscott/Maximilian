import { useReducedMotion } from "framer-motion"

const STATUS_LABEL: Record<StatusDotProps["status"], string> = {
  idle: "Agent idle",
  running: "Agent running",
  done: "Agent done",
  error: "Agent error",
}

export interface StatusDotProps {
  status: "idle" | "running" | "done" | "error"
  /** Override the default 8px size for compact contexts. */
  size?: number
  className?: string
}

export function StatusDot({ status, size = 8, className }: StatusDotProps) {
  const reduced = useReducedMotion()
  const allowPulse = status === "running" && !reduced
  const baseClass = `status-dot status-dot--${status}${allowPulse ? " status-dot--pulse" : ""}`
  return (
    <span
      role="status"
      aria-label={STATUS_LABEL[status]}
      className={[baseClass, className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
    >
      <span className="sr-only">{STATUS_LABEL[status]}</span>
    </span>
  )
}
