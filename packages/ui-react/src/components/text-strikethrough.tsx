"use client"

import * as React from "react"
import { cn } from "../lib/utils"

export interface TextStrikethroughProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Whether the strikethrough is active (line drawn across). */
  active: boolean
  /** The text to display. Rendered twice internally (base + decoration overlay). */
  text: string
  /** Spring visual duration in seconds. Default 0.35. */
  visualDuration?: number
}

const useSpring = (
  target: () => number,
  options?: { visualDuration?: number; bounce?: number } | (() => { visualDuration?: number; bounce?: number }),
) => {
  const opts = typeof options === "function" ? options : () => options
  const [value, setValue] = React.useState(target())
  const sourceRef = React.useRef(target())
  const targetAnimRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const start = sourceRef.current
    const end = target()
    const duration = ((opts()?.visualDuration ?? 0.35) * 1000) || 350
    if (start === end) {
      setValue(end)
      return
    }
    const startTime = performance.now()
    const tick = (now: number) => {
      if (cancelled) return
      const t = Math.min(1, (now - startTime) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      const next = start + (end - start) * eased
      setValue(next)
      if (t < 1) {
        targetAnimRef.current = requestAnimationFrame(tick)
      } else {
        sourceRef.current = end
      }
    }
    targetAnimRef.current = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      if (targetAnimRef.current !== null) cancelAnimationFrame(targetAnimRef.current)
    }
  }, [target()])

  return value
}

export const TextStrikethrough = React.forwardRef<HTMLSpanElement, TextStrikethroughProps>(
  ({ active, text, visualDuration = 0.35, className, style, ...rest }, ref) => {
    const progress = useSpring(
      () => (active ? 1 : 0),
      () => ({ visualDuration, bounce: 0 }),
    )

    const baseRef = React.useRef<HTMLSpanElement | null>(null)
    const containerRef = React.useRef<HTMLSpanElement | null>(null)
    const [state, setState] = React.useState({ textWidth: 0, containerWidth: 0 })

    const measure = React.useCallback(() => {
      setState((s) => ({
        textWidth: baseRef.current?.scrollWidth ?? s.textWidth,
        containerWidth: containerRef.current?.offsetWidth ?? s.containerWidth,
      }))
    }, [])

    React.useEffect(() => {
      measure()
      if (typeof ResizeObserver === "undefined") return
      const el = containerRef.current
      if (!el) return
      const obs = new ResizeObserver(measure)
      obs.observe(el)
      return () => obs.disconnect()
    }, [measure])

    const revealedPx = () => {
      const tw = state.textWidth
      return tw > 0 ? progress * tw : 0
    }

    const overlayClip = () => {
      const cw = state.containerWidth
      const tw = state.textWidth
      if (cw <= 0 || tw <= 0) return `inset(0 ${(1 - progress) * 100}% 0 0)`
      const remaining = Math.max(0, cw - revealedPx())
      return `inset(0 ${remaining}px 0 0)`
    }

    const baseClip = () => {
      const px = revealedPx()
      if (px <= 0.5) return "none"
      return `inset(0 0 0 ${px}px)`
    }

    const setContainerRef = React.useCallback((el: HTMLSpanElement | null) => {
      containerRef.current = el
      if (el) measure()
    }, [measure])

    return (
      <span
        ref={(el) => {
          if (typeof ref === "function") ref(el)
          else if (ref) ref.current = el
          setContainerRef(el)
        }}
        data-component="text-strikethrough"
        className={cn(className)}
        style={{ display: "grid", ...style }}
        {...rest}
      >
        <span
          ref={baseRef}
          style={{ gridArea: "1 / 1", clipPath: baseClip() }}
        >
          {text}
        </span>
        <span
          aria-hidden="true"
          style={{
            gridArea: "1 / 1",
            textDecoration: "line-through",
            pointerEvents: "none",
            clipPath: overlayClip(),
          }}
        >
          {text}
        </span>
      </span>
    )
  },
)
TextStrikethrough.displayName = "TextStrikethrough"