import { useMemo } from "react"
import { useLocale, t } from "@max/i18n"

export interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  stroke?: string
  fill?: string
  className?: string
  ariaLabel?: string
}

export function Sparkline({
  values,
  width = 240,
  height = 56,
  stroke = "var(--mx-blue-600)",
  fill = "transparent",
  className,
  ariaLabel,
}: SparklineProps) {
  useLocale()
  const points = useMemo(() => buildPoints(values, width, height), [values, width, height])
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={ariaLabel ?? t("sparkline.label")}
    >
      {points.length === 0 ? null : points.length === 1 ? (
        <circle cx={width / 2} cy={height / 2} r={2} fill={stroke} />
      ) : (
        <polyline
          fill={fill}
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")}
        />
      )}
    </svg>
  )
}

function buildPoints(values: number[], w: number, h: number) {
  if (values.length === 0) return []
  // Linear scan for min/max instead of `Math.min(...values)` —
  // spreading a 10k+ entry array blows the JS engine's argument stack
  // with "Maximum call stack size exceeded". The single-pass loop is
  // also faster on modern V8.
  let min = values[0] ?? 0
  let max = values[0] ?? 0
  for (let i = 1; i < values.length; i++) {
    const v = values[i] ?? 0
    if (v < min) min = v
    if (v > max) max = v
  }
  const span = max - min || 1
  const stepX = values.length === 1 ? w : w / (values.length - 1)
  const padY = 4
  const usable = h - padY * 2
  return values.map((v, i) => ({
    x: i * stepX,
    y: padY + (1 - (v - min) / span) * usable,
  }))
}
