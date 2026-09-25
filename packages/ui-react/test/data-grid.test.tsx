import { afterEach, describe, expect, it, vi } from "vitest"
import * as React from "react"
import { DataGrid, nextSort, sortRows, type DataGridColumn } from "../src/index.js"
import { cleanup, click, renderUI } from "./helpers.js"

afterEach(cleanup)

interface Row {
  id: string
  name: string
  age: number
}

const columns: Array<DataGridColumn<Row>> = [
  { key: "name", header: "Name", sortable: true, value: (row) => row.name },
  { key: "age", header: "Age", sortable: true, value: (row) => row.age },
]

const rows: Row[] = [
  { id: "1", name: "cody", age: 3 },
  { id: "2", name: "alice", age: 2 },
  { id: "3", name: "bob", age: 1 },
]

describe("DataGrid pure helpers", () => {
  it("cycles the sort state asc -> desc -> none", () => {
    expect(nextSort(null, "age")).toEqual({ key: "age", direction: "asc" })
    expect(nextSort({ key: "age", direction: "asc" }, "age")).toEqual({
      key: "age",
      direction: "desc",
    })
    expect(nextSort({ key: "age", direction: "desc" }, "age")).toBeNull()
    expect(nextSort({ key: "name", direction: "asc" }, "age")).toEqual({
      key: "age",
      direction: "asc",
    })
  })

  it("sorts rows in both directions without mutating the input", () => {
    const before = rows.map((row) => row.age)
    expect(sortRows(rows, columns, { key: "age", direction: "asc" }).map((r) => r.age)).toEqual([
      1, 2, 3,
    ])
    expect(sortRows(rows, columns, { key: "age", direction: "desc" }).map((r) => r.age)).toEqual([
      3, 2, 1,
    ])
    expect(rows.map((row) => row.age)).toEqual(before)
    expect(sortRows(rows, columns, null)).toEqual(rows)
  })
})

describe("DataGrid", () => {
  it("renders headers, rows and cell values", () => {
    const { container } = renderUI(
      <DataGrid columns={columns} rows={rows} rowKey={(row) => row.id} />,
    )
    expect(container.querySelectorAll('[data-slot="data-grid-row"]').length).toBe(3)
    expect(container.querySelector("tbody")?.textContent).toContain("alice")
  })

  it("sorts through the header buttons (controlled)", () => {
    const onSortChange = vi.fn()
    const sorted = sortRows(rows, columns, { key: "age", direction: "asc" })
    const { container } = renderUI(
      <DataGrid
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        sort={{ key: "age", direction: "asc" }}
        onSortChange={onSortChange}
      />,
    )
    expect(container.querySelector('[data-slot="data-grid-row"]')?.textContent).toContain(
      sorted[0].name,
    )
    const header = container.querySelector<HTMLButtonElement>(
      '[data-slot="data-grid-sort"][data-key="name"]',
    )
    expect(header).not.toBeNull()
    if (header) click(header)
    expect(onSortChange).toHaveBeenCalledWith({ key: "name", direction: "asc" })
  })

  it("toggles row selection through checkboxes", () => {
    const onSelectedRowKeysChange = vi.fn()
    const { container } = renderUI(
      <DataGrid
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        selectable
        selectedRowKeys={[]}
        onSelectedRowKeysChange={onSelectedRowKeysChange}
      />,
    )
    const checkboxes = container.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')
    expect(checkboxes.length).toBe(3)
    click(checkboxes[1])
    expect(onSelectedRowKeysChange).toHaveBeenCalledWith(["2"])
  })

  it("renders the empty state when there are no rows", () => {
    const { container } = renderUI(
      <DataGrid columns={columns} rows={[]} emptyState={<span>No rows here</span>} />,
    )
    expect(container.querySelectorAll('[data-slot="data-grid-row"]').length).toBe(0)
    expect(container.textContent).toContain("No rows here")
  })
})
