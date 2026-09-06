import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime"
import React from "react"
import { Box, Text, useInput } from "ink"
const SIZE_TO_WIDTH = {
  medium: 60,
  large: 88,
  xlarge: 116,
}
export function Dialog({ size = "medium", children }) {
  // The "backdrop" is a tall column that pushes the panel down; ink has no
  // alpha, so we hint at it with a single dim text line above the panel.
  return _jsxs(Box, {
    flexDirection: "column",
    alignItems: "center",
    paddingTop: 8,
    children: [
      _jsx(Text, { dimColor: true, children: "─".repeat(SIZE_TO_WIDTH[size]) }),
      _jsx(Box, {
        width: SIZE_TO_WIDTH[size],
        flexDirection: "column",
        paddingTop: 1,
        paddingLeft: 1,
        paddingRight: 1,
        borderStyle: "round",
        borderColor: "gray",
        children: children,
      }),
      _jsx(Text, { dimColor: true, children: "─".repeat(SIZE_TO_WIDTH[size]) }),
    ],
  })
}
const DialogContext = React.createContext(null)
export function useDialog() {
  const value = React.useContext(DialogContext)
  if (!value) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  return value
}
export function DialogProvider({ children }) {
  const [stack, setStack] = React.useState([])
  const [size, setSizeState] = React.useState("medium")
  const value = React.useMemo(() => {
    return {
      stack,
      size,
      replace(element, options) {
        // Pop the top entry and push the new one. Only the top's onClose
        // fires — replace is a pop+push on the stack, not a clear-and-
        // rebuild. The previous implementation iterated every entry and
        // fired onClose on each, which clashed with the Provider's own
        // ESC handler (which already pops the top) and caused stacked
        // dialogs' onClose to fire in the wrong order: e.g. dismissing
        // dialog C would also close A and B even though the user never
        // saw them go away.
        const top = stack[stack.length - 1]
        top?.onClose?.()
        const next = {
          element,
          size: options?.size ?? "medium",
          onClose: options?.onClose,
        }
        setStack([...stack.slice(0, -1), next])
        setSizeState(options?.size ?? "medium")
      },
      clear() {
        for (const entry of stack) entry.onClose?.()
        setStack([])
        setSizeState("medium")
      },
      setSize(next) {
        setSizeState(next)
      },
    }
  }, [stack, size])
  // Global escape + ctrl+c binding while any dialog is open.
  useInput(
    (input, key) => {
      if (stack.length === 0) return
      if (key.escape || (key.ctrl && input === "c")) {
        const current = stack[stack.length - 1]
        current?.onClose?.()
        setStack((prev) => prev.slice(0, -1))
      }
    },
    { isActive: stack.length > 0 },
  )
  const top = stack[stack.length - 1]
  return _jsxs(DialogContext.Provider, {
    value: value,
    children: [
      children,
      top
        ? _jsx(Box, {
            position: "absolute",
            children: _jsx(Dialog, { size: top.size, children: top.element }),
          })
        : null,
    ],
  })
}
export default Dialog
