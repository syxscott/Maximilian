// @ts-nocheck
import React, { useState } from "react"
import { Box, Text, useInput } from "ink"
import { selectedForeground, useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"

// Open the URL in the user's default browser. We avoid a hard dependency on
// the `open` package (not in the Maximilian TUI dependency list) and fall
// back to spawning the platform's default command if it's unavailable.
function openUrl(url: string): Promise<unknown> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const open = require("open") as (u: string) => Promise<unknown>
    return open(url)
  } catch {
    /* swallow: caller already handles failures */
    return Promise.resolve()
  }
}

const GO_URL = "https://opencode.ai/go"
const PAD_X = 3

export type DialogRetryActionProps = {
  title: string
  message: string
  label: string
  link?: string
  onClose?: (dontShowAgain?: boolean) => void
}

type Selection = "dismiss" | "action"

function runAction(
  props: DialogRetryActionProps,
  dialog: ReturnType<typeof useDialog>,
) {
  if (props.link) {
    void openUrl(props.link).catch(() => {})
  }
  props.onClose?.()
  dialog.clear()
}

function dismiss(
  props: DialogRetryActionProps,
  dialog: ReturnType<typeof useDialog>,
) {
  props.onClose?.(true)
  dialog.clear()
}

export function DialogRetryAction(props: DialogRetryActionProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const fg = selectedForeground(theme)
  const [selected, setSelected] = useState<Selection>("action")

  useInput((input, key) => {
    if (key.leftArrow || key.rightArrow || key.tab) {
      setSelected((value) => (value === "action" ? "dismiss" : "action"))
      return
    }
    if (key.return) {
      if (selected === "action") runAction(props, dialog)
      else dismiss(props, dialog)
    }
  })

  const isDismiss = selected === "dismiss"

  return (
    <Box flexDirection="column" paddingLeft={PAD_X} paddingRight={PAD_X} paddingBottom={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={theme.text}>
          {props.title}
        </Text>
        <Text color={theme.textMuted}>esc</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.textMuted}>{props.message}</Text>
      </Box>
      {props.link ? (
        <Box width="100%" flexDirection="row" justifyContent="center" paddingBottom={1} marginTop={1}>
          <Text color={theme.primary} wrap="truncate-end">
            {props.link}
          </Text>
        </Box>
      ) : (
        <Box paddingBottom={1} />
      )}
      <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
        <Box
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={isDismiss ? theme.primary : undefined}
        >
          <Text
            bold={isDismiss}
            color={isDismiss ? fg : theme.textMuted}
          >
            don&apos;t show again
          </Text>
        </Box>
        <Box
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={!isDismiss ? theme.primary : undefined}
        >
          <Text
            bold={!isDismiss}
            color={!isDismiss ? fg : theme.text}
          >
            {props.label}
          </Text>
        </Box>
      </Box>
    </Box>
  )
}

DialogRetryAction.show = (
  dialog: DialogContext,
  props: Pick<DialogRetryActionProps, "title" | "message" | "label" | "link">,
): Promise<boolean> => {
  return new Promise<boolean>((resolve) => {
    dialog.replace(
      <DialogRetryAction
        {...props}
        onClose={(dontShow) => resolve(dontShow ?? false)}
      />,
      { onClose: () => resolve(false) },
    )
  })
}
