import React from "react"
import { Box, Text } from "ink"
import InkSpinner from "ink-spinner"

// OpenCode uses Braille spinners: ⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏
// ink-spinner defaults to dots; expose a custom frame list.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export interface SpinnerProps {
  children?: React.ReactNode
  color?: string
  interval?: number
  fallback?: React.ReactNode
}

// Simple in-house frame spinner driven by an interval, so we don't depend on
// ink-spinner's frame list and can preserve OpenCode's exact glyph sequence.
function useSpinnerFrame(interval: number) {
  const [frame, setFrame] = React.useState(0)
  React.useEffect(() => {
    const id = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length)
    }, interval)
    return () => clearInterval(id)
  }, [interval])
  return SPINNER_FRAMES[frame]
}

export function Spinner({ children, color = "gray", interval = 80, fallback }: SpinnerProps) {
  // animations are always enabled in this port; callers can pass `fallback` to
  // opt into a static indicator instead.
  if (fallback !== undefined) {
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={color}>⋯ </Text>
        {fallback}
      </Box>
    )
  }

  const glyph = useSpinnerFrame(interval)
  return (
    <Box flexDirection="row" gap={1}>
      <Text color={color}>{glyph}</Text>
      {children ? <Text color={color}>{children}</Text> : null}
    </Box>
  )
}

export default Spinner