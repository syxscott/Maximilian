// @ts-nocheck
import React, { useMemo, useState } from "react"
import { Box, Text } from "ink"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { TodoItem } from "../../components/todo-item"

const id = "internal:sidebar-todo"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = useState(true)
  const theme = props.api.theme.current
  const list = useMemo(() => props.api.state.session.todo(props.session_id), [props.session_id])
  const show = useMemo(() => list.length > 0 && list.some((item) => item.status !== "completed"), [list])

  if (!show) return null

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1} onClick={() => list.length > 2 && setOpen((x) => !x)}>
        {list.length > 2 && <Text color={theme.text}>{open ? "▼" : "▶"}</Text>}
        <Text color={theme.text} bold>
          Todo
        </Text>
      </Box>
      {(list.length <= 2 || open) &&
        list.map((item, index) => <TodoItem key={index} status={item.status} content={item.content} />)}
    </Box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 400,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
