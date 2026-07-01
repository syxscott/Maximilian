/**
 * React equivalent of SolidJS `<For>`.
 *
 * SolidJS's `<For>` renders each item of an array as its own reactive scope
 * keyed by reference. The React port keeps the public API:
 *
 *   <For each={items} fallback={<Empty/>}>
 *     {(item, index) => <Row item={item} index={index}/>}
 *   </For>
 *
 * Implementation notes:
 *  - Items are keyed by `each.indexOf(item)` (SolidJS's default); for large
 *    lists where items are objects and you want stable identity, pass
 *    `keyBy` to extract a key (e.g. `keyBy={(it) => it.id}`).
 *  - We re-render the whole list when `each` changes; if you need surgical
 *    updates wrap children in `React.memo` and rely on `key` to limit
 *    re-renders to the rows that actually changed.
 *  - `fallback` mirrors SolidJS's behaviour of rendering nothing when
 *    `each` is empty (or `undefined`).
 */
import { Children, type ReactNode } from "react"

export type ForProps<T> = {
  each: readonly T[] | undefined | null
  fallback?: ReactNode
  keyBy?: (item: T, index: number) => string | number
  children: (item: T, index: number) => ReactNode
}

export function For<T>(props: ForProps<T>): ReactNode {
  const list = props.each
  if (!list || list.length === 0) return props.fallback ?? null
  return Children.toArray(
    list.map((item, index) => {
      const key = props.keyBy ? props.keyBy(item, index) : index
      return (
        <ForRow key={key} index={index}>
          {props.children(item, index)}
        </ForRow>
      )
    }),
  )
}

function ForRow({ children: _children, index: _index }: { children: ReactNode; index: number }) {
  // The wrapper is necessary so React keys the item by its source key/index
  // rather than by the rendered child (which may not be keyed).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return <>{_children}</>
}
