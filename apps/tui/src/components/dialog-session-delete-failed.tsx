// @ts-nocheck
import React, { useState } from "react"
import { Box, Text, useInput } from "ink"
import { useTheme } from "../context/theme"
import { useDialog } from "./dialog"

export type DialogSessionDeleteFailedProps = {
  session: string
  workspace: string
  onDelete?: () => boolean | void | Promise<boolean | void>
  onRestore?: () => boolean | void | Promise<boolean | void>
  onDone?: () => void
}

type Action = "delete" | "restore"

type Option = {
  id: Action
  title: string
  description: string
  run?: DialogSessionDeleteFailedProps["onDelete"] | DialogSessionDeleteFailedProps["onRestore"]
}

export function DialogSessionDeleteFailed(props: DialogSessionDeleteFailedProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [active, setActive] = useState<Action>("delete")

  const options: Option[] = [
    {
      id: "delete",
      title: "Delete workspace",
      description: "Delete the workspace and all sessions attached to it.",
      run: props.onDelete,
    },
    {
      id: "restore",
      title: "Restore to new workspace",
      description: "Try to restore this session into a new workspace.",
      run: props.onRestore,
    },
  ]

  async function confirm() {
    const found = options.find((item) => item.id === active)
    const result = await found?.run?.()
    if (result === false) return
    if (props.onDone) {
      props.onDone()
    } else {
      dialog.clear()
    }
  }

  useInput((input, key) => {
    if (key.return) {
      void confirm()
      return
    }
    if (key.leftArrow || key.upArrow) {
      setActive("delete")
      return
    }
    if (key.rightArrow || key.downArrow) {
      setActive("restore")
      return
    }
  })

  return (
    <Box flexDirection="column" paddingLeft={2} paddingRight={2}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={theme.text}>
          Failed to Delete Session
        </Text>
        <Text color={theme.textMuted}>esc</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color={theme.textMuted} wrap="wrap">
          {`The session "${props.session}" could not be deleted because the workspace "${props.workspace}" is not available.`}
        </Text>
        <Text color={theme.textMuted} wrap="wrap">
          Choose how you want to recover this broken workspace session.
        </Text>
      </Box>
      <Box flexDirection="column" paddingBottom={1} marginTop={1}>
        {options.map((item) => (
          <Box
            key={item.id}
            flexDirection="column"
            paddingLeft={1}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
            backgroundColor={item.id === active ? theme.primary : undefined}
          >
            <Text
              bold
              color={item.id === active ? theme.selectedListItemText : theme.text}
            >
              {item.title}
            </Text>
            <Text
              color={item.id === active ? theme.selectedListItemText : theme.textMuted}
              wrap="wrap"
            >
              {item.description}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
