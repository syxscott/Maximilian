/**
 * React equivalent of SolidJS `<Show>`.
 *
 * SolidJS's `<Show>` short-circuits rendering of its children when `when` is
 * falsy and exposes a non-nullable accessor to the truthy value. The
 * idiomatic React port keeps the same shape:
 *
 *   <Show when={condition} fallback={<Loading/>}>
 *     {(value) => <Component value={value}/>}
 *   </Show>
 *
 * Notes:
 *  - `when` accepts any value; the truthy value is forwarded to the child
 *    function so the child is fully typed (mirroring Solid's narrowing).
 *  - Static children (functions are optional) are also supported.
 *  - The component is intentionally a thin pass-through so React's usual
 *    reconciliation rules apply; use `key` on the wrapping element to force
 *    a fresh subtree on `when` transitions if you need a "mount/unmount"
 *    semantics similar to SolidJS.
 */
import type { ReactNode } from "react"

export type ShowProps<T> = {
  when: T | undefined | null | false
  fallback?: ReactNode
  children: ReactNode | ((value: NonNullable<T>) => ReactNode)
  key?: string | number
}

export function Show<T>(props: ShowProps<T>): ReactNode {
  const value = props.when
  if (value === undefined || value === null || value === false || value === "" || value === 0) {
    return props.fallback ?? null
  }
  if (typeof props.children === "function") {
    return (props.children as (value: NonNullable<T>) => ReactNode)(value as NonNullable<T>)
  }
  return props.children
}
