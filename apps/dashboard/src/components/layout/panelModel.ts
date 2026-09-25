// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Panel-registry model layer (pure): the workspace-conditioned projection
 * of the panel registry, the leaf-header badge policy and the add-panel
 * menu's section grouping. Everything here is a total pure function over
 * plain data (workspace JSON, runtime events, panel specs) so the same
 * code drives the sidebar UI and the unit tests — per the dashboard
 * convention that every component domain keeps a defensive pure model
 * beside its components. Components only render what these functions
 * decide.
 *
 *   panelsForWorkspace    — base registry + conditional review/output
 *                           leaves, only when the workspace has the
 *                           content to back them;
 *   withConditionalPanels — view-time dock-model transform keeping the
 *                           conditional leaves docked while their content
 *                           exists (stale ones pruned), mirroring the
 *                           ensureResidentLeaf pattern;
 *   badgesForPanel        — the small header dot: parked permission
 *                           prompts (agent leaf) or unread stream content
 *                           (files leaf);
 *   groupPanelsForMenu    — the add-panel menu grouped by the feature
 *                           registry's sections (workspace/observe/admin).
 */
import type { RuntimeEvent } from "@/api"
import { type FeatureDomain, WORKSPACE_PANEL_DOMAIN_ALIASES, FEATURE_DOMAINS } from "@/features"
import {
  type DockModel,
  findLeaf,
  flattenPanels,
  makeLeaf,
  makeSplit,
  removePanel,
} from "@/components/layout/dockModel"

/** One registered dock leaf (shared shape with the src/features registry). */
export interface PanelSpec {
  id: string
  titleKey: string
}

// ── Conditional review / output leaves ──────────────────────────────────────

export const WORKSPACE_REVIEW_PANEL_ID = "review"
export const WORKSPACE_OUTPUT_PANEL_ID = "output"

/**
 * The workspace-conditioned leaves, in ensure order. Their registry
 * membership is derived per workspace by panelsForWorkspace — unlike the
 * base registry they must never be baked into a persisted default tree.
 */
export const CONDITIONAL_PANEL_IDS: readonly string[] = [
  WORKSPACE_REVIEW_PANEL_ID,
  WORKSPACE_OUTPUT_PANEL_ID,
]

const REVIEW_PANEL_SPEC: PanelSpec = {
  id: WORKSPACE_REVIEW_PANEL_ID,
  titleKey: "layout.panel.review",
}
const OUTPUT_PANEL_SPEC: PanelSpec = {
  id: WORKSPACE_OUTPUT_PANEL_ID,
  titleKey: "layout.panel.output",
}

/** Defensive object view of a passthrough workspace payload. */
function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null
}

/**
 * Does the workspace carry a review result? Defensive: the workspace may
 * be null and its fields may be missing on hand-built payloads.
 */
export function workspaceHasReview(workspace: unknown): boolean {
  const review = recordOf(workspace)?.review
  return recordOf(review) !== null
}

/**
 * Does the workspace have output to show? True for materialized results
 * and for failed workspaces (whose error/output summary is exactly what
 * the output leaf surfaces) — a clean in-flight workspace has neither.
 */
export function workspaceHasOutput(workspace: unknown): boolean {
  const rec = recordOf(workspace)
  if (rec === null) return false
  if (rec.status === "failed") return true
  return Array.isArray(rec.results) && rec.results.length > 0
}

/**
 * The panel registry for one workspace: the base registry verbatim, plus
 * the review leaf when the workspace carries a review result and the
 * output leaf when it has output (results, or a failed status). A clean
 * workspace gets exactly the base registry — no empty leaves parked in
 * the sidebar. Pure: the input list is never mutated; already-present
 * conditional ids are never duplicated.
 */
export function panelsForWorkspace(
  workspace: unknown,
  basePanels: ReadonlyArray<PanelSpec>,
): PanelSpec[] {
  const panels = [...basePanels]
  const push = (spec: PanelSpec) => {
    if (!panels.some((p) => p?.id === spec.id)) panels.push(spec)
  }
  if (workspaceHasReview(workspace)) push(REVIEW_PANEL_SPEC)
  if (workspaceHasOutput(workspace)) push(OUTPUT_PANEL_SPEC)
  return panels
}

/**
 * View-time transform keeping the conditional leaves docked exactly while
 * their content exists: leaves in the registry are appended at the bottom
 * of the tree (fair-share split, focus untouched — the user's current
 * panel stays focused); ids that lost their content (workspace switched,
 * review cleared) are pruned, so a stale persisted document can never
 * render an empty shell. Pure — like ensureResidentLeaf, the store state
 * itself is never written.
 */
export function withConditionalPanels(
  model: DockModel,
  registry: ReadonlyArray<PanelSpec>,
): DockModel {
  const backed = new Map<string, PanelSpec>()
  for (const spec of registry) {
    if (spec !== null && typeof spec === "object" && CONDITIONAL_PANEL_IDS.includes(spec.id)) {
      backed.set(spec.id, spec)
    }
  }
  let next = model
  for (const id of CONDITIONAL_PANEL_IDS) {
    if (!backed.has(id)) next = removePanel(next, id)
  }
  for (const id of CONDITIONAL_PANEL_IDS) {
    const spec = backed.get(id)
    if (!spec || findLeaf(next.root, id) !== null) continue
    const leaf = makeLeaf(spec.id, spec.titleKey)
    if (next.root === null) {
      next = { root: leaf, activeId: next.activeId ?? spec.id }
      continue
    }
    // Fair share: N existing leaves keep N/(N+1) of the height, the new
    // leaf takes the rest — appending never squashes the stack.
    const count = flattenPanels(next.root).length
    next = {
      root: makeSplit("vertical", next.root, leaf, count / (count + 1)),
      activeId: next.activeId,
    }
  }
  return next
}

// ── Leaf-header badges (unread / parked dots) ───────────────────────────────

export type DockPanelBadgeReason = "unread" | "parked"

export interface DockPanelBadge {
  reason: DockPanelBadgeReason
  /** How many pending / new items back the dot (≥ 1). */
  count: number
}

/** The leaf that hosts the agent surface (its parked-permission dots). */
const AGENT_PANEL_ID = "agent"
/** The leaf whose content is the stream's file-change set. */
const FILES_PANEL_ID = "files"

/** Defensive string field off a passthrough event (trimmed, else null). */
function eventString(e: unknown, key: string): string | null {
  const value = recordOf(e)?.[key]
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

/**
 * Count permission prompts still parked on an approval gate: every
 * `permission-request` whose requestId has no matching
 * `permission-resolved`. Mirrors the conversation model's pairing —
 * including its synthetic `req-<index>` fallback for events that arrive
 * without a requestId.
 */
function pendingPermissionCount(events: ReadonlyArray<RuntimeEvent>): number {
  // One resolution answers exactly one request (requestIds can repeat),
  // in stream order — count resolutions per id, then consume them.
  const consumable = new Map<string, number>()
  for (let i = 0; i < events.length; i++) {
    if (eventString(events[i], "type") !== "permission-resolved") continue
    const id = eventString(events[i], "requestId") ?? `req-${i}`
    consumable.set(id, (consumable.get(id) ?? 0) + 1)
  }
  let pending = 0
  for (let i = 0; i < events.length; i++) {
    if (eventString(events[i], "type") !== "permission-request") continue
    const id = eventString(events[i], "requestId") ?? `req-${i}`
    if ((consumable.get(id) ?? 0) > 0) {
      consumable.set(id, (consumable.get(id) ?? 0) - 1)
      continue
    }
    pending++
  }
  return pending
}

/**
 * Count the stream's file-change entries — the same tool-start edit/write
 * events deriveFileChanges renders in the files leaf.
 */
export function fileChangeCount(events: ReadonlyArray<RuntimeEvent> | null | undefined): number {
  if (!Array.isArray(events)) return 0
  let count = 0
  for (const e of events) {
    if (eventString(e, "type") !== "tool-start") continue
    const tool = eventString(e, "toolName")
    if (tool === "edit" || tool === "write") count++
  }
  return count
}

/** What the caller already saw from a panel's content stream. */
export interface PanelSeenState {
  /** Content count already seen (e.g. file changes acknowledged by a visit). */
  seenCount?: number | null
}

/**
 * The header-badge policy for one leaf, derived purely from the event
 * stream (components re-run it whenever the stream changes — the "event
 * count changed" trigger):
 *
 *   - agent leaf: parked permission prompts awaiting a decision — the dot
 *     clears only when the matching `permission-resolved` lands;
 *   - files leaf: unread file changes — new edit/write tool calls since
 *     the caller's seen watermark (`seen.seenCount`), so focusing the
 *     leaf clears the dot until the stream produces fresh edits.
 *
 * Everything else (panels whose content state is not derivable from
 * events alone) stays badge-free. Defensive end to end: junk events and
 * unknown panel ids yield null, never a throw.
 */
export function badgesForPanel(
  panelId: string,
  events: ReadonlyArray<RuntimeEvent> | null | undefined,
  seen?: PanelSeenState | null,
): DockPanelBadge | null {
  if (typeof panelId !== "string" || panelId === "") return null
  const list = Array.isArray(events) ? events : []
  if (panelId === AGENT_PANEL_ID) {
    const pending = pendingPermissionCount(list)
    return pending > 0 ? { reason: "parked", count: pending } : null
  }
  if (panelId === FILES_PANEL_ID) {
    const changes = fileChangeCount(list)
    if (changes <= 0) return null
    const seenCount = seen?.seenCount
    if (typeof seenCount === "number" && Number.isFinite(seenCount) && changes <= seenCount) {
      return null
    }
    return { reason: "unread", count: changes }
  }
  return null
}

// ── Add-panel menu grouping (FEATURE_DOMAINS sections) ──────────────────────

export type MenuSection = FeatureDomain["section"]

const MENU_SECTIONS: readonly MenuSection[] = ["workspace", "observe", "admin"]

const SECTION_TITLE_KEYS: Record<MenuSection, string> = {
  workspace: "layout.addPanelMenu.section.workspace",
  observe: "layout.addPanelMenu.section.observe",
  admin: "layout.addPanelMenu.section.admin",
}

export interface MenuPanelGroup {
  section: MenuSection
  /** i18n key of the section heading. */
  titleKey: string
  /** The section's panels, in the given order. */
  panels: PanelSpec[]
}

/**
 * Group the menu's panels by the FEATURE_DOMAINS section their domain
 * answers to (panel id → alias → domain → section), in the canonical
 * workspace → observe → admin order, input order preserved inside each
 * group. Sections with no panels are omitted entirely (the current
 * registry is all-workspace, so the menu renders a single group — the
 * structure is here so the day a leaf files under observe/admin the menu
 * grows the heading without a rewrite). Panels with no backing domain
 * fall back to the workspace group so a registry row can never vanish
 * from the menu. Defensive: junk rows drop out.
 */
export function groupPanelsForMenu(
  panels: ReadonlyArray<PanelSpec>,
  domains: ReadonlyArray<FeatureDomain> = FEATURE_DOMAINS,
  aliases: Readonly<Record<string, string>> = WORKSPACE_PANEL_DOMAIN_ALIASES,
): MenuPanelGroup[] {
  const sectionOfDomain = new Map<string, MenuSection>()
  for (const domain of domains) {
    if (domain !== null && typeof domain === "object" && typeof domain.id === "string") {
      if (MENU_SECTIONS.includes(domain.section)) sectionOfDomain.set(domain.id, domain.section)
    }
  }
  const buckets = new Map<MenuSection, PanelSpec[]>()
  for (const panel of panels) {
    if (panel === null || typeof panel !== "object") continue
    if (typeof panel.id !== "string" || panel.id === "") continue
    const domainId = aliases[panel.id] ?? panel.id
    const section = sectionOfDomain.get(domainId) ?? "workspace"
    const bucket = buckets.get(section) ?? []
    if (!bucket.some((p) => p.id === panel.id)) bucket.push(panel)
    buckets.set(section, bucket)
  }
  return MENU_SECTIONS.filter((section) => buckets.has(section)).map((section) => ({
    section,
    titleKey: SECTION_TITLE_KEYS[section],
    panels: buckets.get(section) as PanelSpec[],
  }))
}
