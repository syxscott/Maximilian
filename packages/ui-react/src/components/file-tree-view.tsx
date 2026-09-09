import * as React from "react"
import { ChevronRight, File, Folder, FolderOpen } from "lucide-react"
import { cn } from "../lib/utils.js"

export type FileTreeNodeKind = "file" | "directory"

export interface FileTreeNode {
  /** Stable id used for keys and selection. Defaults to path. */
  id?: string
  name: string
  path: string
  kind: FileTreeNodeKind
  children?: FileTreeNode[]
  /** Optional metadata (e.g. kind: "add" | "del" | "mod" for diffs). */
  meta?: { added?: number; deleted?: number; modified?: number }
}

export interface FileTreeViewProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  nodes: FileTreeNode[]
  /** Currently selected path. */
  value?: string
  defaultExpanded?: string[]
  onSelect?: (node: FileTreeNode) => void
  /** Render a custom node label, useful for diff badges. */
  renderLabel?: (node: FileTreeNode) => React.ReactNode
}

interface FlatRow {
  node: FileTreeNode
  depth: number
  expanded: boolean
  hasChildren: boolean
}

function flatten(
  nodes: FileTreeNode[],
  expanded: Set<string>,
  depth: number,
  out: FlatRow[],
): FlatRow[] {
  for (const node of nodes) {
    const hasChildren = !!node.children?.length
    const isExpanded = hasChildren && expanded.has(node.path)
    out.push({ node, depth, expanded: isExpanded, hasChildren })
    if (isExpanded && node.children) {
      flatten(node.children, expanded, depth + 1, out)
    }
  }
  return out
}

const FileTreeViewRow = React.memo(function FileTreeViewRow({
  row,
  selected,
  onToggle,
  onSelect,
  renderLabel,
}: {
  row: FlatRow
  selected: boolean
  onToggle: (path: string) => void
  onSelect: (node: FileTreeNode) => void
  renderLabel?: (node: FileTreeNode) => React.ReactNode
}) {
  const { node, depth, expanded, hasChildren } = row
  const indent = { paddingLeft: `${depth * 12 + 8}px` }

  return (
    <div
      data-slot="file-tree-row"
      data-kind={node.kind}
      data-path={node.path}
      data-selected={selected ? true : undefined}
      className={cn(
        "flex cursor-pointer items-center gap-1 rounded-sm py-1 pr-2 text-sm hover:bg-muted/60",
        selected && "bg-muted text-foreground",
      )}
      style={indent}
      onClick={() => {
        if (hasChildren) onToggle(node.path)
        onSelect(node)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          if (hasChildren) onToggle(node.path)
          onSelect(node)
        }
      }}
      role="treeitem"
      tabIndex={0}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={selected}
    >
      <span
        className={cn(
          "inline-flex h-4 w-4 items-center justify-center text-muted-foreground transition-transform",
          hasChildren && expanded && "rotate-90",
          !hasChildren && "opacity-0",
        )}
        aria-hidden="true"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </span>
      <span className="text-muted-foreground" aria-hidden="true">
        {node.kind === "directory" ? (
          expanded ? (
            <FolderOpen className="h-4 w-4" />
          ) : (
            <Folder className="h-4 w-4" />
          )
        ) : (
          <File className="h-4 w-4" />
        )}
      </span>
      <span className="truncate">
        {renderLabel ? renderLabel(node) : node.name}
      </span>
      {node.meta ? (
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          {node.meta.added ? <span className="text-green-600">+{node.meta.added}</span> : null}
          {node.meta.deleted ? <span className="text-red-600">-{node.meta.deleted}</span> : null}
        </span>
      ) : null}
    </div>
  )
})

export const FileTreeView = React.forwardRef<HTMLDivElement, FileTreeViewProps>(
  function FileTreeView(
    { nodes, value, defaultExpanded, onSelect, renderLabel, className, ...rest },
    ref,
  ) {
    const [internalExpanded, setInternalExpanded] = React.useState<Set<string>>(
      () => new Set(defaultExpanded ?? []),
    )
    const expanded = internalExpanded

    const handleToggle = React.useCallback((path: string) => {
      setInternalExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        return next
      })
    }, [])

    const handleSelect = React.useCallback(
      (node: FileTreeNode) => {
        onSelect?.(node)
      },
      [onSelect],
    )

    const rows = React.useMemo<FlatRow[]>(
      () => flatten(nodes, expanded, 0, []),
      [nodes, expanded],
    )

    return (
      <div
        ref={ref}
        data-component="file-tree-view"
        role="tree"
        className={cn("flex flex-col gap-0.5 text-foreground", className)}
        {...rest}
      >
        {rows.map((row) => (
          <FileTreeViewRow
            key={row.node.id ?? row.node.path}
            row={row}
            selected={value === row.node.path}
            onToggle={handleToggle}
            onSelect={handleSelect}
            renderLabel={renderLabel}
          />
        ))}
      </div>
    )
  },
)
