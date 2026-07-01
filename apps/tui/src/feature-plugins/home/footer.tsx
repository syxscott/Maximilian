// @ts-nocheck
import React, { useMemo } from "react"
import { Box, Text } from "ink"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { abbreviateHome } from "../../runtime"
import { useTuiPaths } from "../../context/runtime"
import { useHomeSessionDestination } from "../../routes/home/session-destination"

const id = "internal:home-footer"

function Directory(props: { api: TuiPluginApi }) {
  const theme = props.api.theme.current
  const destination = useHomeSessionDestination()
  const paths = useTuiPaths()
  const dir = useMemo(() => {
    const selected = destination?.destination()
    if (!selected || selected.type === "new") return undefined
    const out = abbreviateHome(selected.directory, paths.home)
    const branch =
      selected.directory === (props.api.state.path.directory || paths.cwd) ? props.api.state.vcs?.branch : undefined
    if (branch) return out + ":" + branch
    return out
  }, [destination])

  if (!dir) return null
  return <Text color={theme.textMuted}>{dir}</Text>
}

function Mcp(props: { api: TuiPluginApi }) {
  const theme = props.api.theme.current
  const list = useMemo(() => props.api.state.mcp(), [])
  const has = useMemo(() => list.length > 0, [list])
  const err = useMemo(() => list.some((item) => item.status === "failed"), [list])
  const count = useMemo(() => list.filter((item) => item.status === "connected").length, [list])

  if (!has) return null

  return (
    <Box gap={1} flexDirection="row" flexShrink={0}>
      <Text color={theme.text}>
        <Text color={err ? theme.error : count > 0 ? theme.success : theme.textMuted}>{'⊙ '}</Text>
        {count} MCP
      </Text>
      <Text color={theme.textMuted}>/status</Text>
    </Box>
  )
}

function Version(props: { api: TuiPluginApi }) {
  const theme = props.api.theme.current

  return (
    <Box flexShrink={0}>
      <Text color={theme.textMuted}>{props.api.app.version}</Text>
    </Box>
  )
}

function View(props: { api: TuiPluginApi }) {
  return (
    <Box
      width="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="row"
      flexShrink={0}
      gap={2}
    >
      <Directory api={props.api} />
      <Mcp api={props.api} />
      <Box flexGrow={1} />
      <Version api={props.api} />
    </Box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      home_footer() {
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
