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
 * dependencies, no measurement hacks. While dragging, the divider shows
 * a live percentage tooltip; double-clicking it evens the split back to
 * 50/50. A maximized panel renders alone; a hidden (tri-state collapsed)
 * leaf renders as a thin restore strip in its slot instead.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react"
import { useStore } from "zustand"
import { t, useLocale } from "@max/i18n"
import { cn } from "@/lib/utils"
import {
  type DockDirection,
  type DockLeaf,
  type DockModel,
  type DockNode,
  type DockPanelDisplay,
  type DockSplit,
  findLeaf,
  panelDisplay,
  ratioFromPointer,
} from "@/components/layout/dockModel"
import { type DockLayoutStore, useDockLayoutStore } from "@/components/layout/useDockLayout"
import { DockPanel } from "@/components/layout/DockPanel"

/** Divider thickness in px — subtracted once from the split's free space. */
const SPLITTER_PX = 6
/** Thickness of a hidden leaf's collapsed restore strip, in px. */
const HIDDEN_STRIP_PX = 28

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
  hiddenIds: ReadonlyArray<string>
  renderPanel: (panelId: string) => ReactNode
  onClose: (id: string) => void
  onCycleDisplay: (id: string) => void
  onFocus: (id: string) => void
  onResizeSplit: (splitId: string, ratio: number) => void
  onResetSplit: (splitId: string) => void
  lockedPanelIds?: ReadonlySet<string>
}

function HiddenStripView({
  leaf,
  onCycleDisplay,
}: {
  leaf: DockLeaf
  onCycleDisplay: (id: string) => void
}) {
  useLocale() // re-render on locale switches
  const title = t(leaf.titleKey, leaf.id)
  return (
    <button
      type="button"
      data-testid={`dock-hidden-strip-${leaf.id}`}
      title={`${title} · ${t("layout.panel.hidden")}`}
      aria-label={`${title} — ${t("layout.panel.hidden")}`}
      className="h-full w-full overflow-hidden rounded-md border border-border bg-muted/60 text-xs text-muted-foreground hover:border-primary/60 hover:bg-accent hover:text-accent-foreground"
      onClick={() => onCycleDisplay(leaf.id)}
    >
      <span className="block truncate px-1 text-left">{title}</span>
    </button>
  )
}

function LeafView({
  leaf,
  display,
  active,
  renderPanel,
  onClose,
  onCycleDisplay,
  onFocus,
  lockedPanelIds,
}: {
  leaf: DockLeaf
  display: DockPanelDisplay
  active: boolean
  renderPanel: (panelId: string) => ReactNode
  onClose: (id: string) => void
  onCycleDisplay: (id: string) => void
  onFocus: (id: string) => void
  lockedPanelIds?: ReadonlySet<string>
}) {
  // Hidden leaves collapse to a thin restore strip — never a full panel.
  if (display === "hidden") {
    return <HiddenStripView leaf={leaf} onCycleDisplay={onCycleDisplay} />
  }
  // Locked leaves drop the close affordance entirely (closable=false).
  const closable = !(lockedPanelIds && lockedPanelIds.has(leaf.id))
  return (
    <DockPanel
      id={leaf.id}
      titleKey={leaf.titleKey}
      active={active}
      maximized={display === "maximized"}
      closable={closable}
      onClose={closable ? onClose : undefined}
      onCycleDisplay={onCycleDisplay}
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
        display={panelDisplay(node.id, rest.maximizedId, rest.hiddenIds)}
        active={rest.activeId === node.id}
        renderPanel={rest.renderPanel}
        onClose={rest.onClose}
        onCycleDisplay={rest.onCycleDisplay}
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
 * main axis, so the same styles serve rows and columns. A hidden child
 * collapses to a fixed-width restore strip; its sibling reclaims the
 * whole remaining area.
 */
function childStyles(
  hidden: readonly [boolean, boolean],
  ratio: number,
): [CSSProperties, CSSProperties] {
  const strip: CSSProperties = { flex: `0 0 ${HIDDEN_STRIP_PX}px`, minWidth: 0, minHeight: 0 }
  const rest: CSSProperties = { flex: "1 1 0%", minWidth: 0, minHeight: 0 }
  if (hidden[0]) return [strip, rest]
  if (hidden[1]) return [rest, strip]
  const first: CSSProperties = {
    flex: `0 0 calc((100% - ${SPLITTER_PX}px) * ${ratio})`,
    minWidth: 0,
    minHeight: 0,
  }
  const second: CSSProperties = { flex: "1 1 0%", minWidth: 0, minHeight: 0 }
  return [first, second]
}

function SplitView({ node, ...rest }: { node: DockSplit } & Omit<NodeViewProps, "node">) {
  const { onResizeSplit: resizeSplit, onResetSplit: resetSplit } = rest
  const dragRef = useRef<{ splitId: string; direction: DockDirection; el: HTMLElement } | null>(
    null,
  )
  // True between pointerdown and pointerup — drives the live percentage
  // tooltip on the divider.
  const [dragging, setDragging] = useState(false)

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
    setDragging(false)
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
    setDragging(true)
    window.addEventListener("pointermove", handleDragMove)
    window.addEventListener("pointerup", endDrag)
    window.addEventListener("pointercancel", endDrag)
  }

  const isRow = node.direction === "horizontal"
  const childHidden: [boolean, boolean] = [
    node.children[0].kind === "leaf" &&
      panelDisplay(node.children[0].id, rest.maximizedId, rest.hiddenIds) === "hidden",
    node.children[1].kind === "leaf" &&
      panelDisplay(node.children[1].id, rest.maximizedId, rest.hiddenIds) === "hidden",
  ]
  const [firstStyle, secondStyle] = childStyles(childHidden, node.ratio)
  const sharePercent = Math.round(node.ratio * 100)
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
        aria-valuenow={sharePercent}
        data-testid={`dock-splitter-${node.id}`}
        title={`${t("layout.splitter")} · ${t("layout.splitterReset")}`}
        className={cn(
          "relative shrink-0 touch-none bg-border transition-colors hover:bg-primary/50",
          isRow ? "cursor-col-resize" : "cursor-row-resize",
        )}
        style={isRow ? { width: SPLITTER_PX } : { height: SPLITTER_PX }}
        onPointerDown={startDrag}
        onDoubleClick={() => resetSplit(node.id)}
      >
        {dragging && (
          <span
            data-testid={`dock-splitter-tip-${node.id}`}
            aria-hidden
            className={cn(
              "pointer-events-none absolute z-10 rounded bg-popover px-1.5 py-0.5 text-[10px] font-medium text-popover-foreground shadow",
              isRow ? "left-1/2 top-3 -translate-x-1/2" : "left-3 top-1/2 -translate-y-1/2",
            )}
          >
            {sharePercent}%
          </span>
        )}
      </div>
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
  const hiddenIds = useStore(dock, (s) => s.hiddenIds)
  const removePanel = useStore(dock, (s) => s.removePanel)
  const cycleDisplay = useStore(dock, (s) => s.cycleDisplay)
  const setActive = useStore(dock, (s) => s.setActive)
  const resizeSplit = useStore(dock, (s) => s.resizeSplit)
  const resetSplitAction = useStore(dock, (s) => s.resetSplit)

  // A maximized panel renders alone (when it still exists).
  if (maximizedId !== null && model.root !== null) {
    const leaf = findLeaf(model.root, maximizedId)
    if (leaf) {
      return (
        <div data-testid="dock-root" className={cn("h-full w-full", className)}>
          <LeafView
            leaf={leaf}
            display="maximized"
            active
            renderPanel={renderPanel}
            onClose={removePanel}
            onCycleDisplay={cycleDisplay}
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
        hiddenIds={hiddenIds}
        renderPanel={renderPanel}
        onClose={removePanel}
        onCycleDisplay={cycleDisplay}
        onFocus={setActive}
        onResizeSplit={resizeSplit}
        onResetSplit={resetSplitAction}
        lockedPanelIds={lockedPanelIds}
      />
    </div>
  )
}
