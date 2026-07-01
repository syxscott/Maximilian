/**
 * React equivalent of SolidJS `<Switch>` / `<Match>`.
 *
 *   <Switch fallback={<Loading/>}>
 *     <Match when={state === "ready"}>{(s) => <Ready data={s}/>}</Match>
 *     <Match when={state === "error"}>{(s) => <Error data={s}/>}</Match>
 *   </Switch>
 *
 * The first `<Match>` whose `when` is truthy wins; the rest are skipped.
 * Children of a winning match are evaluated; siblings are not. The child
 * may be a function that receives the truthy value (matching the Solid
 * type-narrowing behaviour) or a static node.
 */
import { Children, isValidElement, type ReactNode } from "react"

export type MatchProps<T> = {
  when: T | undefined | null | false
  children: ReactNode | ((value: NonNullable<T>) => ReactNode)
}

export function Match<T>(props: MatchProps<T>): ReactNode {
  return null
}

export type SwitchProps = {
  fallback?: ReactNode
  children: ReactNode
}

function isMatch(node: unknown): node is ReactElement<MatchProps<unknown>> {
  if (!isValidElement(node)) return false
  // `Match` is a function component in this file; we can compare by reference.
  return (node.type as unknown) === (Match as unknown)
}

import type { ReactElement } from "react"

export function Switch(props: SwitchProps): ReactNode {
  let matched: ReactNode = props.fallback ?? null
  Children.forEach(props.children, (child) => {
    if (matched !== (props.fallback ?? null)) return
    if (!isMatch(child)) return
    const when = child.props.when
    if (when === undefined || when === null || when === false || when === "" || when === 0) {
      return
    }
    const body = child.props.children
    matched =
      typeof body === "function"
        ? (body as (value: unknown) => ReactNode)(when)
        : body
  })
  return matched
}
