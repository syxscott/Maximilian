// @ts-nocheck
/**
 * DialogMessage: action menu for a single message (revert, copy, fork).
 *
 * Ported from OpenCode's SolidJS `dialog-message.tsx`. The original used
 * `<DialogSelect>` from `@opentui/solid`; we rebuild the same pattern with
 * ink primitives and `useInput`.
 */

import React, { useMemo } from "react"
import { Box, Text, useInput } from "ink"
import { useSync } from "../../context/sync"
import { useSDK } from "../../context/sdk"
import { useRoute } from "../../context/route"
import { useClipboard } from "../../context/clipboard"
import type { PromptPart } from "../../prompt"

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
  value: string
  description: string
  onSelect: () => void
}

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const sync = useSync()
  const sdk = useSDK()
  const route = useRoute()
  const clipboard = useClipboard()
  const [selected, setSelected] = React.useState(0)

  const message = useMemo(() => {
    const messages = (sync.data.message as Record<string, Array<{ id: string; [k: string]: unknown }>>)?.[props.sessionID]
    return messages?.find((x) => x.id === props.messageID)
  }, [sync.data.message, props.sessionID, props.messageID])

  const options: Option[] = useMemo(
    () => [
      {
        title: "Revert",
        value: "session.revert",
        description: "undo messages and file changes",
        onSelect: () => {
          if (!message) return

          void sdk.client.session?.revert?.({
            sessionID: props.sessionID,
            messageID: message.id,
          })

          if (props.setPrompt) {
            const parts = ((sync.data.part as Record<string, unknown[]>)?.[message.id as string] ?? []) as Array<Record<string, unknown>>
            const promptInfo = parts.reduce(
              (agg: PromptInfo, part: Record<string, unknown>) => {
                if (part.type === "text") {
                  if (!part.synthetic) agg.input += (part.text as string) ?? ""
                }
                if (part.type === "file") agg.parts.push(stripPromptPartIDs(part as PromptPart))
                return agg
              },
              { input: "", parts: [] as PromptInfo["parts"] },
            )
            props.setPrompt(promptInfo)
          }
        },
      },
      {
        title: "Copy",
        value: "message.copy",
        description: "message text to clipboard",
        onSelect: async () => {
          if (!message) return

          const parts = ((sync.data.part as Record<string, unknown[]>)?.[message.id as string] ?? []) as Array<Record<string, unknown>>
          const text = parts.reduce((agg: string, part: Record<string, unknown>) => {
            if (part.type === "text" && !part.synthetic) {
              agg += (part.text as string) ?? ""
            }
            return agg
          }, "")

          await clipboard.write?.(text)
        },
      },
      {
        title: "Fork",
        value: "session.fork",
        description: "create a new session",
        onSelect: async () => {
          const result = await sdk.client.session?.fork?.({
            sessionID: props.sessionID,
            messageID: props.messageID,
          })
          if (!message) return
          const parts = ((sync.data.part as Record<string, unknown[]>)?.[message.id as string] ?? []) as Array<Record<string, unknown>>
          const prompt = parts.reduce(
            (agg: PromptInfo, part: Record<string, unknown>) => {
              if (part.type === "text") {
                if (!part.synthetic) agg.input += (part.text as string) ?? ""
              }
              if (part.type === "file") agg.parts.push(part as PromptPart)
              return agg
            },
            { input: "", parts: [] as PromptInfo["parts"] },
          )
          route.navigate({
            sessionID: result?.data?.id ?? "",
            type: "session",
            prompt,
          })
        },
      },
    ],
    [message, sync.data.part, sdk, route, clipboard, props],
  )

  useInput((_input, key) => {
    if (key.up) {
      setSelected((prev) => (prev - 1 + options.length) % options.length)
    } else if (key.down) {
      setSelected((prev) => (prev + 1) % options.length)
    } else if (key.return) {
      options[selected]?.onSelect()
    }
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Message Actions</Text>
      </Box>
      {options.map((opt, i) => (
        <Box key={opt.value} flexDirection="row">
          <Text color={i === selected ? "green" : undefined}>
            {i === selected ? "> " : "  "}
            {opt.title}
          </Text>
          <Text dimColor> - {opt.description}</Text>
        </Box>
      ))}
    </Box>
  )
}
