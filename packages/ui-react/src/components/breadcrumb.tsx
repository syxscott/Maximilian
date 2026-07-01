import * as React from "react"
import { ChevronRight, MoreHorizontal } from "lucide-react"
import { cn } from "../lib/utils"

export interface BreadcrumbItem {
  label: React.ReactNode
  href?: string
  onClick?: () => void
  /** Render the entire item node (overrides label). */
  node?: React.ReactNode
}

export interface BreadcrumbProps extends React.HTMLAttributes<HTMLElement> {
  items: BreadcrumbItem[]
  /** Separator node. Defaults to ChevronRight. */
  separator?: React.ReactNode
  /** When the list is long, collapse the middle and show an ellipsis. */
  maxItems?: number
}

function defaultSeparator() {
  return (
    <span aria-hidden="true" className="text-muted-foreground/60">
      <ChevronRight className="h-3.5 w-3.5" />
    </span>
  )
}

function BreadcrumbItemEl({
  item,
  isLast,
  separator,
}: {
  item: BreadcrumbItem
  isLast: boolean
  separator: React.ReactNode
}) {
  if (item.node) return <>{item.node}</>

  const base =
    "inline-flex items-center text-sm transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
  const className = cn(
    isLast ? "text-foreground font-medium" : "text-muted-foreground",
    base,
  )

  if (item.href && !item.onClick) {
    return (
      <>
        <a href={item.href} className={className}>
          {item.label}
        </a>
        {isLast ? null : separator}
      </>
    )
  }

  if (item.onClick) {
    return (
      <>
        <button type="button" onClick={item.onClick} className={className}>
          {item.label}
        </button>
        {isLast ? null : separator}
      </>
    )
  }

  return (
    <>
      <span className={className}>{item.label}</span>
      {isLast ? null : separator}
    </>
  )
}

export const Breadcrumb = React.forwardRef<HTMLElement, BreadcrumbProps>(function Breadcrumb(
  { items, separator = defaultSeparator(), maxItems, className, ...rest },
  ref,
) {
  const visible = React.useMemo(() => {
    if (!maxItems || items.length <= maxItems) return { head: items, collapsed: [] as BreadcrumbItem[] }
    if (maxItems < 2) return { head: items.slice(-1), collapsed: items.slice(0, -1) }

    const headCount = Math.max(1, maxItems - 2)
    const head = items.slice(0, headCount)
    const tail = items.slice(-1)
    const collapsed = items.slice(headCount, -1)
    return { head: [...head, { label: <MoreHorizontal className="h-4 w-4" /> }, ...tail], collapsed }
  }, [items, maxItems])

  return (
    <nav
      ref={ref}
      data-component="breadcrumb"
      aria-label="Breadcrumb"
      className={cn("flex items-center gap-1.5", className)}
      {...rest}
    >
      <ol className="flex flex-wrap items-center gap-1.5">
        {visible.head.map((item, i) => {
          const isLast = i === visible.head.length - 1
          return (
            <li key={i} className="flex items-center gap-1.5">
              <BreadcrumbItemEl item={item} isLast={isLast} separator={separator} />
            </li>
          )
        })}
      </ol>
    </nav>
  )
})
