import * as React from "react"
import { cn } from "../lib/utils"

function findByKey(container: HTMLElement, key: string): HTMLElement | null {
  const nodes = container.querySelectorAll<HTMLElement>('[data-slot="list-item"][data-key]')
  for (const node of Array.from(nodes)) {
    if (node.getAttribute("data-key") === key) return node
  }
  return null
}

export interface ListSearchProps {
  placeholder?: string
  autofocus?: boolean
  hideIcon?: boolean
  className?: string
  action?: React.ReactNode
}

export interface ListAddProps {
  className?: string
  render: () => React.ReactNode
}

export interface ListProps<T> {
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
  className?: string
  children: (item: T) => React.ReactNode
  emptyMessage?: string
  loadingMessage?: string
  onKeyEvent?: (event: KeyboardEvent, item: T | undefined) => void
  onMove?: (item: T | undefined) => void
  onFilter?: (value: string) => void
  activeIcon?: React.ReactNode
  filter?: string
  search?: ListSearchProps | boolean
  itemWrapper?: (item: T, node: React.ReactNode) => React.ReactNode
  divider?: boolean
  add?: ListAddProps
  groupHeader?: (group: { category: string; items: T[] }) => React.ReactNode
}

export interface ListRef {
  onKeyDown: (e: KeyboardEvent) => void
  setScrollRef: (el: HTMLDivElement | null) => void
  setFilter: (value: string) => void
}

interface ListComponentProps<T> extends ListProps<T> {
  ref?: React.Ref<ListRef>
}

function defaultFilter<T>(items: T[], query: string, filterKeys?: string[]): T[] {
  if (!query) return items
  const needle = query.toLowerCase()
  return items.filter((item) => {
    if (typeof item === "string") {
      return item.toLowerCase().includes(needle)
    }
    if (filterKeys && filterKeys.length > 0) {
      const obj = item as unknown as Record<string, unknown>
      return filterKeys.some((k) => {
        const v = obj[k]
        return typeof v === "string" && v.toLowerCase().includes(needle)
      })
    }
    // Fallback: stringify the object and substring match
    return String(JSON.stringify(item)).toLowerCase().includes(needle)
  })
}

function ListInner<T>(
  props: ListComponentProps<T>,
  ref: React.Ref<ListRef>,
): React.ReactElement {
  const {
    items,
    key,
    filterKeys,
    current,
    groupBy,
    sortBy,
    sortGroupsBy,
    skipFilter,
    onSelect,
    noInitialSelection,
    className,
    children,
    emptyMessage,
    loadingMessage,
    onKeyEvent,
    onMove,
    onFilter,
    activeIcon,
    filter: filterProp,
    search,
    itemWrapper,
    divider,
    add,
    groupHeader,
  } = props

  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const [mouseActive, setMouseActive] = React.useState(false)
  const [internalFilter, setInternalFilter] = React.useState("")
  const [activeKey, setActiveKey] = React.useState<string>("")
  const [groupedItems, setGroupedItems] = React.useState<
    { category: string; items: T[] }[]
  >([])
  const [loading, setLoading] = React.useState(false)

  // Resolve filter
  const filter = internalFilter

  // Resolve items (sync or async)
  React.useEffect(() => {
    let cancelled = false
    const resolveItems = async () => {
      setLoading(true)
      const raw =
        typeof items === "function"
          ? await (items as (f: string) => T[] | Promise<T[]>)(filter)
          : items
      if (cancelled) return
      const all: T[] = raw || []
      const filtered = defaultFilter<T>(all, filter, filterKeys)
      const filterable = skipFilter ? filtered.filter((i) => !skipFilter(i)) : filtered
      const skipped = skipFilter ? filtered.filter(skipFilter) : []

      const withSkipped = skipped.length ? [...filterable, ...skipped] : filterable
      const groups: Record<string, T[]> = {}
      for (const item of withSkipped) {
        const cat = groupBy ? groupBy(item) : ""
        if (!groups[cat]) groups[cat] = []
        groups[cat].push(item)
      }
      let arr = Object.entries(groups).map(([category, its]) => ({
        category,
        items: sortBy ? [...its].sort(sortBy) : its,
      }))
      if (sortGroupsBy) arr = [...arr].sort(sortGroupsBy)
      setGroupedItems(arr)
      setLoading(false)
    }
    void resolveItems()
    return () => {
      cancelled = true
    }
  }, [items, filter, filterKeys, groupBy, sortBy, sortGroupsBy, skipFilter])

  const flat: T[] = React.useMemo(
    () => groupedItems.flatMap((g) => g.items),
    [groupedItems],
  )

  // Set initial active
  const lastItemsRef = React.useRef(flat)
  React.useEffect(() => {
    lastItemsRef.current = flat
    if (noInitialSelection) {
      setActiveKey("")
      return
    }
    if (current) {
      setActiveKey(key(current))
      return
    }
    if (flat.length > 0 && (!activeKey || !flat.some((x) => key(x) === activeKey))) {
      setActiveKey(key(flat[0]))
    }
  }, [flat, current, key, noInitialSelection, activeKey])

  // Sync external filter prop
  React.useEffect(() => {
    if (filterProp === undefined) return
    if (filterProp === internalFilter) return
    setInternalFilter(filterProp)
  }, [filterProp, internalFilter])

  // Scroll to top on filter change
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [filter])

  // Scroll into view when current changes
  React.useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    if (!current) return
    const k = key(current)
    const id = requestAnimationFrame(() => {
      const element = findByKey(scroll, k)
      if (!element) return
      const containerRect = scroll.getBoundingClientRect()
      const nodeRect = element.getBoundingClientRect()
      const top = nodeRect.top - containerRect.top + scroll.scrollTop
      const target = top - scroll.clientHeight / 2 + nodeRect.height / 2
      const max = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
      scroll.scrollTop = Math.max(0, Math.min(target, max))
    })
    return () => cancelAnimationFrame(id)
  }, [current, key])

  // Notify on move
  React.useEffect(() => {
    const item = flat.find((x) => key(x) === activeKey)
    onMove?.(item)
  }, [flat, activeKey, key, onMove])

  // Scroll active into view when keyboard-driven (mouse not active)
  React.useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    if (mouseActive || flat.length === 0) return
    if (activeKey === key(flat[0])) {
      scroll.scrollTo({ top: 0 })
      return
    }
    const element = findByKey(scroll, activeKey)
    if (!element) return
    const containerRect = scroll.getBoundingClientRect()
    const nodeRect = element.getBoundingClientRect()
    const top = nodeRect.top - containerRect.top + scroll.scrollTop
    const bottom = top + nodeRect.height
    const viewTop = scroll.scrollTop
    const viewBottom = viewTop + scroll.clientHeight
    const target =
      top < viewTop
        ? top
        : bottom > viewBottom
          ? bottom - scroll.clientHeight
          : viewTop
    const max = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
    scroll.scrollTop = Math.max(0, Math.min(target, max))
  }, [activeKey, flat, mouseActive, key])

  const handleSelect = React.useCallback(
    (item: T | undefined, index: number) => {
      onSelect?.(item, index)
    },
    [onSelect],
  )

  const setFilter = React.useCallback((value: string) => {
    setInternalFilter(value)
    onFilter?.(value)
  }, [onFilter])

  const setScrollRef = React.useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el
  }, [])

  const handleKey = React.useCallback(
    (e: KeyboardEvent) => {
      setMouseActive(false)
      if (e.key === "Escape") return

      const all = flat
      const selected = all.find((x) => key(x) === activeKey)
      const index = selected ? all.indexOf(selected) : -1
      onKeyEvent?.(e, selected)

      if (e.defaultPrevented) return

      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault()
        if (selected) handleSelect(selected, index)
      } else if (search) {
        if (
          e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !e.shiftKey &&
          (e.key === "n" || e.key === "p")
        ) {
          e.preventDefault()
          const direction = e.key === "n" ? 1 : -1
          const newIdx =
            index === -1 ? (direction > 0 ? 0 : all.length - 1) : (index + direction + all.length) % all.length
          if (all[newIdx]) setActiveKey(key(all[newIdx]))
          return
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault()
          const direction = e.key === "ArrowDown" ? 1 : -1
          const newIdx =
            index === -1 ? (direction > 0 ? 0 : all.length - 1) : (index + direction + all.length) % all.length
          if (all[newIdx]) setActiveKey(key(all[newIdx]))
        }
      } else {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault()
          const direction = e.key === "ArrowDown" ? 1 : -1
          const newIdx =
            index === -1 ? (direction > 0 ? 0 : all.length - 1) : (index + direction + all.length) % all.length
          if (all[newIdx]) setActiveKey(key(all[newIdx]))
        }
      }
    },
    [flat, key, activeKey, onKeyEvent, search, handleSelect],
  )

  React.useImperativeHandle(
    ref,
    (): ListRef => ({
      onKeyDown: handleKey,
      setScrollRef,
      setFilter: (value: string) => setFilter(value),
    }),
    [handleKey, setScrollRef, setFilter],
  )

  const moved = (event: MouseEvent): boolean =>
    event.movementX !== 0 || event.movementY !== 0

  const searchProps: ListSearchProps =
    typeof search === "object" ? search : {}
  const searchAction = searchProps.action
  const showAdd = !!add

  const renderAdd = (): React.ReactNode => {
    if (!add) return null
    return (
      <div data-slot="list-item-add" className={cn(add.className)}>
        {add.render()}
      </div>
    )
  }

  const emptyMessageText = (): React.ReactNode => {
    if (loading) return loadingMessage ?? "Loading..."
    if (emptyMessage) return emptyMessage
    const query = filter
    if (!query) return "No items"
    return (
      <>
        <span>No results for </span>
        <span data-slot="list-filter">&quot;{query}&quot;</span>
      </>
    )
  }

  return (
    <div data-component="list" className={cn("flex flex-col", className)}>
      {!!search && (
        <div data-slot="list-search-wrapper" className="flex items-center gap-2 p-2">
          <div
            data-slot="list-search"
            className={cn("flex flex-1 items-center gap-2", searchProps.className)}
            onPointerDown={(event) => {
              const target = event.currentTarget
              if (!(target instanceof HTMLElement)) return
              const node = target.querySelector("input, textarea")
              const input =
                node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
                  ? node
                  : inputRef.current
              input?.focus()
              event.stopPropagation()
            }}
          >
            <div data-slot="list-search-container" className="flex flex-1 items-center gap-2 rounded-md border px-2">
              {!searchProps.hideIcon && (
                <span aria-hidden="true">
                  {/* Icon placeholder */}
                  ⌕
                </span>
              )}
              <input
                ref={inputRef}
                autoFocus={searchProps.autofocus}
                data-slot="list-search-input"
                type="text"
                value={internalFilter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => handleKey(e as unknown as KeyboardEvent)}
                placeholder={searchProps.placeholder}
                spellCheck={false}
                autoCorrect="off"
                autoComplete="off"
                autoCapitalize="off"
                className="flex-1 bg-transparent outline-none"
              />
            </div>
            {internalFilter && (
              <button
                type="button"
                onClick={() => {
                  setInternalFilter("")
                  queueMicrotask(() => inputRef.current?.focus())
                }}
                aria-label="Clear filter"
                className="rounded-md p-1 hover:bg-muted"
              >
                ×
              </button>
            )}
          </div>
          {searchAction}
        </div>
      )}
      <div
        ref={setScrollRef}
        data-slot="list-scroll"
        className="flex-1 overflow-auto"
      >
        {flat.length > 0 || showAdd ? (
          groupedItems.map((group, groupIndex) => {
            const isLastGroup = groupIndex === groupedItems.length - 1
            return (
              <div key={group.category || "_default"} data-slot="list-group" className="flex flex-col">
                {group.category && (
                  <GroupHeader
                    scrollRef={scrollRef}
                    group={group}
                    renderHeader={groupHeader}
                  />
                )}
                <div data-slot="list-items" className="flex flex-col">
                  {group.items.map((item, i) => {
                    const itemKey = key(item)
                    const isActive = itemKey === activeKey
                    const isSelected = item === current
                    const node = (
                      <button
                        key={itemKey}
                        data-slot="list-item"
                        data-key={itemKey}
                        data-active={isActive}
                        data-selected={isSelected}
                        onClick={() => handleSelect(item, i)}
                        onKeyDown={(e) => handleKey(e as unknown as KeyboardEvent)}
                        type="button"
                        onMouseMove={(event) => {
                          if (!moved(event as unknown as MouseEvent)) return
                          setMouseActive(true)
                          setActiveKey(itemKey)
                        }}
                        onMouseLeave={() => {
                          if (!mouseActive) return
                          setActiveKey("")
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                          "hover:bg-muted focus:bg-muted focus:outline-none",
                          isActive && "bg-muted",
                        )}
                      >
                        {children(item)}
                        {isSelected && (
                          <span data-slot="list-item-selected-icon" className="ml-auto">
                            ✓
                          </span>
                        )}
                        {activeIcon && (
                          <span data-slot="list-item-active-icon" className="ml-auto">
                            {activeIcon}
                          </span>
                        )}
                        {divider && (i !== group.items.length - 1 || (showAdd && isLastGroup)) && (
                          <span data-slot="list-item-divider" className="sr-only" />
                        )}
                      </button>
                    )
                    return itemWrapper ? (
                      <React.Fragment key={itemKey}>{itemWrapper(item, node)}</React.Fragment>
                    ) : (
                      node
                    )
                  })}
                  {showAdd && isLastGroup && renderAdd()}
                </div>
              </div>
            )
          })
        ) : (
          <div data-slot="list-empty-state" className="flex items-center justify-center p-8 text-sm text-muted-foreground">
            <div data-slot="list-message">{emptyMessageText()}</div>
          </div>
        )}
        {groupedItems.length === 0 && showAdd && (
          <div data-slot="list-group" className="flex flex-col">
            <div data-slot="list-items" className="flex flex-col">
              {renderAdd()}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface GroupHeaderProps<T> {
  scrollRef: React.MutableRefObject<HTMLDivElement | null>
  group: { category: string; items: T[] }
  renderHeader?: (group: { category: string; items: T[] }) => React.ReactNode
}

function GroupHeader<T>({ scrollRef, group, renderHeader }: GroupHeaderProps<T>): React.ReactElement {
  const [stuck, setStuck] = React.useState(false)
  const headerRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const scroll = scrollRef.current
    const node = headerRef.current
    if (!scroll || !node) return

    const handler = () => {
      const rect = node.getBoundingClientRect()
      const scrollRect = scroll.getBoundingClientRect()
      setStuck(rect.top <= scrollRect.top + 1 && scroll.scrollTop > 0)
    }

    handler()
    scroll.addEventListener("scroll", handler, { passive: true })
    return () => scroll.removeEventListener("scroll", handler)
  }, [scrollRef])

  return (
    <div
      ref={headerRef}
      data-slot="list-header"
      data-stuck={stuck}
      className="sticky top-0 bg-background px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
    >
      {renderHeader?.(group) ?? group.category}
    </div>
  )
}

// Use a generic component via a function wrapper to preserve the type parameter.
export const List = React.forwardRef(ListInner) as unknown as <T>(
  props: ListComponentProps<T> & { ref?: React.Ref<ListRef> },
) => React.ReactElement