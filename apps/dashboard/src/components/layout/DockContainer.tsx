// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * DockContainer — renders the dock model tree with plain flexbox:
 * splits become rows/columns sized by percentage, leaves become
 * DockPanel shells whose contents come from the consumer's renderPanel.
 * The dividers between split children are draggable via pointer events
 * (window-level move/up listeners, ratio math in dockModel) — no
 * dependencies, no measurement hacks. A maximized panel renders alone.
 */
import { useCallback, useEffect, useRef } from "react"
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react"
import { t } from "@max/i18n"
import { cn } from "@/lib/utils"
import {
  type DockDirection,
  type DockLeaf,
  type DockNode,
  type DockSplit,
  findLeaf,
  ratioFromPointer,
} from "@/components/layout/dockModel"
import { useDockLayoutStore } from "@/components/layout/useDockLayout"
import { DockPanel } from "@/components/layout/DockPanel"

/** Divider thickness in px — subtracted once from the split's free space. */
const SPLITTER_PX = 6

export interface DockContainerProps {
  /** Content factory — the consumer maps a panel id to its contents. */
  renderPanel: (panelId: string) => ReactNode
  className?: string
}

interface NodeViewProps {
  node: DockNode
  activeId: string | null
  maximizedId: string | null
  renderPanel: (panelId: string) => ReactNode
  onClose: (id: string) => void
  onToggleMaximize: (id: string) => void
  onFocus: (id: string) => void
}

function LeafView({
  leaf,
  active,
  maximized,
  renderPanel,
  onClose,
  onToggleMaximize,
  onFocus,
}: {
  leaf: DockLeaf
  active: boolean
  maximized: boolean
  renderPanel: (panelId: string) => ReactNode
  onClose: (id: string) => void
  onToggleMaximize: (id: string) => void
  onFocus: (id: string) => void
}) {
  return (
    <DockPanel
      id={leaf.id}
      titleKey={leaf.titleKey}
      active={active}
      maximized={maximized}
      onClose={onClose}
      onToggleMaximize={onToggleMaximize}
      onFocus={onFocus}
    >
      {renderPanel(leaf.id)}
    </DockPanel>
  )
}

function NodeView({ node, ...rest }: NodeViewProps) {
  if (node.kind === "leaf") {
    return (
      <LeafView
        leaf={node}
        active={rest.activeId === node.id}
        maximized={rest.maximizedId === node.id}
        renderPanel={rest.renderPanel}
        onClose={rest.onClose}
        onToggleMaximize={rest.onToggleMaximize}
        onFocus={rest.onFocus}
      />
    )
  }
  return <SplitView node={node} {...rest} />
}

/**
 * Child styles: children[0] takes ratio% of (area − divider) along the
 * split's main axis, children[1] takes the rest. flex-basis follows the
 * main axis, so the same styles serve rows and columns.
 */
function childStyles(ratio: number): [CSSProperties, CSSProperties] {
  const first: CSSProperties = {
    flex: `0 0 calc((100% - ${SPLITTER_PX}px) * ${ratio})`,
    minWidth: 0,
    minHeight: 0,
  }
  const second: CSSProperties = { flex: "1 1 0%", minWidth: 0, minHeight: 0 }
  return [first, second]
}

function SplitView({ node, ...rest }: { node: DockSplit } & Omit<NodeViewProps, "node">) {
  const resizeSplit = useDockLayoutStore((s) => s.resizeSplit)
  const dragRef = useRef<{ splitId: string; direction: DockDirection; el: HTMLElement } | null>(
    null,
  )

  const handleDragMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const ratio = ratioFromPointer(
        drag.el.getBoundingClientRect(),
        e.clientX,
        e.clientY,
        drag.direction,
      )
      if (ratio !== null) resizeSplit(drag.splitId, ratio)
    },
    [resizeSplit],
  )

  const endDrag = useCallback(() => {
    dragRef.current = null
    window.removeEventListener("pointermove", handleDragMove)
    window.removeEventListener("pointerup", endDrag)
    window.removeEventListener("pointercancel", endDrag)
  }, [handleDragMove])

  useEffect(() => endDrag, [endDrag])

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return
    const container = e.currentTarget.closest("[data-dock-split]")
    if (!(container instanceof HTMLElement)) return
    e.preventDefault()
    dragRef.current = { splitId: node.id, direction: node.direction, el: container }
    window.addEventListener("pointermove", handleDragMove)
    window.addEventListener("pointerup", endDrag)
    window.addEventListener("pointercancel", endDrag)
  }

  const isRow = node.direction === "horizontal"
  const [firstStyle, secondStyle] = childStyles(node.ratio)
  return (
    <div
      data-dock-split={node.id}
      data-testid={`dock-split-${node.id}`}
      className={cn("h-full w-full min-h-0 min-w-0", isRow ? "flex flex-row" : "flex flex-col")}
    >
      <div style={firstStyle} className="overflow-hidden">
        <NodeView node={node.children[0]} {...rest} />
      </div>
      <div
        role="separator"
        aria-orientation={isRow ? "vertical" : "horizontal"}
        aria-label={t("layout.splitter")}
        data-testid={`dock-splitter-${node.id}`}
        className={cn(
          "shrink-0 touch-none bg-border transition-colors hover:bg-primary/50",
          isRow ? "cursor-col-resize" : "cursor-row-resize",
        )}
        style={isRow ? { width: SPLITTER_PX } : { height: SPLITTER_PX }}
        onPointerDown={startDrag}
      />
      <div style={secondStyle} className="overflow-hidden">
        <NodeView node={node.children[1]} {...rest} />
      </div>
    </div>
  )
}

export function DockContainer({ renderPanel, className }: DockContainerProps) {
  const model = useDockLayoutStore((s) => s.model)
  const maximizedId = useDockLayoutStore((s) => s.maximizedId)
  const removePanel = useDockLayoutStore((s) => s.removePanel)
  const toggleMaximize = useDockLayoutStore((s) => s.toggleMaximize)
  const setActive = useDockLayoutStore((s) => s.setActive)

  // A maximized panel renders alone (when it still exists).
  if (maximizedId !== null && model.root !== null) {
    const leaf = findLeaf(model.root, maximizedId)
    if (leaf) {
      return (
        <div data-testid="dock-root" className={cn("h-full w-full", className)}>
          <LeafView
            leaf={leaf}
            active
            maximized
            renderPanel={renderPanel}
            onClose={removePanel}
            onToggleMaximize={toggleMaximize}
            onFocus={setActive}
          />
        </div>
      )
    }
  }

  if (model.root === null) {
    return (
      <div
        data-testid="dock-empty"
        className={cn(
          "flex h-full w-full items-center justify-center text-sm text-muted-foreground",
          className,
        )}
      >
        {t("layout.empty")}
      </div>
    )
  }

  return (
    <div data-testid="dock-root" className={cn("h-full w-full min-h-0 min-w-0", className)}>
      <NodeView
        node={model.root}
        activeId={model.activeId}
        maximizedId={maximizedId}
        renderPanel={renderPanel}
        onClose={removePanel}
        onToggleMaximize={toggleMaximize}
        onFocus={setActive}
      />
    </div>
  )
}
