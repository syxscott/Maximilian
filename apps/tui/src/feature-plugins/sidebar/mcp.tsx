// @ts-nocheck
import React, { useMemo, useState } from "react"
import { Box, Text } from "ink"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"

const id = "internal:sidebar-mcp"

function View(props: { api: TuiPluginApi }) {
  const [open, setOpen] = useState(true)
  const theme = props.api.theme.current
  const list = useMemo(() => props.api.state.mcp(), [])
  const on = useMemo(() => list.filter((item) => item.status === "connected").length, [list])
  const bad = useMemo(
    () =>
      list.filter(
        (item) =>
          item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration",
      ).length,
    [list],
  )

  const dot = (status: string) => {
    if (status === "connected") return theme.success
    if (status === "failed") return theme.error
    if (status === "disabled") return theme.textMuted
    if (status === "needs_auth") return theme.warning
    if (status === "needs_client_registration") return theme.error
    return theme.textMuted
  }

  const statusLabel = (status: string, error?: string) => {
    if (status === "connected") return "Connected"
    if (status === "failed") return error ?? "Failed"
    if (status === "disabled") return "Disabled"
    if (status === "needs_auth") return "Needs auth"
    if (status === "needs_client_registration") return "Needs client ID"
    return status
  }

  if (list.length === 0) return null

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1} onClick={() => list.length > 2 && setOpen((x) => !x)}>
        {list.length > 2 && <Text color={theme.text}>{open ? "▼" : "▶"}</Text>}
        <Text color={theme.text} bold>
          MCP
          {!open && (
            <Text color={theme.textMuted}>
              {" "}
              ({on} active{bad > 0 ? `, ${bad} error${bad > 1 ? "s" : ""}` : ""})
            </Text>
          )}
        </Text>
      </Box>
      {(list.length <= 2 || open) &&
        list.map((item) => (
          <Box key={item.name} flexDirection="row" gap={1}>
            <Text color={dot(item.status)}>{'•'}</Text>
            <Text color={theme.text} wrap="word">
              {item.name}{" "}
              <Text color={theme.textMuted} italic={item.status === "failed"}>
                {statusLabel(item.status, item.error)}
              </Text>
            </Text>
          </Box>
        ))}
    </Box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 200,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
