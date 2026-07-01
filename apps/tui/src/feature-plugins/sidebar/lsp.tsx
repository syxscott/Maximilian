// @ts-nocheck
import React, { useMemo, useState } from "react"
import { Box, Text } from "ink"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"

const id = "internal:sidebar-lsp"

function View(props: { api: TuiPluginApi }) {
  const [open, setOpen] = useState(true)
  const theme = props.api.theme.current
  const list = useMemo(() => props.api.state.lsp(), [])
  const off = useMemo(() => !props.api.state.config.lsp, [])

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1} onClick={() => list.length > 2 && setOpen((x) => !x)}>
        {list.length > 2 && <Text color={theme.text}>{open ? "▼" : "▶"}</Text>}
        <Text color={theme.text} bold>
          LSP
        </Text>
      </Box>
      {(list.length <= 2 || open) && (
        <>
          {list.length === 0 && (
            <Text color={theme.textMuted}>{off ? "LSPs are disabled" : "LSPs will activate as files are read"}</Text>
          )}
          {list.map((item) => (
            <Box key={item.id} flexDirection="row" gap={1}>
              <Text color={item.status === "connected" ? theme.success : theme.error}>{'•'}</Text>
              <Text color={theme.textMuted}>
                {item.id} {item.root}
              </Text>
            </Box>
          ))}
        </>
      )}
    </Box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 300,
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
