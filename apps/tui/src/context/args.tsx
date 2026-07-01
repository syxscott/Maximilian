/**
 * Parsed CLI args exposed as a context. The actual parsing happens before the
 * app mounts (see `apps/tui/src/index.tsx`); this context just packages the
 * parsed value for descendants via `createSimpleContext`.
 */

import { createSimpleContext } from "./helper"

export interface Args {
  model?: string
  agent?: string
  prompt?: string
  continue?: boolean
  sessionID?: string
  fork?: boolean
}

export const { use: useArgs, provider: ArgsProvider } = createSimpleContext<Args, Partial<Args>>({
  name: "Args",
  init: (props) => props as Args,
})
