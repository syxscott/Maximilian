import * as React from "react"
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MoreHorizontal } from "lucide-react"
import { cn } from "../lib/utils.js"

export interface PaginationProps extends Omit<React.HTMLAttributes<HTMLElement>, "onChange"> {
  page: number
  pageSize: number
  /** Total number of items. */
  total: number
  /** Visible page buttons around the current page (default 1). */
  siblingCount?: number
  onPageChange?: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
  showPageSize?: boolean
}

function range(start: number, end: number): number[] {
  const out: number[] = []
  for (let i = start; i <= end; i++) out.push(i)
  return out
}

function buildPageList(current: number, totalPages: number, siblingCount: number): (number | "ellipsis")[] {
  const totalNumbers = siblingCount * 2 + 5 // first, last, current, 2*ellipsis
  if (totalPages <= totalNumbers) return range(1, totalPages)

  const left = Math.max(current - siblingCount, 1)
  const right = Math.min(current + siblingCount, totalPages)

  const showLeftEllipsis = left > 2
  const showRightEllipsis = right < totalPages - 1

  if (!showLeftEllipsis && showRightEllipsis) {
    return [...range(1, 3 + 2 * siblingCount), "ellipsis", totalPages]
  }
  if (showLeftEllipsis && !showRightEllipsis) {
    return [1, "ellipsis", ...range(totalPages - (3 + 2 * siblingCount), totalPages)]
  }
  return [1, "ellipsis", ...range(left, right), "ellipsis", totalPages]
}

const PaginationButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
>(function PaginationButton({ active, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-8 min-w-[2rem] items-center justify-center rounded-md border border-border bg-background px-2 text-sm transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        active && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})

export const Pagination = React.forwardRef<HTMLElement, PaginationProps>(function Pagination(
  {
    page,
    pageSize,
    total,
    siblingCount = 1,
    onPageChange,
    onPageSizeChange,
    pageSizeOptions = [10, 25, 50, 100],
    showPageSize = true,
    className,
    ...rest
  },
  ref,
) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const pages = React.useMemo(
    () => buildPageList(safePage, totalPages, siblingCount),
    [safePage, totalPages, siblingCount],
  )

  const go = (next: number) => {
    if (next < 1 || next > totalPages || next === safePage) return
    onPageChange?.(next)
  }

  return (
    <nav
      ref={ref}
      data-component="pagination"
      aria-label="Pagination"
      className={cn("flex flex-wrap items-center justify-between gap-3 text-sm", className)}
      {...rest}
    >
      <div className="text-muted-foreground">
        Page {safePage} of {totalPages}
      </div>
      <div className="flex items-center gap-1">
        <PaginationButton aria-label="First page" disabled={safePage === 1} onClick={() => go(1)}>
          <ChevronsLeft className="h-4 w-4" />
        </PaginationButton>
        <PaginationButton aria-label="Previous page" disabled={safePage === 1} onClick={() => go(safePage - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </PaginationButton>
        {pages.map((p, i) =>
          p === "ellipsis" ? (
            <span
              key={`e-${i}`}
              aria-hidden="true"
              className="inline-flex h-8 min-w-[2rem] items-center justify-center text-muted-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
            </span>
          ) : (
            <PaginationButton
              key={p}
              active={p === safePage}
              onClick={() => go(p)}
              aria-label={`Go to page ${p}`}
            >
              {p}
            </PaginationButton>
          ),
        )}
        <PaginationButton
          aria-label="Next page"
          disabled={safePage === totalPages}
          onClick={() => go(safePage + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </PaginationButton>
        <PaginationButton
          aria-label="Last page"
          disabled={safePage === totalPages}
          onClick={() => go(totalPages)}
        >
          <ChevronsRight className="h-4 w-4" />
        </PaginationButton>
      </div>
      {showPageSize && onPageSizeChange ? (
        <label className="flex items-center gap-2 text-muted-foreground">
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </nav>
  )
})
