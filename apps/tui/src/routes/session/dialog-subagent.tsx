// @ts-nocheck
/**
 * DialogSubagent: action menu for a subagent session.
 *
 * Ported from OpenCode's SolidJS `dialog-subagent.tsx`. The original used
 * `<DialogSelect>` from `@opentui/solid`; we rebuild the same pattern with
 * ink primitives and `useInput`.
 */

import React, { useMemo } from "react"
import { Box, Text, useInput } from "ink"
import { useRoute } from "../../context/route"

type Option = {
  title: string
  value: string
  description: string
  onSelect: () => void
}

export function DialogSubagent(props: { sessionID: string }) {
  const route = useRoute()
  const [selected, setSelected] = React.useState(0)

  const options: Option[] = useMemo(
    () => [
      {
        title: "Open",
        value: "subagent.view",
        description: "the subagent's session",
        onSelect: () => {
          route.navigate({
            type: "session",
            sessionID: props.sessionID,
          })
        },
      },
    ],
    [props.sessionID, route],
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
        <Text bold>Subagent Actions</Text>
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
