import * as React from "react"
import { cn } from "../lib/utils"

export interface DiffLine {
  type: "add" | "del" | "context" | "hunk" | "info"
  oldNumber?: number
  newNumber?: number
  content: string
}

export interface DiffViewerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Pre-computed diff lines. Caller is responsible for producing them. */
  lines: DiffLine[]
  /** "unified" (single column) or "split" (two columns: old / new). */
  mode?: "unified" | "split"
  /** Filename or context shown in the header. */
  caption?: string
}

function lineClass(type: DiffLine["type"]) {
  switch (type) {
    case "add":
      return "bg-green-500/10 text-green-700 dark:text-green-300"
    case "del":
      return "bg-red-500/10 text-red-700 dark:text-red-300"
    case "hunk":
      return "bg-blue-500/10 text-blue-700 dark:text-blue-300 italic"
    case "info":
      return "bg-muted text-muted-foreground italic"
    default:
      return ""
  }
}

function linePrefix(type: DiffLine["type"]) {
  switch (type) {
    case "add":
      return "+"
    case "del":
      return "-"
    case "hunk":
    case "info":
      return ""
    default:
      return " "
  }
}

const LineRow = React.forwardRef<HTMLDivElement, { line: DiffLine; side?: "old" | "new" }>(
  function LineRow({ line, side }, ref) {
    const showOld = side === "old"
    const showNew = side === "new" || !side
    return (
      <div
        ref={ref}
        data-slot="diff-line"
        data-type={line.type}
        className={cn("grid grid-cols-[3.5rem_3.5rem_1fr] font-mono text-xs leading-5", lineClass(line.type))}
      >
        <div className="select-none px-2 text-right text-muted-foreground/70">
          {showOld ? line.oldNumber ?? "" : ""}
        </div>
        <div className="select-none px-2 text-right text-muted-foreground/70">
          {showNew ? line.newNumber ?? "" : ""}
        </div>
        <pre className="m-0 whitespace-pre-wrap break-words pl-2 pr-3">
          <span aria-hidden="true" className="select-none pr-1 opacity-70">
            {linePrefix(line.type)}
          </span>
          {line.content || " "}
        </pre>
      </div>
    )
  },
)

export const DiffViewer = React.forwardRef<HTMLDivElement, DiffViewerProps>(function DiffViewer(
  { lines, mode = "unified", caption, className, ...rest },
  ref,
) {
  if (mode === "split") {
    return (
      <div
        ref={ref}
        data-component="diff-viewer"
        data-mode="split"
        className={cn(
          "overflow-hidden rounded-md border border-border bg-background text-foreground",
          className,
        )}
        {...rest}
      >
        {caption ? (
          <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-medium">
            {caption}
          </div>
        ) : null}
        <div className="grid grid-cols-2 divide-x divide-border">
          <div data-slot="diff-split-old">
            {lines.map((line, i) => (
              <LineRow key={`old-${i}`} line={{ ...line, type: line.type === "add" ? "context" : line.type }} side="old" />
            ))}
          </div>
          <div data-slot="diff-split-new">
            {lines.map((line, i) => (
              <LineRow key={`new-${i}`} line={{ ...line, type: line.type === "del" ? "context" : line.type }} side="new" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      data-component="diff-viewer"
      data-mode="unified"
      className={cn(
        "overflow-hidden rounded-md border border-border bg-background text-foreground",
        className,
      )}
      {...rest}
    >
      {caption ? (
        <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-medium">
          {caption}
        </div>
      ) : null}
      <div data-slot="diff-unified">
        {lines.map((line, i) => (
          <LineRow key={i} line={line} />
        ))}
      </div>
    </div>
  )
})
