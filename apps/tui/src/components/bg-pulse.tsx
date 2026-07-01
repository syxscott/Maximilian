import React from "react"
import { Box, Text } from "ink"

// OpenCode's BgPulse paints an animated upsell framebuffer renderable with
// subpixel Gaussian shimmer. ink has no equivalent framebuffer renderable, so
// this port renders a calm, low-cost background panel that mimics the visual
// intent: a slow pulse of background art behind the rest of the UI.

export interface BgPulseProps {
  width?: number | string
  height?: number | string
  backgroundPanel?: string
  primary?: string
  logoBase?: string
}

function usePulse(periodMs = 1600) {
  const [phase, setPhase] = React.useState(0)
  React.useEffect(() => {
    const start = Date.now()
    const id = setInterval(() => {
      setPhase(((Date.now() - start) % periodMs) / periodMs)
    }, 80)
    return () => clearInterval(id)
  }, [periodMs])
  return phase
}

export function BgPulse({
  width = "100%",
  height = "100%",
  primary = "yellow",
  logoBase = "gray",
}: BgPulseProps) {
  const phase = usePulse()

  const rows = 8
  const cols = 24

  return (
    <Box flexDirection="column" width={width} height={height} alignItems="center" justifyContent="center">
      {Array.from({ length: rows }).map((_, r) => (
        <Box key={r} flexDirection="row">
          {Array.from({ length: cols }).map((__, c) => {
            // Diagonal wave: cells closer to the origin get brighter.
            const dx = c + 0.5 - 4.5
            const dy = (r + 0.5) * 2 - 13.5
            const dist = Math.hypot(dx, dy)
            const _falloff = Math.exp(-(dist * dist) / 24)
            void _falloff
            const lit = (r + c + Math.floor(phase * 6)) % 5 === 0
            const color = lit ? primary : logoBase
            const char = lit ? "▓" : " "
            return (
              <Text key={c} color={color}>
                {char}
              </Text>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}

export default BgPulse