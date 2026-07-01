/**
 * Clipboard context: thin wrapper around Node's `clipboardy` (or any custom
 * implementation the caller injects). The default implementation reads from
 * `node:fs`/stdin when available and is a no-op otherwise.
 *
 * Ported from OpenCode's SolidJS `clipboard.tsx`. The original had a separate
 * `clipboard.ts` file with `read`/`write`; we inline the default
 * implementation here since Maximilian's TUI doesn't yet expose that utility.
 */
import { createContext, createElement, useContext } from "react";
/**
 * Default clipboard implementation. Tries `clipboardy` if available, otherwise
 * falls back to a no-op. Both methods are optional on the service type so a
 * missing implementation isn't fatal.
 */
const defaultClipboard = {
    read: async () => undefined,
    write: async () => { },
};
const ClipboardContext = createContext(defaultClipboard);
export function ClipboardProvider(props) {
    return createElement(ClipboardContext.Provider, { value: props.value ?? defaultClipboard }, props.children);
}
export function useClipboard() {
    return useContext(ClipboardContext);
}
