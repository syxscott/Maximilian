// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Dock layout model (deepseek ui-dockkit borrowing, pure layer): the
 * panel tree is a binary split tree — every inner node splits its area
 * horizontally (left | right) or vertically (top | bottom) by a clamped
 * ratio, every leaf is a panel. All operations are pure functions over
 * an immutable DockModel, so the same code drives the UI, tests and the
 * persisted JSON. Parsing is defensive end to end: bad JSON, wrong
 * shapes, unknown kinds, out-of-range ratios, duplicate panel ids,
 * over-deep trees and cyclic (non-tree) graphs all degrade to the empty
 * model instead of throwing.
 */

export type DockDirection = "horizontal" | "vertical"

export interface DockLeaf {
  kind: "leaf"
  id: string
  /** i18n key rendered in the panel header. */
  titleKey: string
}

export interface DockSplit {
  kind: "split"
  id: string
  direction: DockDirection
  /** Share of the area given to children[0]; children[1] takes the rest. */
  ratio: number
  /** Exactly two children — a binary split. */
  children: [DockNode, DockNode]
}

export type DockNode = DockLeaf | DockSplit

export interface DockModel {
  root: DockNode | null
  /** The focused leaf id, null when nothing is focused. */
  activeId: string | null
}

/** Structural guards so a hand-edited layout can never wedge the UI. */
export const DOCK_MAX_DEPTH = 12
export const DOCK_MIN_RATIO = 0.1
export const DOCK_MAX_RATIO = 0.9
export const DOCK_MAX_PANELS = 24

/** Clamp a ratio into the renderable range; junk collapses to 0.5. */
export function clampDockRatio(ratio: number): number {
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return 0.5
  return Math.min(DOCK_MAX_RATIO, Math.max(DOCK_MIN_RATIO, ratio))
}

let splitSeq = 0

/** Fresh unique split id ("dock-split-N"). */
export function nextDockSplitId(): string {
  return `dock-split-${++splitSeq}`
}

/** Build one split node (ids auto-assigned when omitted). */
export function makeSplit(
  direction: DockDirection,
  first: DockNode,
  second: DockNode,
  ratio = 0.5,
  id?: string,
): DockSplit {
  return {
    kind: "split",
    id: id ?? nextDockSplitId(),
    direction,
    ratio: clampDockRatio(ratio),
    children: [first, second],
  }
}

/** Build one leaf node. */
export function makeLeaf(id: string, titleKey: string): DockLeaf {
  return { kind: "leaf", id, titleKey }
}

/** Default layout: conversation left, timeline right — the 2-pane shell. */
export function createDefaultDockModel(): DockModel {
  const chat = makeLeaf("chat", "layout.panel.chat")
  const timeline = makeLeaf("timeline", "layout.panel.timeline")
  return { root: makeSplit("horizontal", chat, timeline, 0.6), activeId: "chat" }
}

/** Depth-first leaf collection, in visual order. */
export function flattenPanels(node: DockNode | null): DockLeaf[] {
  if (!node) return []
  if (node.kind === "leaf") return [node]
  return [...flattenPanels(node.children[0]), ...flattenPanels(node.children[1])]
}

/** Find a leaf by id. */
export function findLeaf(node: DockNode | null, id: string): DockLeaf | null {
  if (!node) return null
  if (node.kind === "leaf") return node.id === id ? node : null
  return findLeaf(node.children[0], id) ?? findLeaf(node.children[1], id)
}

/** Build a model from an ordered panel list: [a, b, c] → (a | b) | c. */
export function createDockModel(
  panels: ReadonlyArray<{ id: string; titleKey: string }>,
): DockModel {
  const seen = new Set<string>()
  let root: DockNode | null = null
  for (const panel of panels) {
    if (panel.id === "" || seen.has(panel.id)) continue
    seen.add(panel.id)
    const leaf = makeLeaf(panel.id, panel.titleKey)
    // Left-biased fold: every new panel splits off to the right at 50%.
    root = root === null ? leaf : makeSplit("horizontal", root, leaf, 0.5)
  }
  // The first panel starts focused.
  return { root, activeId: flattenPanels(root)[0]?.id ?? null }
}

/**
 * Add a panel by splitting the target leaf: horizontal puts the new
 * panel to the right, vertical below it. The new panel takes focus.
 * Unknown target / duplicate id / full dock → model unchanged.
 */
export function addPanel(
  model: DockModel,
  newId: string,
  targetId: string,
  direction: DockDirection,
  titleKey?: string,
): DockModel {
  const id = newId.trim()
  if (id === "" || model.root === null) return model
  if (findLeaf(model.root, id) !== null) return model
  if (flattenPanels(model.root).length >= DOCK_MAX_PANELS) return model
  const target = findLeaf(model.root, targetId)
  if (target === null) return model

  const leaf = makeLeaf(id, titleKey ?? `layout.panel.${id}`)
  const replacement: DockNode = makeSplit(direction, target, leaf, 0.5)

  const visit = (node: DockNode): DockNode => {
    if (node.kind === "leaf") return node.id === target.id ? replacement : node
    return makeSplit(
      node.direction,
      visit(node.children[0]),
      visit(node.children[1]),
      node.ratio,
      node.id,
    )
  }
  return { root: visit(model.root), activeId: id }
}

/**
 * Reopen a *known* panel id (a stable registry entry, unlike addPanel's
 * caller-chosen new panel): an emptied dock gets the panel as its whole
 * layout, an open dock splits it beside the focused panel (default
 * direction: stacked below — sidebar-friendly). Already-open ids, blank
 * ids, a full dock or a focus-less dock leave the model unchanged.
 */
export function openPanel(
  model: DockModel,
  panelId: string,
  titleKey?: string,
  direction: DockDirection = "vertical",
): DockModel {
  const id = panelId.trim()
  if (id === "") return model
  if (model.root !== null && findLeaf(model.root, id) !== null) return model
  const key = titleKey?.trim() || `layout.panel.${id}`
  if (model.root === null) return { root: makeLeaf(id, key), activeId: id }
  const target = model.activeId ?? flattenPanels(model.root)[0]?.id
  if (target === undefined) return model
  return addPanel(model, id, target, direction, key)
}

/**
 * Build a model from an ordered panel list as a balanced vertical stack:
 * [a, b, c, d] → (a | b) | (c | d) — a balanced binary split tree, so
 * every leaf ends up equally tall (createDockModel's left-biased fold
 * would shrink the first panels into slivers).
 */
export function createStackedDockModel(
  panels: ReadonlyArray<{ id: string; titleKey: string }>,
): DockModel {
  const stack = (list: ReadonlyArray<{ id: string; titleKey: string }>): DockNode | null => {
    if (list.length === 0) return null
    if (list.length === 1) return makeLeaf(list[0].id, list[0].titleKey)
    const mid = Math.floor(list.length / 2)
    const first = stack(list.slice(0, mid))
    const second = stack(list.slice(mid))
    if (first === null || second === null) return first ?? second
    return makeSplit("vertical", first, second, mid / list.length)
  }
  const root = stack(panels)
  return { root, activeId: flattenPanels(root)[0]?.id ?? null }
}

/**
 * Remove a leaf; the parent split collapses into the surviving child.
 * Focus falls to the first remaining panel when the removed one was
 * active. Removing the last panel yields the empty model.
 */
export function removePanel(model: DockModel, panelId: string): DockModel {
  if (model.root === null) return model
  const leaves = flattenPanels(model.root)
  if (!leaves.some((l) => l.id === panelId)) return model

  const prune = (node: DockNode): DockNode | null => {
    if (node.kind === "leaf") return node.id === panelId ? null : node
    const first = prune(node.children[0])
    const second = prune(node.children[1])
    if (first === null) return second
    if (second === null) return first
    return makeSplit(node.direction, first, second, node.ratio, node.id)
  }

  const root = prune(model.root)
  const activeId =
    model.activeId === panelId
      ? root?.kind === "leaf"
        ? root.id
        : (flattenPanels(root)[0]?.id ?? null)
      : model.activeId
  return { root, activeId }
}

/** Resize one split by id; junk ratios are clamped, unknown ids ignored. */
export function resizeSplit(model: DockModel, splitId: string, ratio: number): DockModel {
  const visit = (node: DockNode): DockNode => {
    if (node.kind === "leaf") return node
    const first = visit(node.children[0])
    const second = visit(node.children[1])
    return node.id === splitId
      ? makeSplit(node.direction, first, second, clampDockRatio(ratio), node.id)
      : makeSplit(node.direction, first, second, node.ratio, node.id)
  }
  return model.root === null ? model : { ...model, root: visit(model.root) }
}

/** Focus a leaf by id; unknown ids and split ids are ignored. */
export function setActive(model: DockModel, panelId: string | null): DockModel {
  if (panelId === null) return { ...model, activeId: null }
  return findLeaf(model.root, panelId) === null ? model : { ...model, activeId: panelId }
}

// ── Serialization ───────────────────────────────────────────────────────────

const DOCK_DOC_VERSION = 1

interface DockDoc {
  v: number
  root: DockNode | null
  activeId: string | null
}

/** Serialize to the localStorage JSON document (stable, human-readable). */
export function serializeDockModel(model: DockModel): string {
  const doc: DockDoc = { v: DOCK_DOC_VERSION, root: model.root, activeId: model.activeId }
  return JSON.stringify(doc)
}

/**
 * Validate-and-build from untrusted JSON data. Returns the empty model
 * ({ root: null, activeId: null }) for anything malformed — including
 * cyclic graphs (caught by the visited set), over-deep trees (depth cap)
 * and duplicate panel ids (first occurrence wins, rest rejected).
 */
export function parseDockModel(value: unknown): DockModel {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { root: null, activeId: null }
  }
  const doc = value as Partial<DockDoc>
  const seenObjects = new Set<object>()
  const seenIds = new Set<string>()

  const walk = (node: unknown, depth: number): DockNode | null => {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return null
    if (seenObjects.has(node)) return null // cycle / shared subgraph — not a tree
    seenObjects.add(node)
    if (depth > DOCK_MAX_DEPTH) return null
    const o = node as Record<string, unknown>
    if (o.kind === "leaf") {
      const id = typeof o.id === "string" ? o.id.trim().slice(0, 200) : ""
      if (id === "" || seenIds.has(id)) return null
      seenIds.add(id)
      const titleKey =
        typeof o.titleKey === "string" && o.titleKey !== ""
          ? o.titleKey.slice(0, 200)
          : `layout.panel.${id}`
      return { kind: "leaf", id, titleKey }
    }
    if (o.kind === "split") {
      const id = typeof o.id === "string" ? o.id.trim().slice(0, 200) : ""
      if (id === "" || seenIds.has(id)) return null
      seenIds.add(id)
      if (!Array.isArray(o.children) || o.children.length !== 2) return null
      if (o.direction !== "horizontal" && o.direction !== "vertical") return null
      const first = walk(o.children[0], depth + 1)
      const second = walk(o.children[1], depth + 1)
      if (first === null || second === null) return null
      const ratio =
        typeof o.ratio === "number" && Number.isFinite(o.ratio) ? clampDockRatio(o.ratio) : 0.5
      return { kind: "split", id, direction: o.direction, ratio, children: [first, second] }
    }
    return null
  }

  const root = walk(doc.root, 0)
  if (root === null) return { root: null, activeId: null }
  const activeId =
    typeof doc.activeId === "string" && findLeaf(root, doc.activeId) !== null ? doc.activeId : null
  return { root, activeId }
}

/**
 * Deserialize the persisted document; never throws. Bad JSON and
 * malformed trees fall back to the default layout — an intentionally
 * emptied layout ({root:null}) reopens as the default 2-pane shell too,
 * since an empty dock is never a state worth restoring.
 */
export function deserializeDockModel(raw: string | null | undefined): DockModel {
  if (!raw) return createDefaultDockModel()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return createDefaultDockModel()
  }
  const model = parseDockModel(parsed)
  return model.root === null ? createDefaultDockModel() : model
}

// ── Resident (locked) main leaf ─────────────────────────────────────────────

/** The main conversation leaf — resident: the UI never offers to close it. */
export const DOCK_MAIN_PANEL_ID = "chat"
export const DOCK_MAIN_PANEL_TITLE_KEY = "layout.panel.chat"

/**
 * Guarantee the resident main leaf is present: stale or hand-edited
 * persisted documents that lost it get it re-inserted as the visually
 * leading panel (a horizontal split in front of the existing tree, or
 * the whole tree when the dock was emptied). Serialization keeps the
 * main leaf simply because the default/reset layouts contain it and the
 * locked UI can never remove it — this helper only repairs documents
 * that predate the lock. Pure: already-present (the common case) returns
 * the same model reference, so render-time use never churns split ids.
 */
export function ensureResidentLeaf(
  model: DockModel,
  id: string = DOCK_MAIN_PANEL_ID,
  titleKey: string = DOCK_MAIN_PANEL_TITLE_KEY,
): DockModel {
  if (findLeaf(model.root, id) !== null) return model
  const leaf = makeLeaf(id, titleKey)
  if (model.root === null) return { root: leaf, activeId: model.activeId ?? id }
  return {
    root: makeSplit("horizontal", leaf, model.root, 0.5),
    activeId: model.activeId ?? id,
  }
}

/**
 * Drag math: pointer position → split ratio. Horizontal splits map the
 * x offset inside the split's rect, vertical ones the y offset. Degenerate
 * rects (zero area — detached nodes, jsdom defaults) yield null so the
 * caller can skip the update.
 */
export function ratioFromPointer(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  direction: DockDirection,
): number | null {
  if (direction === "horizontal") {
    if (rect.width <= 0) return null
    return clampDockRatio((clientX - rect.left) / rect.width)
  }
  if (rect.height <= 0) return null
  return clampDockRatio((clientY - rect.top) / rect.height)
}
