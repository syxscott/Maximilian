/**
 * Exit function exposed via context. SolidJS used `createSimpleContext` to
 * share a single `exit(reason?)` callback; we mirror the same shape here.
 */

import { createSimpleContext } from "./helper"

export type Exit = (reason?: unknown) => void

export const { use: useExit, provider: ExitProvider } = createSimpleContext<Exit, { exit: Exit }>({
  name: "Exit",
  init: (input) => input.exit,
})
