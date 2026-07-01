// @ts-nocheck
/**
 * DialogTimeline: scrollable list of user messages in a session.
 *
 * Ported from OpenCode's SolidJS `dialog-timeline.tsx`. The original used
 * `<DialogSelect>` and `createMemo` for lazy option computation; we rebuild
 * the list UI with ink primitives and `useMemo`.
 */

import React, { useEffect, useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import { useSync } from "../../context/sync"
import { useDialog } from "../../components/dialog"
import { Locale } from "../../util/locale"
import { DialogMessage, type PromptInfo } from "./dialog-message"

type TextPart = { type: "text"; text: string; synthetic?: boolean; ignored?: boolean }

type Option<T> = {
  title: string
  value: T
  footer?: string
}

export function DialogTimeline(props: {
  sessionID: string
  onMove: (messageID: string) => void
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const sync = useSync()
  const dialog = useDialog()
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    dialog.setSize("large")
  }, [dialog])

  const options = useMemo((): Option<string>[] => {
    const messages = (sync.data.message as Record<string, Array<{ id: string; role: string; time: { created: number }; [k: string]: unknown }>>)?.[props.sessionID] ?? []
    const result: Option<string>[] = []
    for (const message of messages) {
      if (message.role !== "user") continue
      const parts = ((sync.data.part as Record<string, TextPart[]>)?.[message.id] ?? []) as TextPart[]
      const part = parts.find((x) => x.type === "text" && !x.synthetic && !x.ignored)
      if (!part) continue
      result.push({
        title: part.text.replace(/\n/g, " "),
        value: message.id,
        footer: Locale.time(message.time.created),
      })
    }
    result.reverse()
    return result
  }, [sync.data.message, sync.data.part, props.sessionID])

  useInput((_input, key) => {
    if (key.up) {
      setSelected((prev) => (prev - 1 + options.length) % options.length)
    } else if (key.down) {
      setSelected((prev) => (prev + 1) % options.length)
    } else if (key.return) {
      const opt = options[selected]
      if (opt) {
        props.onMove(opt.value)
        dialog.replace(
          <DialogMessage messageID={opt.value} sessionID={props.sessionID} setPrompt={props.setPrompt} />,
        )
      }
    }
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Timeline</Text>
      </Box>
      {options.length === 0 ? (
        <Text dimColor>No messages found.</Text>
      ) : (
        options.map((opt, i) => (
          <Box key={opt.value} flexDirection="row" justifyContent="space-between">
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
