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
import { useStore } from "zustand"
import { t } from "@max/i18n"
import { cn } from "@/lib/utils"
import {
  type DockDirection,
  type DockLeaf,
  type DockModel,
  type DockNode,
  type DockSplit,
  findLeaf,
  ratioFromPointer,
} from "@/components/layout/dockModel"
import { type DockLayoutStore, useDockLayoutStore } from "@/components/layout/useDockLayout"
import { DockPanel } from "@/components/layout/DockPanel"

/** Divider thickness in px — subtracted once from the split's free space. */
const SPLITTER_PX = 6

export interface DockContainerProps {
  /** Content factory — the consumer maps a panel id to its contents. */
  renderPanel: (panelId: string) => ReactNode
  /**
   * Which dock store to render. Defaults to the main shell dock; scoped
   * docks (e.g. the workspace sidebar) pass their own instance.
   */
  store?: DockLayoutStore
  /**
   * Leaf ids that never get the close affordance (resident leaves, e.g.
   * the main conversation). The store action stays available to code,
   * but the UI cannot remove a locked panel.
   */
  lockedPanelIds?: ReadonlySet<string>
  /**
   * Optional view transform applied to the store model before rendering
   * (e.g. ensureResidentLeaf repairing a stale document). Pure — the
   * store state itself is never written.
   */
  transformModel?: (model: DockModel) => DockModel
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
  onResizeSplit: (splitId: string, ratio: number) => void
  lockedPanelIds?: ReadonlySet<string>
}

function LeafView({
  leaf,
  active,
  maximized,
  renderPanel,
  onClose,
  onToggleMaximize,
  onFocus,
  lockedPanelIds,
}: {
  leaf: DockLeaf
  active: boolean
  maximized: boolean
  renderPanel: (panelId: string) => ReactNode
  onClose: (id: string) => void
  onToggleMaximize: (id: string) => void
  onFocus: (id: string) => void
  lockedPanelIds?: ReadonlySet<string>
}) {
  // Locked leaves drop the close affordance entirely (closable=false).
  const closable = !(lockedPanelIds && lockedPanelIds.has(leaf.id))
  return (
    <DockPanel
      id={leaf.id}
      titleKey={leaf.titleKey}
      active={active}
      maximized={maximized}
      closable={closable}
      onClose={closable ? onClose : undefined}
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
        lockedPanelIds={rest.lockedPanelIds}
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
  const { onResizeSplit: resizeSplit } = rest
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

export function DockContainer({
  renderPanel,
  store,
  lockedPanelIds,
  transformModel,
  className,
}: DockContainerProps) {
  // The shell dock is the default; scoped docks pass their own store.
  const dock = store ?? useDockLayoutStore
  const rawModel = useStore(dock, (s) => s.model)
  const model = transformModel ? transformModel(rawModel) : rawModel
  const maximizedId = useStore(dock, (s) => s.maximizedId)
  const removePanel = useStore(dock, (s) => s.removePanel)
  const toggleMaximize = useStore(dock, (s) => s.toggleMaximize)
  const setActive = useStore(dock, (s) => s.setActive)
  const resizeSplit = useStore(dock, (s) => s.resizeSplit)

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
            lockedPanelIds={lockedPanelIds}
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
        onResizeSplit={resizeSplit}
        lockedPanelIds={lockedPanelIds}
      />
    </div>
  )
}
