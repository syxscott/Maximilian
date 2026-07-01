import React from "react"
import { Text } from "ink"
import { useTheme } from "../context/theme"

export type WorkspaceStatus = "connected" | "connecting" | "disconnected" | "error"

export type WorkspaceLabelProps = {
  type: string
  name: string
  status?: WorkspaceStatus
  icon?: boolean
}

export function WorkspaceLabel(props: WorkspaceLabelProps) {
  const { theme } = useTheme()

  const color =
    props.status === "connected"
      ? theme.success
      : props.status === "error"
        ? theme.error
        : theme.textMuted

  return (
    <>
      {props.icon ? <Text color={color}>● </Text> : null}
      <Text color={theme.text}>{props.name}</Text>{" "}
      <Text color={theme.textMuted}>({props.type})</Text>
    </>
  )
}
