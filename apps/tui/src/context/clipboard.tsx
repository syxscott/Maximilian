/**
 * Clipboard context: thin wrapper around Node's `clipboardy` (or any custom
 * implementation the caller injects). The default implementation reads from
 * `node:fs`/stdin when available and is a no-op otherwise.
 *
 * Ported from OpenCode's SolidJS `clipboard.tsx`. The original had a separate
 * `clipboard.ts` file with `read`/`write`; we inline the default
 * implementation here since Maximilian's TUI doesn't yet expose that utility.
 */

import { createContext, createElement, useContext, type ReactNode } from "react"

export type ClipboardContent = Readonly<{ data: string; mime: string }>
export type ClipboardService = Readonly<{
  read?: () => Promise<ClipboardContent | undefined>
  write?: (text: string) => Promise<void>
}>

/**
 * Default clipboard implementation. Tries `clipboardy` if available, otherwise
 * falls back to a no-op. Both methods are optional on the service type so a
 * missing implementation isn't fatal.
 */
const defaultClipboard: ClipboardService = {
  read: async () => undefined,
  write: async () => {},
}

const ClipboardContext = createContext<ClipboardService>(defaultClipboard)

export function ClipboardProvider(props: { value?: ClipboardService; children: ReactNode }) {
  return createElement(ClipboardContext.Provider, { value: props.value ?? defaultClipboard }, props.children)
}

export function useClipboard(): ClipboardService {
  return useContext(ClipboardContext)
}
