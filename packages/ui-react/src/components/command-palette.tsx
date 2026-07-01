import * as React from "react"
import { Dialog, DialogContent } from "./dialog"
import { Search } from "lucide-react"
import { cn } from "../lib/utils"

/**
 * Lightweight command palette.
 *
 * Designed to be `cmdk`-compatible at the API level. If `cmdk` is added as
 * a dependency, swap in the real primitives. Until then we provide a small
 * built-in implementation that supports the most-used features: query,
 * grouped items, keyboard navigation, onSelect, empty/loading state.
 */

export interface CommandItem {
  id: string
  label: React.ReactNode
  /** Optional sub-label or hint. */
  description?: React.ReactNode
  /** Group id; items with the same group are rendered together. */
  group?: string
  /** Optional icon. */
  icon?: React.ReactNode
  /** Disable the item. */
  disabled?: boolean
  /** Optional keybinding hint shown on the right. */
  shortcut?: string
  keywords?: string[]
  onSelect?: () => void
}

export interface CommandGroup {
  id: string
  heading?: React.ReactNode
  items: CommandItem[]
}

export interface CommandPaletteProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Static list of groups, or a function returning them. */
  groups: CommandGroup[] | (() => CommandGroup[]) | (() => Promise<CommandGroup[]>)
  /** Optional placeholder for the search input. */
  placeholder?: string
  /** Empty-state node. */
  emptyState?: React.ReactNode
  /** When true, the palette shows a loading indicator. */
  loading?: boolean
  /** When set, the palette is opened via Cmd/Ctrl+K. */
  enableGlobalShortcut?: boolean
  size?: "normal" | "large" | "x-large"
  className?: string
}

function flattenGroups(groups: CommandGroup[]): CommandItem[] {
  const out: CommandItem[] = []
  for (const g of groups) out.push(...g.items)
  return out
}

function matchItem(item: CommandItem, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const haystacks: string[] = []
  if (typeof item.label === "string") haystacks.push(item.label.toLowerCase())
  if (typeof item.description === "string") haystacks.push(item.description.toLowerCase())
  if (item.keywords) haystacks.push(...item.keywords.map((k) => k.toLowerCase()))
  return haystacks.some((h) => h.includes(q))
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  defaultOpen,
  onOpenChange,
  groups: groupsInput,
  placeholder = "Type a command or search...",
  emptyState = "No results found.",
  loading,
  enableGlobalShortcut = true,
  size = "normal",
  className,
}) => {
  const isControlled = open !== undefined
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false)
  const currentOpen = isControlled ? open : internalOpen

  const [query, setQuery] = React.useState("")
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [resolvedGroups, setResolvedGroups] = React.useState<CommandGroup[]>([])
  const [internalLoading, setInternalLoading] = React.useState(false)

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next)
      onOpenChange?.(next)
      if (!next) setQuery("")
    },
    [isControlled, onOpenChange],
  )

  // Resolve groups (sync or async).
  React.useEffect(() => {
    let cancelled = false
    if (typeof groupsInput === "function") {
      const result = groupsInput()
      if (result && typeof (result as Promise<CommandGroup[]>).then === "function") {
        setInternalLoading(true)
        ;(result as Promise<CommandGroup[]>)
          .then((g) => {
            if (!cancelled) setResolvedGroups(g)
          })
          .finally(() => {
            if (!cancelled) setInternalLoading(false)
          })
      } else {
        setResolvedGroups(result as CommandGroup[])
      }
    } else {
      setResolvedGroups(groupsInput)
    }
    return () => {
      cancelled = true
    }
  }, [groupsInput])

  // Filtered groups.
  const filtered = React.useMemo<CommandGroup[]>(() => {
    if (!query) return resolvedGroups
    return resolvedGroups
      .map((g) => ({ ...g, items: g.items.filter((item) => matchItem(item, query)) }))
      .filter((g) => g.items.length > 0)
  }, [resolvedGroups, query])

  const flat = React.useMemo(() => flattenGroups(filtered), [filtered])
  const isLoading = loading ?? internalLoading

  // Reset active index when filtered list changes.
  React.useEffect(() => {
    setActiveIndex(0)
  }, [query, resolvedGroups])

  // Global keyboard shortcut: Cmd/Ctrl + K.
  React.useEffect(() => {
    if (!enableGlobalShortcut) return
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault()
        setOpen(!currentOpen)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [currentOpen, setOpen, enableGlobalShortcut])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex((i) => {
        if (flat.length === 0) return 0
        for (let step = 1; step <= flat.length; step++) {
          const next = (i + step) % flat.length
          if (!flat[next]?.disabled) return next
        }
        return i
      })
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((i) => {
        if (flat.length === 0) return 0
        for (let step = 1; step <= flat.length; step++) {
          const next = (i - step + flat.length) % flat.length
          if (!flat[next]?.disabled) return next
        }
        return i
      })
    } else if (e.key === "Enter") {
      e.preventDefault()
      const item = flat[activeIndex]
      if (item && !item.disabled) {
        item.onSelect?.()
        setOpen(false)
      }
    } else if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
    }
  }

  let flatIndex = 0

  return (
    <Dialog open={currentOpen} onOpenChange={setOpen}>
      <DialogContent
        size={size}
        className={cn("p-0 sm:max-w-xl", className)}
        title={null}
        description={null}
        action={null}
      >
        <div data-component="command-palette" className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-listbox"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="h-11 w-full border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            {isLoading ? (
              <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
                aria-hidden="true"
              />
            ) : null}
          </div>
          <div
            id="command-palette-listbox"
            role="listbox"
            className="max-h-[60vh] overflow-y-auto p-1"
          >
            {flat.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {emptyState}
              </div>
            ) : (
              filtered.map((group) => (
                <div key={group.id} role="group" aria-label={typeof group.heading === "string" ? group.heading : group.id}>
                  {group.heading ? (
                    <div className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {group.heading}
                    </div>
                  ) : null}
                  {group.items.map((item) => {
                    const itemIndex = flatIndex
                    flatIndex += 1
                    const isActive = itemIndex === activeIndex
                    return (
                      <div
                        key={item.id}
                        role="option"
                        aria-selected={isActive}
                        aria-disabled={item.disabled}
                        data-active={isActive ? true : undefined}
                        onMouseEnter={() => setActiveIndex(itemIndex)}
                        onClick={() => {
                          if (item.disabled) return
                          item.onSelect?.()
                          setOpen(false)
                        }}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground",
                          isActive && "bg-accent text-accent-foreground",
                          item.disabled && "pointer-events-none opacity-50",
                        )}
                      >
                        {item.icon ? (
                          <span aria-hidden="true" className="text-muted-foreground">
                            {item.icon}
                          </span>
                        ) : null}
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.description ? (
                          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                            {item.description}
                          </span>
                        ) : null}
                        {item.shortcut ? (
                          <kbd className="ml-auto rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                            {item.shortcut}
                          </kbd>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <span>
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono">↑↓</kbd> navigate
              <span className="mx-1">·</span>
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono">↵</kbd> select
            </span>
            <span>
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono">esc</kbd> close
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
