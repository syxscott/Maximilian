/**
 * Epilogue setter: invoked by descendants to push a post-prompt message onto
 * the parent shell. In OpenCode this was a SolidJS context that exposed a
 * `set(value)` function; we keep the same shape on the React side.
 */

import { createSimpleContext } from "./helper"

export const { use: useEpilogue, provider: EpilogueProvider } = createSimpleContext<
  (value?: string) => void,
  { set: (value?: string) => void }
>({
  name: "Epilogue",
  init: (props) => props.set,
})
