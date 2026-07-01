// @ts-nocheck
import React, { useMemo } from "react"
import { Box, Text } from "ink"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { abbreviateHome } from "../../runtime"
import { useTuiPaths } from "../../context/runtime"

const id = "internal:sidebar-footer"

function View(props: { api: TuiPluginApi; sessionID: string }) {
  const paths = useTuiPaths()
  const theme = props.api.theme.current
  const has = useMemo(
    () =>
      props.api.state.provider.some(
        (item) => item.id !== "opencode" || Object.values(item.models).some((model) => model.cost?.input !== 0),
      ),
    [],
  )
  const done = useMemo(() => props.api.kv.get("dismissed_getting_started", false), [])
  const show = useMemo(() => !has && !done, [has, done])
  const path = useMemo(() => {
    const session = props.api.state.session.get(props.sessionID)
    const dir = session?.directory || props.api.state.path.directory || paths.cwd
    const out = abbreviateHome(dir, paths.home)
    const branch = session?.directory === props.api.state.path.directory ? props.api.state.vcs?.branch : undefined
    const text = branch ? out + ":" + branch : out
    const list = text.split("/")
    return {
      parent: list.slice(0, -1).join("/"),
      name: list.at(-1) ?? "",
    }
  }, [props.sessionID])

  return (
    <Box flexDirection="column" gap={1}>
      {show && (
        <Box
          backgroundColor={theme.backgroundElement}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="row"
          gap={1}
        >
          <Text color={theme.text}>{'⬖'}</Text>
          <Box flexGrow={1} flexDirection="column" gap={1}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text color={theme.text} bold>
                Getting started
              </Text>
              <Text color={theme.textMuted} onClick={() => props.api.kv.set("dismissed_getting_started", true)}>
                ✕
              </Text>
            </Box>
            <Text color={theme.textMuted}>OpenCode includes free models so you can start immediately.</Text>
            <Text color={theme.textMuted}>
              Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
            </Text>
            <Box flexDirection="row" gap={1} justifyContent="space-between">
              <Text color={theme.text}>Connect provider</Text>
              <Text color={theme.textMuted}>/connect</Text>
            </Box>
          </Box>
        </Box>
      )}
      <Text>
        <Text color={theme.textMuted}>{path.parent}/</Text>
        <Text color={theme.text}>{path.name}</Text>
      </Text>
      <Text color={theme.textMuted}>
        <Text color={theme.success}>{'•'}</Text> <Text bold>Open</Text>
        <Text color={theme.text} bold>
          Code
        </Text>{" "}
        <Text>{props.api.app.version}</Text>
      </Text>
    </Box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_footer(_ctx, props) {
        return <View api={api} sessionID={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
