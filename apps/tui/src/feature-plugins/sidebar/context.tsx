// @ts-nocheck
import React, { useMemo } from "react"
import { Box, Text } from "ink"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = props.api.theme.current
  const msg = useMemo(() => props.api.state.session.messages(props.session_id), [props.session_id])
  const session = useMemo(() => props.api.state.session.get(props.session_id), [props.session_id])
  const cost = useMemo(() => session?.cost ?? 0, [session])

  const state = useMemo(() => {
    const last = msg.findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) {
      return {
        tokens: 0,
        percent: null,
      }
    }

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  }, [msg])

  return (
    <Box flexDirection="column">
      <Text color={theme.text} bold>
        Context
      </Text>
      <Text color={theme.textMuted}>{state.tokens.toLocaleString()} tokens</Text>
      <Text color={theme.textMuted}>{state.percent ?? 0}% used</Text>
      <Text color={theme.textMuted}>{money.format(cost)} spent</Text>
    </Box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
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
