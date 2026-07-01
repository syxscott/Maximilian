import React from "react"
import { Box, Text } from "ink"

export interface LogoProps {
  width?: number
  color?: string
  animated?: boolean
}

// Maximilian ASCII logo art (two-column layout that mirrors the visual style
// of OpenCode's wordmark without copying the exact glyphs).
const LOGO_LEFT: string[] = [
  " ███╗   ███╗",
  " ████╗ ████║",
  " ██╔████╔██║",
  " ██║╚██╔╝██║",
  " ██║ ╚═╝ ██║",
  " ╚═╝     ╚═╝",
]

const LOGO_RIGHT: string[] = [
  "  █████╗  ",
  " ██╔══██╗ ",
  " ███████║ ",
  " ██╔══██║ ",
  " ██║  ██║ ",
  " ╚═╝  ╚═╝ ",
]

export function Logo({ width = 14, color = "cyan", animated = false }: LogoProps) {
  // `animated` is reserved for future sub-pixel shimmer. In this port we
  // render statically; the flag is accepted to keep API parity with OpenCode.
  void animated

  const lines = React.useMemo(() => {
    const out: string[] = []
    const max = Math.max(LOGO_LEFT.length, LOGO_RIGHT.length)
    for (let i = 0; i < max; i++) {
      const left = LOGO_LEFT[i] ?? ""
      const right = LOGO_RIGHT[i] ?? ""
      out.push((left + right).padEnd(width, " "))
    }
    return out
  }, [width])

  return (
    <Box flexDirection="column" alignItems="center">
      {lines.map((line, i) => (
        <Text key={i} color={color} bold={i === 0}>
          {line}
        </Text>
      ))}
    </Box>
  )
}

export default Logo