import * as React from "react"
import { cn } from "../lib/utils"

const px = (value: number | string | undefined, fallback: number): string => {
  if (typeof value === "number") return `${value}px`
  if (typeof value === "string") return value
  return `${fallback}px`
}

const ms = (value: number | string | undefined, fallback: number): string => {
  if (typeof value === "number") return `${value}ms`
  if (typeof value === "string") return value
  return `${fallback}ms`
}

const pct = (value: number | undefined, fallback: number): string => {
  const v = value ?? fallback
  return `${v}%`
}

export interface TextRevealProps {
  text?: string
  className?: string
  duration?: number | string
  /** Gradient edge softness as a percentage of the mask (0 = hard wipe, 17 = soft). */
  edge?: number
  /** Optional small vertical travel for entering text (px). Default 0. */
  travel?: number | string
  spring?: string
  springSoft?: string
  growOnly?: boolean
  truncate?: boolean
}

export function TextReveal(props: TextRevealProps) {
  const {
    text,
    className,
    duration,
    edge,
    travel,
    spring = "cubic-bezier(0.34, 1.08, 0.64, 1)",
    springSoft = "cubic-bezier(0.34, 1, 0.64, 1)",
    growOnly = true,
    truncate = false,
  } = props

  const [cur, setCur] = React.useState<string | undefined>(text)
  const [old, setOld] = React.useState<string | undefined>(undefined)
  const [width, setWidth] = React.useState<string>("auto")
  const [ready, setReady] = React.useState(false)
  const [swapping, setSwapping] = React.useState(false)

  const inRef = React.useRef<HTMLSpanElement | null>(null)
  const outRef = React.useRef<HTMLSpanElement | null>(null)
  const rootRef = React.useRef<HTMLSpanElement | null>(null)
  const frameRef = React.useRef<number | undefined>(undefined)

  const win = (): number => inRef.current?.scrollWidth ?? 0
  const wout = (): number => outRef.current?.scrollWidth ?? 0

  const widen = React.useCallback(
    (next: number) => {
      if (next <= 0) return
      if (growOnly) {
        const prev = Number.parseFloat(width)
        if (Number.isFinite(prev) && next <= prev) return
      }
      setWidth(`${next}px`)
    },
    [growOnly, width],
  )

  // React to text prop changes
  React.useEffect(() => {
    let prev: string | undefined = undefined
    // Capture previous text from prev render via cur state ref
    prev = cur
    const next = text

    if (next === prev) return

    if (
      typeof next === "string" &&
      typeof prev === "string" &&
      next.startsWith(prev)
    ) {
      setCur(next)
      widen(win())
      return
    }

    setSwapping(true)
    setOld(prev)
    setCur(next)

    if (typeof requestAnimationFrame !== "function") {
      widen(Math.max(win(), wout()))
      if (rootRef.current) void rootRef.current.offsetHeight
      setSwapping(false)
      return
    }
    if (frameRef.current !== undefined && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frameRef.current)
    }
    frameRef.current = requestAnimationFrame(() => {
      widen(Math.max(win(), wout()))
      if (rootRef.current) void rootRef.current.offsetHeight
      setSwapping(false)
      frameRef.current = undefined
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  React.useEffect(() => {
    widen(win())
    const fonts = typeof document !== "undefined" ? document.fonts : undefined
    if (typeof requestAnimationFrame !== "function") {
      setReady(true)
      return
    }
    if (!fonts) {
      const id = requestAnimationFrame(() => setReady(true))
      return () => cancelAnimationFrame(id)
    }
    void fonts.ready.finally(() => {
      widen(win())
      const id = requestAnimationFrame(() => setReady(true))
      return () => cancelAnimationFrame(id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    return () => {
      if (frameRef.current === undefined || typeof cancelAnimationFrame !== "function") return
      cancelAnimationFrame(frameRef.current)
    }
  }, [])

  return (
    <span
      ref={rootRef}
      data-component="text-reveal"
      data-ready={ready ? "true" : "false"}
      data-swapping={swapping ? "true" : "false"}
      data-truncate={truncate ? "true" : "false"}
      className={cn("inline-block", className)}
      aria-label={text ?? ""}
      style={{
        // CSS variables for the text-reveal CSS module
        ["--text-reveal-duration" as string]: ms(duration, 450),
        ["--text-reveal-edge" as string]: pct(edge, 17),
        ["--text-reveal-travel" as string]: px(travel, 0),
        ["--text-reveal-spring" as string]: spring,
        ["--text-reveal-spring-soft" as string]: springSoft,
      }}
    >
      <span
        data-slot="text-reveal-track"
        style={{ width: truncate ? "100%" : width }}
        className="relative inline-flex"
      >
        <span data-slot="text-reveal-entering" ref={inRef} className="inline-block whitespace-pre">
          {cur ?? " "}
        </span>
        <span data-slot="text-reveal-leaving" ref={outRef} className="inline-block whitespace-pre">
          {old ?? " "}
        </span>
      </span>
    </span>
  )
}