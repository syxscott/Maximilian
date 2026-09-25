import * as React from "react"
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"
import { cn } from "../lib/utils.js"

export type SortDirection = "asc" | "desc"

export interface DataGridSort {
  key: string
  direction: SortDirection
}

export interface DataGridColumn<T> {
  /** Unique column id. Matches the sort key. */
  key: string
  header: React.ReactNode
  sortable?: boolean
  align?: "left" | "center" | "right"
  width?: string | number
  /** Extract a comparable cell value for default rendering and sorting. */
  value?: (row: T, index: number) => string | number
  /** Custom cell renderer. Overrides the value extraction. */
  render?: (row: T, index: number) => React.ReactNode
}

export interface DataGridLabels<T> {
  /** Accessible label for the select-all checkbox. */
  selectAll?: string
  /** Accessible label factory for per-row checkboxes. */
  selectRow?: (row: T, index: number) => string
}

export interface DataGridProps<T> {
  columns: Array<DataGridColumn<T>>
  rows: T[]
  /** Stable row identity, used as the selection key. Defaults to the row index. */
  rowKey?: (row: T, index: number) => string
  /** Controlled sort state. `null` means "no sort applied". */
  sort?: DataGridSort | null
  defaultSort?: DataGridSort | null
  onSortChange?: (sort: DataGridSort | null) => void
  selectable?: boolean
  /** Controlled selection keys. */
  selectedRowKeys?: string[]
  defaultSelectedRowKeys?: string[]
  onSelectedRowKeysChange?: (keys: string[]) => void
  onRowClick?: (row: T, index: number) => void
  labels?: DataGridLabels<T>
  /** Rendered inside the single body row when there is nothing to show. */
  emptyState?: React.ReactNode
  className?: string
}

/**
 * Cycle a sort state for one column key: none -> asc -> desc -> none.
 */
export function nextSort(current: DataGridSort | null, key: string): DataGridSort | null {
  if (!current || current.key !== key) return { key, direction: "asc" }
  if (current.direction === "asc") return { key, direction: "desc" }
  return null
}

/**
 * Pure row sort by a column's `value` extractor. Numbers compare numerically,
 * everything else via `localeCompare`; rows are copied, never mutated.
 */
export function sortRows<T>(
  rows: T[],
  columns: Array<DataGridColumn<T>>,
  sort: DataGridSort | null,
): T[] {
  if (!sort) return [...rows]
  const column = columns.find((c) => c.key === sort.key)
  const extract = column?.value
  if (!extract) return [...rows]
  const factor = sort.direction === "asc" ? 1 : -1
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const av = extract(a.row, a.index)
      const bv = extract(b.row, b.index)
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor
      return String(av).localeCompare(String(bv)) * factor
    })
    .map((entry) => entry.row)
}

function alignClass(align: DataGridColumn<unknown>["align"]): string {
  if (align === "center") return "text-center"
  if (align === "right") return "text-right"
  return "text-left"
}

function renderCellValue(value: string | number | undefined): React.ReactNode {
  if (value === undefined) return null
  return value
}

export function DataGrid<T>(props: DataGridProps<T>) {
  const {
    columns,
    rows,
    rowKey,
    sort,
    defaultSort = null,
    onSortChange,
    selectable,
    selectedRowKeys,
    defaultSelectedRowKeys = [],
    onSelectedRowKeysChange,
    onRowClick,
    labels,
    emptyState,
    className,
  } = props

  const isSortControlled = sort !== undefined
  const [internalSort, setInternalSort] = React.useState<DataGridSort | null>(defaultSort)
  const activeSort = isSortControlled ? sort : internalSort

  const isSelectionControlled = selectedRowKeys !== undefined
  const [internalSelection, setInternalSelection] = React.useState<string[]>(defaultSelectedRowKeys)
  const selection = isSelectionControlled ? selectedRowKeys : internalSelection

  const keyOf = React.useCallback(
    (row: T, index: number) => rowKey?.(row, index) ?? String(index),
    [rowKey],
  )

  const applySort = (column: DataGridColumn<T>) => {
    const next = nextSort(activeSort, column.key)
    if (!isSortControlled) setInternalSort(next)
    onSortChange?.(next)
  }

  const setSelection = (keys: string[]) => {
    if (!isSelectionControlled) setInternalSelection(keys)
    onSelectedRowKeysChange?.(keys)
  }

  const toggleRow = (key: string) => {
    setSelection(selection.includes(key) ? selection.filter((k) => k !== key) : [...selection, key])
  }

  const allKeys = rows.map((row, index) => keyOf(row, index))
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selection.includes(k))
  const someSelected = allKeys.some((k) => selection.includes(k)) && !allSelected

  const selectAllRef = React.useCallback(
    (node: HTMLInputElement | null) => {
      if (node) node.indeterminate = someSelected
    },
    [someSelected],
  )

  const toggleAll = () => {
    setSelection(allSelected ? [] : allKeys)
  }

  const colSpan = columns.length + (selectable ? 1 : 0)

  return (
    <div data-component="data-grid" className={cn("w-full overflow-auto", className)}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {selectable && (
              <th className="w-10 px-2 py-2">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label={labels?.selectAll ?? "Select all"}
                  checked={allSelected}
                  onChange={toggleAll}
                />
              </th>
            )}
            {columns.map((column) => {
              const active = activeSort?.key === column.key
              return (
                <th
                  key={column.key}
                  style={column.width !== undefined ? { width: column.width } : undefined}
                  className={cn(
                    "px-3 py-2 font-medium text-muted-foreground",
                    alignClass(column.align),
                  )}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      data-slot="data-grid-sort"
                      data-key={column.key}
                      data-active={active || undefined}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => applySort(column)}
                    >
                      {column.header}
                      {active ? (
                        activeSort.direction === "asc" ? (
                          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sortRows(rows, columns, activeSort).map((row, index) => {
            const key = keyOf(row, index)
            const selected = selection.includes(key)
            return (
              <tr
                key={key}
                data-slot="data-grid-row"
                data-selected={selected || undefined}
                aria-selected={selectable ? selected : undefined}
                className={cn(
                  "border-b border-border/60",
                  onRowClick && "cursor-pointer hover:bg-muted/50",
                )}
                onClick={onRowClick ? () => onRowClick(row, index) : undefined}
              >
                {selectable && (
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label={labels?.selectRow?.(row, index) ?? "Select row"}
                      checked={selected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleRow(key)}
                    />
                  </td>
                )}
                {columns.map((column) => (
                  <td key={column.key} className={cn("px-3 py-2", alignClass(column.align))}>
                    {column.render
                      ? column.render(row, index)
                      : renderCellValue(column.value?.(row, index))}
                  </td>
                ))}
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="px-3 py-8 text-center text-muted-foreground">
                {emptyState ?? null}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
