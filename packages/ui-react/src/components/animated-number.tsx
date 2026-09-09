"use client"

import * as React from "react"
import { cn } from "../lib/utils.js"

const TRACK = Array.from({ length: 30 }, (_, index) => index % 10)
const DURATION = 600

function normalize(value: number) {
  return ((value % 10) + 10) % 10
}

function spin(from: number, to: number, direction: 1 | -1) {
  if (from === to) return 0
  if (direction > 0) return (to - from + 10) % 10
  return -((from - to + 10) % 10)
}

interface DigitProps {
  value: number
  direction: 1 | -1
}

const Digit: React.FC<DigitProps> = ({ value, direction }) => {
  const [step, setStep] = React.useState(value + 10)
  const [animating, setAnimating] = React.useState(false)
  const lastRef = React.useRef(value)

  React.useEffect(() => {
    const delta = spin(lastRef.current, value, direction)
    lastRef.current = value
    if (!delta) {
      setAnimating(false)
      setStep(value + 10)
      return
    }
    setAnimating(true)
    setStep((s) => s + delta)
  }, [value])

  const handleTransitionEnd = () => {
    setAnimating(false)
    setStep((s) => normalize(s) + 10)
  }

  return (
    <span data-slot="animated-number-digit">
      <span
        data-slot="animated-number-strip"
        data-animating={animating ? "true" : "false"}
        onTransitionEnd={handleTransitionEnd}
        style={{
          ["--animated-number-offset" as string]: `${step}`,
          ["--animated-number-duration" as string]: `var(--tool-motion-odometer-ms, ${DURATION}ms)`,
        }}
      >
        {TRACK.map((v, i) => (
          <span key={i} data-slot="animated-number-cell">
            {v}
          </span>
        ))}
      </span>
    </span>
  )
}

export interface AnimatedNumberProps extends React.HTMLAttributes<HTMLSpanElement> {
  value: number
}

export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({ value, className, ...rest }) => {
  const target = React.useMemo(() => {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.round(value))
  }, [value])

  const [state, setState] = React.useState({ value: target, direction: 1 as 1 | -1 })

  React.useEffect(() => {
    const current = state.value
    if (target === current) return
    setState({ value: target, direction: target > current ? 1 : -1 })
  }, [target])

  const label = state.value.toString()
  const digits = Array.from(label, (char) => {
    const code = char.charCodeAt(0) - 48
    if (code < 0 || code > 9) return 0
    return code
  }).reverse()
  const width = `${digits.length}ch`

  return (
    <span
      data-component="animated-number"
      className={cn(className)}
      aria-label={label}
      {...rest}
    >
      <span
        data-slot="animated-number-value"
        style={{ ["--animated-number-width" as string]: width }}
      >
        {digits.map((d, i) => (
          <Digit key={i} value={d} direction={state.direction} />
        ))}
      </span>
    </span>
  )
}