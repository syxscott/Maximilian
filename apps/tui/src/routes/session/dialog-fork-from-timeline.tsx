// @ts-nocheck
/**
 * DialogForkFromTimeline: pick a message to fork a session from.
 *
 * Ported from OpenCode's SolidJS `dialog-fork-from-timeline.tsx`. The original
 * used `<DialogSelect>` and `createMemo` for lazy option computation; we
 * rebuild the list UI with ink primitives and `useMemo`.
 */

import React, { useEffect, useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import { useSync } from "../../context/sync"
import { useSDK } from "../../context/sdk"
import { useRoute } from "../../context/route"
import { useDialog } from "../../components/dialog"
import { Locale } from "../../util/locale"
import type { PromptPart } from "../../prompt"

type TextPart = { type: "text"; text: string; synthetic?: boolean; ignored?: boolean }

export type PromptInfo = {
  input: string
  parts: Array<{ type: string; [k: string]: unknown }>
}

function stripPromptPartIDs<T extends { id?: unknown; messageID?: unknown; sessionID?: unknown }>(part: T): Omit<T, "id" | "messageID" | "sessionID"> {
  const { id: _id, messageID: _mid, sessionID: _sid, ...rest } = part as Record<string, unknown>
  return rest as Omit<T, "id" | "messageID" | "sessionID">
}

type Option = {
  title: string
  value: string | undefined
  footer?: string
  onSelect: () => Promise<void>
}

export function DialogForkFromTimeline(props: {
  sessionID: string
  onMove: (messageID?: string) => void
}) {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const route = useRoute()
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    dialog.setSize("large")
  }, [dialog])

  const options = useMemo((): Option[] => {
    const messages = (sync.data.message as Record<string, Array<{ id: string; role: string; time: { created: number }; [k: string]: unknown }>>)?.[props.sessionID] ?? []

    const fullSession: Option = {
      title: "Full session",
      value: undefined,
      onSelect: async () => {
        const forked = await sdk.client.session?.fork?.({ sessionID: props.sessionID })
        route.navigate({
          sessionID: forked?.data?.id ?? "",
          type: "session",
        })
      },
    }

    const result: Option[] = []
    for (const message of messages) {
      if (message.role !== "user") continue
      const parts = ((sync.data.part as Record<string, TextPart[]>)?.[message.id] ?? []) as TextPart[]
      const part = parts.find((x) => x.type === "text" && !x.synthetic && !x.ignored)
      if (!part) continue
      result.push({
        title: part.text.replace(/\n/g, " "),
        value: message.id,
        footer: Locale.time(message.time.created),
        onSelect: async () => {
          const forked = await sdk.client.session?.fork?.({
            sessionID: props.sessionID,
            messageID: message.id,
          })
          const msgParts = ((sync.data.part as Record<string, unknown[]>)?.[message.id] ?? []) as Array<Record<string, unknown>>
          const prompt = msgParts.reduce(
            (agg: PromptInfo, part: Record<string, unknown>) => {
              if (part.type === "text") {
                if (!part.synthetic) agg.input += (part.text as string) ?? ""
              }
              if (part.type === "file") agg.parts.push(stripPromptPartIDs(part as PromptPart))
              return agg
            },
            { input: "", parts: [] as PromptInfo["parts"] },
          )
          route.navigate({
            sessionID: forked?.data?.id ?? "",
            type: "session",
            prompt,
          })
        },
      })
    }
    return [fullSession, ...result.reverse()]
  }, [sync.data.message, sync.data.part, props.sessionID, sdk, route])

  useInput((_input, key) => {
    if (key.up) {
      setSelected((prev) => (prev - 1 + options.length) % options.length)
    } else if (key.down) {
      setSelected((prev) => (prev + 1) % options.length)
    } else if (key.return) {
      const opt = options[selected]
      if (opt) {
        props.onMove(opt.value)
        void opt.onSelect()
      }
    }
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Fork session</Text>
      </Box>
      {options.length === 0 ? (
        <Text dimColor>No messages found.</Text>
      ) : (
        options.map((opt, i) => (
          <Box key={opt.value ?? "__full__"} flexDirection="row" justifyContent="space-between">
            <Text color={i === selected ? "green" : undefined} wrap="truncate">
              {i === selected ? "> " : "  "}
              {opt.title.length > 60 ? opt.title.slice(0, 59) + "…" : opt.title}
            </Text>
            {opt.footer ? <Text dimColor> {opt.footer}</Text> : null}
          </Box>
        ))
      )}
    </Box>
  )
}
