// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * TableBlock — simple data table (ZCode table borrowing): defensive
 * normalization of object / array / scalar rows, columns bounded and
 * rows capped at 10 with an overflow footer.
 */
import { useLocale, t, formatNumber } from "@max/i18n"
import { cn } from "@/lib/utils"
import { tableBlockModel } from "./model"

export interface TableBlockProps {
  /** Passthrough { columns, rows } / array-of-objects / array-of-arrays. */
  table: unknown
  maxRows?: number
  className?: string
}

export function TableBlock({ table, maxRows = 10, className }: TableBlockProps) {
  useLocale()
  const { columns, rows, totalRows, truncated } = tableBlockModel(table, maxRows)

  return (
    <div
      aria-label={t("aiElements.table.aria")}
      className={cn(
        "rounded-md border border-border bg-muted/20 text-xs overflow-hidden",
        className,
      )}
    >
      {rows.length === 0 ? (
        <div className="px-3 py-2 text-muted-foreground italic">{t("aiElements.table.empty")}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            {columns.length > 0 && (
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {columns.map((column, i) => (
                    <th
                      key={i}
                      scope="col"
                      className="px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-border/40 last:border-b-0">
                  {row.map((cell, j) => (
                    <td key={j} className="px-3 py-1 max-w-48 truncate" title={cell}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {truncated && (
        <footer className="px-3 py-1 border-t border-border/60 text-[10px] text-muted-foreground tabular-nums">
          {t("aiElements.table.moreRows", {
            count: formatNumber(totalRows - rows.length),
            total: formatNumber(totalRows),
          })}
        </footer>
      )}
    </div>
  )
}
