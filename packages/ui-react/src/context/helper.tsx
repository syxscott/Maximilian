import * as React from "react"

/**
 * React equivalent of OpenCode's SolidJS `createSimpleContext`. Returns a
 * Provider component and a `use*` hook for ergonomic context consumption.
 *
 * If the supplied `init` return value exposes a boolean `ready` getter or
 * field, the provider will gate rendering until it is truthy. This mirrors
 * the `gate` semantics of the original helper.
 */
export function createSimpleContext<T, Props extends Record<string, any>>(input: {
  name: string
  init: ((input: Props) => T) | (() => T)
}) {
  const Context = React.createContext<T | undefined>(undefined)

  function Provider(props: Props & { children?: React.ReactNode }) {
    const value = (input.init as (p: Props) => T)(props)

    const isReady = (() => {
      const ready = (value as { ready?: unknown }).ready
      if (ready === undefined) return true
      if (typeof ready === "function") return Boolean((ready as () => unknown)())
      return Boolean(ready)
    })()

    if (!isReady) {
      return <>{props.children}</>
    }

    return <Context.Provider value={value}>{props.children}</Context.Provider>
  }

  function use(): T {
    const ctx = React.useContext(Context)
    if (ctx === undefined) {
      throw new Error(`${input.name} context must be used within a context provider`)
    }
    return ctx
  }

  return { provider: Provider, use }
}