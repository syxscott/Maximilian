// @ts-nocheck
import React, { useState } from "react"
import { Box, Text, useInput } from "ink"
import { useTheme } from "../context/theme"
import { useDialog } from "./dialog"

export type DialogWorkspaceUnavailableProps = {
  onRestore?: () => boolean | void | Promise<boolean | void>
}

type Action = "cancel" | "restore"

const OPTIONS: Action[] = ["cancel", "restore"]

export function DialogWorkspaceUnavailable(props: DialogWorkspaceUnavailableProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [active, setActive] = useState<Action>("restore")

  async function confirm() {
    if (active === "cancel") {
      dialog.clear()
      return
    }
    const result = await props.onRestore?.()
    if (result === false) return
  }

  useInput((input, key) => {
    if (key.return) {
      void confirm()
      return
    }
    if (key.leftArrow) {
      setActive("cancel")
      return
    }
    if (key.rightArrow) {
      setActive("restore")
      return
    }
  })

  return (
    <Box flexDirection="column" paddingLeft={2} paddingRight={2}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={theme.text}>
          Workspace Unavailable
        </Text>
        <Text color={theme.textMuted}>esc</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color={theme.textMuted} wrap="wrap">
          This session is attached to a workspace that is no longer available.
        </Text>
        <Text color={theme.textMuted} wrap="wrap">
          Would you like to restore this session into a new workspace?
        </Text>
      </Box>
      <Box flexDirection="row" justifyContent="flex-end" paddingBottom={1} marginTop={1} gap={1}>
        {OPTIONS.map((item) => (
          <Box
            key={item}
            paddingLeft={2}
            paddingRight={2}
            backgroundColor={item === active ? theme.primary : undefined}
          >
            <Text color={item === active ? theme.selectedListItemText : theme.textMuted}>{item}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
