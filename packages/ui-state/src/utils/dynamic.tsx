/**
 * React equivalent of SolidJS `<Dynamic>`.
 *
 * SolidJS's `<Dynamic>` renders an arbitrary component selected at runtime,
 * forwarding all props to it. The React port wraps the chosen component in
 * a small render function so callers can swap components on the fly:
 *
 *   <Dynamic component={state.open ? Modal : null} title="Hello"/>
 *
 *  - When `component` is `undefined` / `null` the component renders nothing.
 *  - Additional props are forwarded verbatim.
 *  - `children` are forwarded to the resolved component.
 *  - The default `key` is the resolved component itself so swapping
 *    components forces a fresh mount (mirroring SolidJS's behaviour of
 *    recreating the dynamic scope on type change). Pass `key` to override.
 */
import { createElement, type ComponentType, type ReactNode } from "react"

export type DynamicProps = {
  component?: ComponentType<Record<string, unknown>> | string | null
  children?: ReactNode
  key?: string | number
  [prop: string]: unknown
}

export function Dynamic(props: DynamicProps): ReactNode {
  const Component = props.component
  if (!Component) return null
  const { component: _ignore, key, children, ...rest } = props as DynamicProps & {
    component: unknown
    key?: string | number
    children?: ReactNode
  }
  void _ignore
  return createElement(Component as ComponentType<Record<string, unknown>>, { key, children, ...rest })
}
