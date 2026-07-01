import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import fuzzysort from "fuzzysort"

export interface FilteredListProps<T> {
  items: T[] | ((filter: string) => T[] | Promise<T[]>)
  key: (item: T) => string
  filterKeys?: string[]
  current?: T
  groupBy?: (x: T) => string
  sortBy?: (a: T, b: T) => number
  sortGroupsBy?: (a: { category: string; items: T[] }, b: { category: string; items: T[] }) => number
  skipFilter?: (item: T) => boolean
  onSelect?: (value: T | undefined, index: number) => void
  noInitialSelection?: boolean
}

export interface Grouped<T> {
  category: string
  items: T[]
}

export function useFilteredList<T>(props: FilteredListProps<T>) {
  const [filter, setFilter] = useState<string>("")

  const resolvedItems = useMemo<T[]>(() => {
    if (typeof props.items === "function") {
      // For synchronous lists; async ones are not supported in this port
      return (props.items as (f: string) => T[])(filter) ?? []
    }
    return props.items
  }, [filter, props.items])

  const filteredAndGrouped = useMemo<Grouped<T>[]>(() => {
    const needle = filter.toLowerCase()
    let working: T[] = resolvedItems
    if (needle) {
      const skipFilter = props.skipFilter
      const filterable = skipFilter ? working.filter((item) => !skipFilter(item)) : working
      const skipped = skipFilter ? working.filter(skipFilter) : []
      const filtered =
        !props.filterKeys &&
        Array.isArray(filterable) &&
        filterable.every((e) => typeof e === "string")
          ? (fuzzysort.go(needle, filterable as string[]).map((x) => x.target) as unknown as T[])
          : fuzzysort.go(needle, filterable as object[], { keys: props.filterKeys! }).map((x) => x.obj as T)
      working = skipped.length ? [...filtered, ...skipped] : filtered
    }

    const grouped = new Map<string, T[]>()
    for (const item of working) {
      const category = props.groupBy ? props.groupBy(item) : ""
      const arr = grouped.get(category) ?? []
      arr.push(item)
      grouped.set(category, arr)
    }

    let groups: Grouped<T>[] = Array.from(grouped, ([k, v]) => ({
      category: k,
      items: props.sortBy ? [...v].sort(props.sortBy) : v,
    }))

    if (props.sortGroupsBy) {
      groups = groups.sort(props.sortGroupsBy)
    }

    return groups
  }, [resolvedItems, filter, props.filterKeys, props.skipFilter, props.groupBy, props.sortBy, props.sortGroupsBy])

  const flat = useMemo<T[]>(() => {
    return filteredAndGrouped.flatMap((g) => g.items)
  }, [filteredAndGrouped])

  const initialActive = useMemo<string>(() => {
    if (props.noInitialSelection) return ""
    if (props.current) return props.key(props.current)
    if (flat.length === 0) return ""
    return props.key(flat[0])
  }, [props.noInitialSelection, props.current, props.key, flat])

  const [active, setActive] = useState<string>(initialActive)

  const reset = useCallback(() => {
    if (props.noInitialSelection) {
      setActive("")
      return
    }
    if (flat.length === 0) return
    setActive(props.key(flat[0]))
  }, [flat, props.noInitialSelection, props.key])

  useEffect(() => {
    reset()
  }, [reset])

  const moveActive = useCallback(
    (direction: 1 | -1) => {
      if (flat.length === 0) return
      const idx = flat.findIndex((x) => props.key(x) === active)
      let next = idx + direction
      if (idx === -1) {
        next = direction === 1 ? 0 : flat.length - 1
      } else if (next < 0) {
        next = flat.length - 1
      } else if (next >= flat.length) {
        next = 0
      }
      setActive(props.key(flat[next]))
    },
    [flat, active, props.key],
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent | React.KeyboardEvent) => {
      if (event.key === "Enter" && !(event as any).isComposing) {
        event.preventDefault()
        const selectedIndex = flat.findIndex((x) => props.key(x) === active)
        const selected = flat[selectedIndex]
        if (selected !== undefined) props.onSelect?.(selected, selectedIndex)
        return
      }

      if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        if (event.key === "n" || event.key === "p") {
          event.preventDefault()
          moveActive(event.key === "n" ? 1 : -1)
          return
        }
      }

      // Skip list navigation for text editing shortcuts (e.g., Option+Arrow, Option+Backspace on macOS)
      if (event.altKey || event.metaKey) return

      if (event.key === "ArrowDown") {
        event.preventDefault()
        moveActive(1)
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        moveActive(-1)
      }
    },
    [flat, active, props.key, props.onSelect, moveActive],
  )

  const onInput = useCallback((value: string) => {
    setFilter(value)
  }, [])

  const refetch = useCallback(() => {
    // No-op in this port: filtering is fully derived from props.items + filter
    // Async sources are not supported.
  }, [])

  return {
    grouped: filteredAndGrouped,
    filter,
    flat,
    reset,
    refetch,
    clear: () => setFilter(""),
    onKeyDown,
    onInput,
    active,
    setActive,
  }
}