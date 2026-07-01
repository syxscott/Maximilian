// @ts-nocheck
import React, { useMemo, useState } from "react"
import { Box, Text } from "ink"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { Locale } from "../../util/locale"

const id = "internal:sidebar-files"

function changeCountWidth(item: { additions: number; deletions: number }) {
  return [item.additions ? `+${item.additions}` : "", item.deletions ? `-${item.deletions}` : ""]
    .filter(Boolean)
    .join(" ").length
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = useState(true)
  const theme = props.api.theme.current
  const list = useMemo(() => props.api.state.session.diff(props.session_id), [props.session_id])

  if (list.length === 0) return null

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1} onClick={() => list.length > 2 && setOpen((x) => !x)}>
        {list.length > 2 && <Text color={theme.text}>{open ? "▼" : "▶"}</Text>}
        <Text color={theme.text} bold>
          Modified Files
        </Text>
      </Box>
      {(list.length <= 2 || open) &&
        list.map((item, index) => (
          <Box key={index} flexDirection="row" gap={1} justifyContent="space-between">
            <Text color={theme.textMuted} wrap="truncate">
              {Locale.truncateLeft(item.file, Math.max(2, 36 - changeCountWidth(item)))}
            </Text>
            <Box flexDirection="row" gap={1} flexShrink={0}>
              {item.additions > 0 && <Text color={theme.diffAdded}>+{item.additions}</Text>}
              {item.deletions > 0 && <Text color={theme.diffRemoved}>-{item.deletions}</Text>}
            </Box>
          </Box>
        ))}
    </Box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 500,
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
