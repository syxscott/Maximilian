/**
 * Ported from OpenCode packages/ui/src/context/helper.tsx
 *
 * SolidJS `createSimpleContext` -> React Context + Provider + hook.
 *
 * In SolidJS, the helper wraps `createContext` + a Provider that gates
 * rendering on a `ready` getter. In React we lose fine-grained reactivity,
 * so the equivalent is:
 *   - A `Provider` component that initialises the value and renders nothing
 *     until `value.ready` is truthy (when `gate` is true).
 *   - A `use()` hook that reads from the context and throws if used outside.
 *
 * The `gate` option is preserved: when `false`, the children render even
 * when the context is not "ready". The `ready` field on the value is
 * always honoured when present and `gate` is unset/true.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

export type CreateSimpleContextOptions<T, Props extends Record<string, unknown>> = {
  name: string
  init:
    | ((props: Props) => T)
    | ((props: Props) => T)
  gate?: boolean
}

type GateFlag<T> = T extends { ready: unknown } ? { gate: boolean } : { gate?: boolean }

export type CreateSimpleContextInput<T, Props extends Record<string, unknown>> = {
  name: string
  init: ((input: Props) => T) | (() => T)
} & GateFlag<T>

export interface SimpleContext<T> {
  Provider: (props: PropsWithChildren<{ value?: T }>) => ReactNode
  use: () => T
  _name: string
}

type PropsWithChildren<P> = P & { children?: ReactNode }

export function createSimpleContext<T, Props extends Record<string, unknown>>(
  input: CreateSimpleContextInput<T, Props>,
): {
  provider: (props: PropsWithChildren<Props>) => ReactNode
  use: () => T
} {
  const ctx = createContext<T | null>(null)

  function Provider(props: PropsWithChildren<Props>): ReactNode {
    // Initialise once per mount. In Solid this is reactive per accessor; in
    // React we accept that the value is stable for the lifetime of the
    // provider instance, mirroring Solid's default behaviour of a single
    // `init` call per owner.
    const [value] = useState(() => input.init(props))
    const gate = input.gate ?? true
    const children = props.children

    // If the value exposes a `ready` getter (function or boolean), subscribe
    // to it so we re-render when it flips. The original OpenCode helper
    // wraps this in a `createMemo`; we approximate with state.
    const readyAccessor = (value as { ready?: unknown }).ready
    const isReady = useReadyFlag(readyAccessor)
    const shouldRender = !gate || isReady

    if (!shouldRender) return null
    return <ctx.Provider value={value}>{children}</ctx.Provider>
  }

  function use(): T {
    const value = useContext(ctx)
    if (value === null) {
      throw new Error(`${input.name} context must be used within a context provider`)
    }
    return value
  }

  return { provider: Provider, use }
}

/**
 * Tracks a `ready` flag exposed by the value. Mirrors the SolidJS memo:
 * the flag is a function (Accessor) or boolean.
 */
function useReadyFlag(ready: unknown): boolean {
  const compute = (): boolean => {
    if (ready === undefined) return true
    if (typeof ready === "function") return Boolean((ready as () => unknown)())
    return Boolean(ready)
  }

  // If `ready` is a function, we may not be able to subscribe directly. We
  // optimistically render as soon as the function reports ready; consumers
  // who need fine-grained updates should expose `ready` as state via
  // Zustand and rely on the parent re-rendering.
  const ref = useRef<boolean>(compute())
  if (ref.current !== true) ref.current = compute()
  // No subscription path: this is the React equivalent of "render once
  // when the value's ready flag is true". For most cases, the value is
  // a Zustand store and `ready` is a derived state slice; the parent
  // re-renders when the underlying state changes, which re-evaluates
  // this hook.
  useEffect(() => {
    ref.current = compute()
  })
  return ref.current
}
