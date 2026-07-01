/**
 * Simple React 19 context factory for the Maximilian TUI.
 *
 * Replaces OpenCode's SolidJS `createSimpleContext` helper. The Solid version
 * used a `Show` wrapper to gate provider mounting until `init.ready === true`;
 * in React we model that explicitly via an optional `ready` flag that
 * providers check in `useXxx` hooks, since React does not allow conditional
 * provider mounting without violating the rules of hooks.
 *
 * The init function is called directly in the component body (not inside useMemo)
 * to comply with Rules of Hooks — init functions may call React hooks internally.
 */

import { createContext, createElement, useContext, useRef, type ReactNode } from "react"

export type SimpleContextInit<T, Props> = ((input: Props) => T) | (() => T)

export type SimpleContextHandle<T, Props> = {
  context: React.Context<T | undefined>
  provider: (props: Props & { children?: ReactNode }) => ReactNode
  use: () => T
}

export function createSimpleContext<T, Props extends Record<string, unknown> = Record<string, never>>(
  input: { name: string; init: SimpleContextInit<T, Props> },
): SimpleContextHandle<T, Props> {
  const Ctx = createContext<T | undefined>(undefined)

  function ProviderInner(props: Props & { children?: ReactNode }) {
    const { children, ...rest } = props as Props & { children?: ReactNode }
    // Call init directly (not in useMemo) so hooks inside init are called every render
    const value = (input.init as (input: Props) => T)(rest as Props)
    return createElement(Ctx.Provider, { value }, children)
  }

  const handle: SimpleContextHandle<T, Props> = {
    context: Ctx,
    provider: ((props: Props & { children?: ReactNode }) =>
      createElement(ProviderInner, props)) as SimpleContextHandle<T, Props>["provider"],
    use() {
      const value = useContext(Ctx)
      if (value === undefined) {
        throw new Error(`${input.name} context must be used within a context provider`)
      }
      return value
    },
  }

  return handle
}
