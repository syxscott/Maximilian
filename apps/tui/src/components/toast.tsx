import React from "react"
import { Box, Text, useStdout } from "ink"

export type ToastVariant = "info" | "success" | "warning" | "error"

export interface ToastOptions {
  title?: string
  message: string
  variant: ToastVariant
  duration: number
}

export type ToastInput = Omit<ToastOptions, "duration"> & { duration?: number }

const DEFAULT_DURATION = 5000

const VARIANT_COLOR: Record<ToastVariant, string> = {
  info: "blue",
  success: "green",
  warning: "yellow",
  error: "red",
}

const DEFAULT_COLORS = {
  backgroundPanel: "black",
  text: "white",
}

// ---------------------------------------------------------------------------
// Toast context + provider
// ---------------------------------------------------------------------------

export interface ToastContextValue {
  currentToast: ToastOptions | null
  show(options: ToastInput): void
  error(err: unknown): void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const value = React.useContext(ToastContext)
  if (!value) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return value
}

export interface ToastProviderProps {
  children?: React.ReactNode
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [currentToast, setCurrentToast] = React.useState<ToastOptions | null>(null)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = React.useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const value = React.useMemo<ToastContextValue>(() => {
    return {
      currentToast,
      show(options) {
        clearTimer()
        const next: ToastOptions = {
          title: options.title,
          message: options.message,
          variant: options.variant,
          duration: options.duration ?? DEFAULT_DURATION,
        }
        setCurrentToast(next)
        timeoutRef.current = setTimeout(() => {
          setCurrentToast(null)
          timeoutRef.current = null
        }, next.duration)
      },
      error(err) {
        if (err instanceof Error) {
          value.show({ variant: "error", message: err.message })
          return
        }
        value.show({ variant: "error", message: "An unknown error has occurred" })
      },
    }
  }, [currentToast, clearTimer])

  React.useEffect(() => {
    return () => clearTimer()
  }, [clearTimer])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toast current={currentToast} />
    </ToastContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

interface ToastProps {
  current: ToastOptions | null
}

function Toast({ current }: ToastProps) {
  const { stdout } = useStdout()
  const width = stdout?.columns ?? 80

  if (!current) return null

  const maxWidth = Math.min(60, width - 6)
  const variantColor = VARIANT_COLOR[current.variant]

  return (
    <Box
      position="absolute"
      alignItems="flex-start"
      // Push the toast to the right edge of the terminal. ink doesn't support
      // absolute right positioning, so we offset the left margin instead.
      marginLeft={Math.max(0, width - maxWidth - 2)}
      marginTop={2}
      width={maxWidth}
      flexDirection="column"
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      borderStyle="single"
      borderColor={variantColor}
    >
      {current.title ? (
        <Box marginBottom={1}>
          <Text bold color={DEFAULT_COLORS.text}>
            {current.title}
          </Text>
        </Box>
      ) : null}
      <Text color={DEFAULT_COLORS.text} wrap="wrap">
        {current.message}
      </Text>
    </Box>
  )
}

// `backgroundPanel` was referenced from the OpenCode port; keep the export so
// downstream consumers that pulled it don't break.
export const DEFAULT_TOAST_COLORS = DEFAULT_COLORS

export default ToastProvider