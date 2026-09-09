import React from "react"
import { Box, Text, useInput } from "ink"

// OpenCode's `Dialog` is a modal overlay with a centered panel. In this React
// 19 + ink port we expose:
//
//   - <Dialog>: a single modal panel. Pure presentational — it does NOT
//     register its own `useInput` for ESC, because the surrounding
//     <DialogProvider> already does (and double-registering causes the
//     stack's onClose callbacks to fire twice on a single keypress).
//   - <DialogProvider> + useDialog(): a stack-based registry implemented with
//     React Context. Components push a node onto the stack and the top of the
//     stack is rendered above the rest of the app. ESC handling lives HERE
//     (single source of truth).
//
// Notes on differences from OpenCode:
//   * ink 5.x has no native mouse handling, so we drop the outside-click and
//     button onClick handlers. Consumers wire up key-based dismissal via
//     `useDialog()` + `useInput`.
//   * The backdrop is rendered as a flat dark Text block since ink's Box has
//     no `backgroundColor` prop.

export type DialogSize = "medium" | "large" | "xlarge"

export interface DialogProps {
  size?: DialogSize
  children?: React.ReactNode
}

const SIZE_TO_WIDTH: Record<DialogSize, number> = {
  medium: 60,
  large: 88,
  xlarge: 116,
}

export function Dialog({ size = "medium", children }: DialogProps) {
  // The "backdrop" is a tall column that pushes the panel down; ink has no
  // alpha, so we hint at it with a single dim text line above the panel.
  return (
    <Box flexDirection="column" alignItems="center" paddingTop={8}>
      <Text dimColor>{"─".repeat(SIZE_TO_WIDTH[size])}</Text>
      <Box
        width={SIZE_TO_WIDTH[size]}
        flexDirection="column"
        paddingTop={1}
        paddingLeft={1}
        paddingRight={1}
        borderStyle="round"
        borderColor="gray"
      >
        {children}
      </Box>
      <Text dimColor>{"─".repeat(SIZE_TO_WIDTH[size])}</Text>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Stack-based dialog registry
// ---------------------------------------------------------------------------

export interface DialogEntry {
  element: React.ReactNode
  size: DialogSize
  onClose?: () => void
}

export interface DialogContextValue {
  stack: DialogEntry[]
  size: DialogSize
  replace(element: React.ReactNode, options?: { size?: DialogSize; onClose?: () => void }): void
  clear(): void
  setSize(size: DialogSize): void
}

const DialogContext = React.createContext<DialogContextValue | null>(null)

export function useDialog(): DialogContextValue {
  const value = React.useContext(DialogContext)
  if (!value) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  return value
}

export interface DialogProviderProps {
  children?: React.ReactNode
}

export function DialogProvider({ children }: DialogProviderProps) {
  const [stack, setStack] = React.useState<DialogEntry[]>([])
  const [size, setSizeState] = React.useState<DialogSize>("medium")

  const value = React.useMemo<DialogContextValue>(() => {
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
        const next: DialogEntry = {
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

  return (
    <DialogContext.Provider value={value}>
      {children}
      {top ? (
        <Box position="absolute">
          <Dialog size={top.size}>{top.element}</Dialog>
        </Box>
      ) : null}
    </DialogContext.Provider>
  )
}

export default Dialog
