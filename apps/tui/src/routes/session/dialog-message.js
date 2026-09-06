import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime"
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
function stripPromptPartIDs(part) {
  const { id: _id, messageID: _mid, sessionID: _sid, ...rest } = part
  return rest
}
export function DialogMessage(props) {
  const sync = useSync()
  const sdk = useSDK()
  const route = useRoute()
  const clipboard = useClipboard()
  const [selected, setSelected] = React.useState(0)
  const message = useMemo(() => {
    const messages = sync.data.message?.[props.sessionID]
    return messages?.find((x) => x.id === props.messageID)
  }, [sync.data.message, props.sessionID, props.messageID])
  const options = useMemo(
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
            const parts = sync.data.part?.[message.id] ?? []
            const promptInfo = parts.reduce(
              (agg, part) => {
                if (part.type === "text") {
                  if (!part.synthetic && typeof part.text === "string") {
                    agg.input += part.text
                  }
                }
                if (part.type === "file") agg.parts.push(stripPromptPartIDs(part))
                return agg
              },
              { input: "", parts: [] },
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
          const parts = sync.data.part?.[message.id] ?? []
          const text = parts.reduce((agg, part) => {
            if (part.type === "text" && !part.synthetic && typeof part.text === "string") {
              agg += part.text
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
          const parts = sync.data.part?.[message.id] ?? []
          const prompt = parts.reduce(
            (agg, part) => {
              if (part.type === "text") {
                if (!part.synthetic && typeof part.text === "string") {
                  agg.input += part.text
                }
              }
              if (part.type === "file") agg.parts.push(part)
              return agg
            },
            { input: "", parts: [] },
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
  return _jsxs(Box, {
    flexDirection: "column",
    paddingX: 2,
    paddingY: 1,
    children: [
      _jsx(Box, {
        marginBottom: 1,
        children: _jsx(Text, { bold: true, children: "Message Actions" }),
      }),
      options.map((opt, i) =>
        _jsxs(
          Box,
          {
            flexDirection: "row",
            children: [
              _jsxs(Text, {
                color: i === selected ? "green" : undefined,
                children: [i === selected ? "> " : "  ", opt.title],
              }),
              _jsxs(Text, { dimColor: true, children: [" - ", opt.description] }),
            ],
          },
          opt.value,
        ),
      ),
    ],
  })
}
