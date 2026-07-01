import * as React from "react"
import { cn } from "../lib/utils"

export interface TextShimmerProps extends Omit<React.HTMLAttributes<HTMLElement>, "children"> {
  text: string
  className?: string
  as?: React.ElementType
  active?: boolean
  offset?: number
}

export function TextShimmer(props: TextShimmerProps) {
  const {
    text,
    className,
    as,
    active = true,
    offset = 0,
    style,
    ...rest
  } = props

  const swap = 220
  const [run, setRun] = React.useState(active)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (active) {
      setRun(true)
      return
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setRun(false)
    }, swap)
  }, [active])

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const Component = as ?? "span"

  return (
    <Component
      data-component="text-shimmer"
      data-active={active ? "true" : "false"}
      className={cn("relative inline-block", className)}
      aria-label={text}
      style={{
        ["--text-shimmer-swap" as string]: `${swap}ms`,
        ["--text-shimmer-index" as string]: `${offset}`,
        ...style,
      }}
      {...rest}
    >
      <span data-slot="text-shimmer-char" className="relative inline-block">
        <span data-slot="text-shimmer-char-base" aria-hidden="true">
          {text}
        </span>
        <span
          data-slot="text-shimmer-char-shimmer"
          data-run={run ? "true" : "false"}
          aria-hidden="true"
        >
          {text}
        </span>
      </span>
    </Component>
  )
}