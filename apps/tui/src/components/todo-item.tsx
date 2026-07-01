import React from "react"
import { Box, Text } from "ink"

export type TodoStatus = "pending" | "in_progress" | "completed"

export interface TodoItemProps {
  status: TodoStatus | string
  content: string
}

// Default theme tokens; consumers can wrap with a ThemeProvider for overrides.
const DEFAULT_COLORS = {
  textMuted: "gray",
  warning: "yellow",
  success: "green",
}

export function TodoItem({ status, content }: TodoItemProps) {
  const color =
    status === "in_progress"
      ? DEFAULT_COLORS.warning
      : status === "completed"
        ? DEFAULT_COLORS.success
        : DEFAULT_COLORS.textMuted

  const marker = status === "completed" ? "✓" : status === "in_progress" ? "•" : " "

  return (
    <Box flexDirection="row">
      <Text color={color}>[{marker}] </Text>
      <Box flexGrow={1}>
        <Text color={color} wrap="wrap">
          {content}
        </Text>
      </Box>
    </Box>
  )
}

export default TodoItem