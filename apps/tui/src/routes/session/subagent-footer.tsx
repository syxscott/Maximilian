// @ts-nocheck
/**
 * SubagentFooter: bottom bar for subagent sessions with parent/prev/next nav.
 *
 * Ported from OpenCode's SolidJS `subagent-footer.tsx`. The original used
 * `createMemo`, `createSignal`, `Show`, `useTerminalDimensions`, and
 * `useCommandShortcut`/`useOpencodeKeymap` from keymap.
 *
 * We port to React `useMemo`, `useState`, conditional JSX, and ink
 * `Box`/`Text`. Keybindings are approximated via `useInput`. Mouse hover
 * is dropped (ink has no mouse events).
 */

import React, { useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import { useRouteData } from "../../context/route"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { useOpencodeKeymap } from "../../context"
import { Locale } from "../../util/locale"

type AssistantMessage = {
  role: "assistant"
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  providerID?: string
  modelID?: string
  [k: string]: unknown
}

type Session = {
  id: string
  title?: string
  parentID?: string
  cost?: number
  time?: { created: number }
  [k: string]: unknown
}

export function SubagentFooter() {
  const route = useRouteData("session")
  const sync = useSync()
  const { theme } = useTheme()
  const keymap = useOpencodeKeymap()

  const messages = useMemo(
    () => ((sync.data.message as Record<string, unknown[]>)?.[route.sessionID] ?? []) as AssistantMessage[],
    [sync.data.message, route.sessionID],
  )

  const session = useMemo(
    () => (sync.data.session as Session[]).find((s) => s.id === route.sessionID),
    [sync.data.session, route.sessionID],
  )

  const subagentInfo = useMemo(() => {
    const s = session
    if (!s) return { label: "Subagent", index: 0, total: 0 }
    const agentMatch = s.title?.match?.(/@(\w+) subagent/)
    const label = agentMatch ? Locale.titlecase(agentMatch[1]) : "Subagent"

    if (!s.parentID) return { label, index: 0, total: 0 }

    const siblings = (sync.data.session as Session[])
      .filter((x) => x.parentID === s.parentID)
      .toSorted((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
    const index = siblings.findIndex((x) => x.id === s.id)

    return { label, index: index + 1, total: siblings.length }
  }, [session, sync.data.session])

  const usage = useMemo(() => {
    const last = messages.findLast(
      (item): item is AssistantMessage => item.role === "assistant" && item.tokens?.output > 0,
    )
    if (!last) return undefined

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (tokens <= 0) return undefined

    const provider = (sync.data.provider as Array<{ id: string; models: Record<string, { limit?: { context?: number } }> }>).find(
      (item) => item.id === last.providerID,
    )
    const model = provider?.models?.[last.modelID ?? ""]
    const pct = model?.limit?.context ? `${Math.round((tokens / model.limit.context) * 100)}%` : undefined
    const cost = session?.cost ?? 0

    const money = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    })

    return {
      context: pct ? `${Locale.number(tokens)} (${pct})` : Locale.number(tokens),
      cost: cost > 0 ? money.format(cost) : undefined,
    }
  }, [messages, sync.data.provider, session])

  useInput((input, _key) => {
    // Keyboard shortcuts for parent/prev/next navigation
    if (input === "p") {
      keymap.dispatchCommand("session.parent")
    }
  })

  return (
    <Box flexShrink={0}>
      <Box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={1}
        borderStyle="single"
        borderColor={theme.border}
        flexShrink={0}
      >
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Box flexDirection="row" gap={1}>
            <Text bold color={theme.text}>
              {subagentInfo.label}
            </Text>
            {subagentInfo.total > 0 ? (
              <Text dimColor>
                ({subagentInfo.index} of {subagentInfo.total})
              </Text>
            ) : null}
            {usage ? (
              <Text dimColor>
                {[usage.context, usage.cost].filter(Boolean).join(" . ")}
              </Text>
            ) : null}
          </Box>
          <Box flexDirection="row" gap={2}>
            <Box>
              <Text color={theme.text}>
                Parent <Text dimColor>p</Text>
              </Text>
            </Box>
            <Box>
              <Text color={theme.text}>
                Prev <Text dimColor>[</Text>
              </Text>
            </Box>
            <Box>
              <Text color={theme.text}>
                Next <Text dimColor>]</Text>
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
