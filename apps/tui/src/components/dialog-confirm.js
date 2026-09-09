import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime"
import React from "react"
import { Box, Text, useInput } from "ink"
import { Dialog, useDialog } from "./dialog"
const OPTIONS = ["cancel", "confirm"]
const DEFAULT_COLORS = {
  text: "white",
  textMuted: "gray",
  primary: "cyan",
  selectedListItemText: "black",
}
function titleCase(input) {
  if (!input) return input
  return input.charAt(0).toUpperCase() + input.slice(1)
}
export function DialogConfirm(props) {
  const dialog = useDialog()
  const [active, setActive] = React.useState("confirm")
  // The previous implementation called `props.onConfirm?.()` then
  // `dialog.clear()` synchronously. `dialog.clear()` fires `onClose`,
  // which `DialogConfirm.show` had set to `() => resolve(undefined)` —
  // so the second `resolve(undefined)` won (Promise ignores additional
  // resolves) and the awaited result was always `undefined` regardless
  // of the user's choice. Fix: only call `dialog.clear()` from inside
  // the onConfirm/onCancel callbacks themselves, and let ESC also
  // resolve explicitly to `false`.
  const commit = (which) => {
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
      // ESC means "cancel" — always, regardless of which option is
      // currently highlighted.
      commit("cancel")
      return
    }
    if (key.leftArrow || key.rightArrow) {
      setActive((prev) => (prev === "confirm" ? "cancel" : "confirm"))
    }
  })
  return _jsx(Dialog, {
    size: "medium",
    children: _jsxs(Box, {
      flexDirection: "column",
      paddingLeft: 2,
      paddingRight: 2,
      gap: 1,
      children: [
        _jsxs(Box, {
          flexDirection: "row",
          justifyContent: "space-between",
          children: [
            _jsx(Text, { bold: true, color: DEFAULT_COLORS.text, children: props.title }),
            _jsx(Text, { color: DEFAULT_COLORS.textMuted, children: "esc" }),
          ],
        }),
        _jsx(Box, {
          paddingBottom: 1,
          children: _jsx(Text, { color: DEFAULT_COLORS.textMuted, children: props.message }),
        }),
        _jsx(Box, {
          flexDirection: "row",
          justifyContent: "flex-end",
          paddingBottom: 1,
          children: OPTIONS.map((key) => {
            const isActive = key === active
            const labelText = titleCase(key === "cancel" ? (props.label ?? key) : key)
            // Highlight the active option by wrapping its label in a Text with
            // backgroundColor and inverse colors. ink doesn't expose
            // backgroundColor on Box, so we put the highlight on the inner Text.
            return _jsx(
              Box,
              {
                paddingLeft: 1,
                paddingRight: 1,
                children: _jsx(Text, {
                  color: isActive ? DEFAULT_COLORS.selectedListItemText : DEFAULT_COLORS.textMuted,
                  backgroundColor: isActive ? DEFAULT_COLORS.primary : undefined,
                  children: labelText,
                }),
              },
              key,
            )
          }),
        }),
      ],
    }),
  })
}
DialogConfirm.show = (dialog, title, message, label) => {
  return new Promise((resolve) => {
    // A confirm dialog resolves `true` only via the Confirm option; every
    // other exit — Cancel option, ESC, forced dismissal (provider
    // unmount, replace) — resolves `false`. Resolve-close (onClose) and
    // the dialog's own ESC handler race on the same keypress (both the
    // provider and this component have active useInput handlers, and
    // ink's listener order flips across re-renders), so onClose MUST
    // resolve `false` rather than `undefined` to keep the outcome
    // deterministic no matter which handler wins.
    let settled = false
    const safeResolve = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    dialog.replace(
      _jsx(DialogConfirm, {
        title: title,
        message: message,
        onConfirm: () => safeResolve(true),
        onCancel: () => safeResolve(false),
        label: label,
      }),
      { onClose: () => safeResolve(false) },
    )
  })
}
export default DialogConfirm
