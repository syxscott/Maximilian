/**
 * Ported from SolidJS `solid-js/store` `reconcile`.
 *
 * SolidJS `reconcile` diffs an incoming value against a target reference and
 * returns a structural copy that preserves identity for unchanged branches.
 * In a fine-grained reactive store this is what enables list reconciliation
 * (`key: "id"`) without re-rendering sibling items.
 *
 * In React/Zustand we don't have fine-grained reactivity, but we still want
 * to:
 *   - Avoid unnecessary object/array spread churn (helps Zustand's default
 *     shallow equality + the React `useStore` selector when consumers select
 *     a stable reference).
 *   - Keep array diffing fast (O(n)) so that large `session[]` and
 *     `message[id][]` lists don't get fully re-allocated on every event.
 *
 * The output is a new value structurally equal to `incoming` where leaves
 * and unchanged subtrees keep the same reference as `target`. This is
 * equivalent in shape to SolidJS's `reconcile(value, { key })`.
 */
export type ReconcileOptions = {
  key?: string | null
  merge?: boolean
}

type KeyFn = (item: unknown) => string | number | undefined

function keyExtractor(key: string | null | undefined | KeyFn): KeyFn {
  if (typeof key === "function") return key as KeyFn
  if (typeof key === "string" && key.length > 0) {
    return (item: unknown) => {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const value = (item as Record<string, unknown>)[key as string]
        if (typeof value === "string" || typeof value === "number") return value
      }
      return undefined
    }
  }
  return () => undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function diffArray(target: unknown, incoming: unknown[], key: KeyFn): unknown[] {
  if (!Array.isArray(target) || target.length === 0) return incoming.slice()
  const firstKey = incoming.length > 0 ? key(incoming[0]) : undefined
  const keyed = firstKey !== undefined
  if (!keyed) {
    // No key: produce a new array but reuse untouched primitive slots when
    // values are referentially equal to avoid breaking memoised selectors
    // for primitive lists.
    if (target.length === incoming.length) {
      let same = true
      for (let i = 0; i < incoming.length; i++) {
        if (!Object.is(target[i], incoming[i])) {
          same = false
          break
        }
      }
      if (same) return target as unknown[]
    }
    return incoming.slice()
  }

  // Keyed: walk the incoming list and look up the previous item by key.
  const targetByKey = new Map<string, unknown>()
  for (const item of target as unknown[]) {
    const k = key(item)
    if (k !== undefined) targetByKey.set(String(k), item)
  }
  const out: unknown[] = new Array(incoming.length)
  for (let i = 0; i < incoming.length; i++) {
    const next = incoming[i]!
    const k = key(next)
    if (k === undefined) {
      out[i] = next
      continue
    }
    const ks = String(k)
    const prev = targetByKey.get(ks)
    out[i] = prev ? reconcile(prev, next, { key: undefined }) : next
  }
  return out
}

function diffObject(
  target: unknown,
  incoming: Record<string, unknown>,
  key: string | null | undefined,
  merge: boolean,
): Record<string, unknown> {
  if (!isObject(target)) return { ...incoming }
  const out: Record<string, unknown> = merge ? { ...(target as Record<string, unknown>) } : {}
  let anyChange = !merge
  const targetObj = target as Record<string, unknown>
  for (const k of Object.keys(incoming)) {
    const next = incoming[k]
    const prev = targetObj[k]
    if (isObject(next) && isObject(prev) && !Array.isArray(next) === !Array.isArray(prev)) {
      if (Array.isArray(next) && Array.isArray(prev)) {
        const kfn = keyExtractor(key)
        const arr = diffArray(prev, next as unknown[], kfn)
        if (arr !== prev) anyChange = true
        out[k] = arr
      } else {
        const sub = reconcile(prev, next, { key, merge })
        if (sub !== prev) anyChange = true
        out[k] = sub
      }
    } else {
      if (!Object.is(prev, next)) anyChange = true
      out[k] = next
    }
  }
  if (!anyChange) return target as Record<string, unknown>
  return out
}

/**
 * Reconcile `incoming` against `target` and return a structurally-equal
 * value that preserves identity for unchanged branches. Pass `{ key }` to
 * reconcile arrays by a stable key (e.g. `"id"`).
 */
export function reconcile<T>(target: T, incoming: T, options: ReconcileOptions = {}): T {
  const { key = null, merge = false } = options

  if (Object.is(target, incoming)) return target
  if (incoming === null || incoming === undefined) return incoming
  if (typeof incoming !== "object") return incoming

  if (Array.isArray(incoming)) {
    return diffArray(target, incoming as unknown[], keyExtractor(key)) as T
  }
  if (Array.isArray(target)) {
    // Type changed from array to object; replace wholesale.
    return incoming
  }
  return diffObject(target, incoming as Record<string, unknown>, key, merge) as T
}

/**
 * Reconcile a single array by key. Convenience wrapper for the common
 * pattern `setStore("session", reconcile(next, { key: "id" }))`.
 */
export function reconcileArray<T>(target: T[] | undefined, incoming: T[], key: string): T[] {
  return diffArray(target, incoming, keyExtractor(key)) as T[]
}
