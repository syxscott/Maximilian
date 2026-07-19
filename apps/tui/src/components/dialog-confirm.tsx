import React from "react"
import { Box, Text, useInput } from "ink"
import { Dialog, useDialog, type DialogContextValue } from "./dialog"

export interface DialogConfirmProps {
  title: string
  message: string
  onConfirm?: () => void
  onCancel?: () => void
  label?: string
}

export type DialogConfirmResult = boolean | undefined

const OPTIONS = ["cancel", "confirm"] as const
type Option = (typeof OPTIONS)[number]

const DEFAULT_COLORS = {
  text: "white",
  textMuted: "gray",
  primary: "cyan",
  selectedListItemText: "black",
}

function titleCase(input: string): string {
  if (!input) return input
  return input.charAt(0).toUpperCase() + input.slice(1)
}

export function DialogConfirm(props: DialogConfirmProps) {
  const dialog = useDialog()
  const [active, setActive] = React.useState<Option>("confirm")

  // The previous implementation called `props.onConfirm?.()` then
  // `dialog.clear()` synchronously. `dialog.clear()` fires `onClose`,
  // which `DialogConfirm.show` had set to `() => resolve(undefined)` —
  // so the second `resolve(undefined)` won (Promise ignores additional
  // resolves) and the awaited result was always `undefined` regardless
  // of the user's choice. Fix: only call `dialog.clear()` from inside
  // the onConfirm/onCancel callbacks themselves, and let ESC also
  // resolve explicitly to `false`.
  const commit = (which: "confirm" | "cancel") => {
    if (which === "confirm") props.onConfirm?.()
    if (which === "cancel") props.onCancel?.()
    dialog.clear()
  }

  useInput((input, key) => {
    if (key.return) {
      commit(active)
      return
    }
    if (key.escape) {
      // ESC means "cancel" — explicit resolve so callers awaiting the
      // promise don't hang until the dialog's onClose fires.
      if (active === "confirm") {
        // active was on confirm but ESC cancels; resolve false.
        props.onCancel?.()
      } else {
        props.onCancel?.()
      }
      dialog.clear()
      return
    }
    if (key.leftArrow || key.rightArrow) {
      setActive((prev) => (prev === "confirm" ? "cancel" : "confirm"))
    }
  })

  return (
    <Dialog size="medium">
      <Box flexDirection="column" paddingLeft={2} paddingRight={2} gap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={DEFAULT_COLORS.text}>
            {props.title}
          </Text>
          <Text color={DEFAULT_COLORS.textMuted}>esc</Text>
        </Box>
        <Box paddingBottom={1}>
          <Text color={DEFAULT_COLORS.textMuted}>{props.message}</Text>
        </Box>
        <Box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
          {OPTIONS.map((key) => {
            const isActive = key === active
            const labelText = titleCase(key === "cancel" ? (props.label ?? key) : key)
            // Highlight the active option by wrapping its label in a Text with
            // backgroundColor and inverse colors. ink doesn't expose
            // backgroundColor on Box, so we put the highlight on the inner Text.
            return (
              <Box key={key} paddingLeft={1} paddingRight={1}>
                <Text
                  color={isActive ? DEFAULT_COLORS.selectedListItemText : DEFAULT_COLORS.textMuted}
                  backgroundColor={isActive ? DEFAULT_COLORS.primary : undefined}
                >
                  {labelText}
                </Text>
              </Box>
            )
          })}
        </Box>
      </Box>
    </Dialog>
  )
}

DialogConfirm.show = (
  dialog: DialogContextValue,
  title: string,
  message: string,
  label?: string,
): Promise<DialogConfirmResult> => {
  return new Promise<DialogConfirmResult>((resolve) => {
    // onClose is the "I gave up / dialog was dismissed" path; resolve
    // to `undefined` ONLY if no user-driven resolve fired first. With
    // the fix above, commit() always resolves before clearing, so
    // onClose here is a true safety net for forced dismissals (e.g.
    // DialogProvider unmount) — in practice it should rarely fire.
    let settled = false
    const safeResolve = (value: DialogConfirmResult) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    dialog.replace(
      <DialogConfirm
        title={title}
        message={message}
        onConfirm={() => safeResolve(true)}
        onCancel={() => safeResolve(false)}
        label={label}
      />,
      { onClose: () => safeResolve(undefined) },
    )
  })
}

export default DialogConfirm
