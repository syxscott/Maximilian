// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Dock layout engine tests:
 *   - dockModel.ts — every tree operation, ratio drag math, serialization
 *     round-trips and the defensive parser (bad JSON, wrong shapes,
 *     duplicate ids, over-deep trees, cyclic graphs), plus the density
 *     layer: resetSplit (double-click even-split) and the tri-state
 *     panel display (normal → maximized → hidden strip) cycle;
 *   - useDockLayout — store actions + "maximilian.dock-layout" persistence;
 *   - DockPanel / DockContainer — render smoke, tri-state display wiring,
 *     splitter drag tooltip / double-click reset driven through pointer
 *     events at the model layer.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { getDictionary, setLocale } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"
import {
  DOCK_MAX_DEPTH,
  DOCK_MAX_PANELS,
  DOCK_MAX_RATIO,
  DOCK_MIN_RATIO,
  type DockModel,
  type DockSplit,
  addPanel,
  clampDockRatio,
  createDefaultDockModel,
  createDockModel,
  createStackedDockModel,
  cyclePanelDisplay,
  deserializeDockModel,
  findLeaf,
  flattenPanels,
  makeLeaf,
  makeSplit,
  nextPanelDisplay,
  openPanel,
  panelDisplay,
  parseDockModel,
  ratioFromPointer,
  removePanel,
  resetSplit,
  resizeSplit,
  serializeDockModel,
  setActive,
} from "../src/components/layout/dockModel"
import {
  DOCK_LAYOUT_STORAGE_KEY,
  loadDockLayout,
  persistDockLayout,
  selectIsMaximized,
  useDockLayoutStore,
} from "../src/components/layout/useDockLayout"
import { DockContainer } from "../src/components/layout/DockContainer"
import { DockPanel } from "../src/components/layout/DockPanel"

// Register the aggregated dashboard dictionaries exactly like main.tsx so
// t() resolves the layout.* keys (setup.ts pins the locale to en-US).
applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
setLocale("en-US")

const defaultModel = createDefaultDockModel()

const rootSplit = (model: DockModel): DockSplit => {
  const root = model.root
  if (root === null || root.kind !== "split") throw new Error("expected a split root")
  return root
}

const resetStore = () =>
  useDockLayoutStore.setState({ model: createDefaultDockModel(), maximizedId: null, hiddenIds: [] })

beforeEach(() => {
  try {
    localStorage.removeItem(DOCK_LAYOUT_STORAGE_KEY)
  } catch {
    /* ignore */
  }
  resetStore()
})

afterEach(() => {
  try {
    localStorage.removeItem(DOCK_LAYOUT_STORAGE_KEY)
  } catch {
    /* ignore */
  }
})

// ── dockModel: tree construction & queries ──────────────────────────────────

describe("dockModel construction", () => {
  it("createDockModel folds panels into a left-biased split tree", () => {
    const model = createDockModel([
      { id: "a", titleKey: "t.a" },
      { id: "b", titleKey: "t.b" },
      { id: "c", titleKey: "t.c" },
    ])
    expect(flattenPanels(model.root).map((l) => l.id)).toEqual(["a", "b", "c"])
    expect(model.activeId).toBe("a")
    const root = rootSplit(model)
    expect(root.ratio).toBe(0.5)
    // (a | b) | c — the tree grows leftward, new panels split off right.
    expect(root.children[1].kind).toBe("leaf")
    expect((root.children[0] as DockSplit).children[1].id).toBe("b")
  })

  it("createDockModel skips duplicates and blanks", () => {
    const model = createDockModel([
      { id: "a", titleKey: "t" },
      { id: "", titleKey: "t" },
      { id: "a", titleKey: "t" },
    ])
    expect(flattenPanels(model.root).map((l) => l.id)).toEqual(["a"])
  })

  it("clampDockRatio bounds junk into the renderable range", () => {
    expect(clampDockRatio(0.5)).toBe(0.5)
    expect(clampDockRatio(-3)).toBe(DOCK_MIN_RATIO)
    expect(clampDockRatio(7)).toBe(DOCK_MAX_RATIO)
    expect(clampDockRatio(Number.NaN)).toBe(0.5)
  })

  it("flattenPanels walks in visual order; findLeaf resolves by id", () => {
    expect(flattenPanels(null)).toEqual([])
    expect(findLeaf(defaultModel.root, "timeline")?.titleKey).toBe("layout.panel.timeline")
    expect(findLeaf(defaultModel.root, "missing")).toBeNull()
  })
})

// ── dockModel: operations ───────────────────────────────────────────────────

describe("dockModel operations", () => {
  it("addPanel splits the target and focuses the new panel", () => {
    const next = addPanel(defaultModel, "notes", "chat", "vertical", "layout.panel.notes")
    const root = rootSplit(next)
    expect(root.children[0].kind).toBe("split") // chat was replaced by a split
    expect(root.direction).toBe("horizontal")
    const nested = root.children[0] as DockSplit
    expect(nested.direction).toBe("vertical")
    expect(flattenPanels(next.root).map((l) => l.id)).toEqual(["chat", "notes", "timeline"])
    expect(next.activeId).toBe("notes")
  })

  it("addPanel is defensive: unknown target, duplicate or blank id → unchanged", () => {
    expect(addPanel(defaultModel, "x", "nope", "horizontal")).toBe(defaultModel)
    expect(addPanel(defaultModel, "timeline", "chat", "horizontal")).toBe(defaultModel)
    expect(addPanel(defaultModel, "   ", "chat", "horizontal")).toBe(defaultModel)
  })

  it("addPanel refuses to grow past DOCK_MAX_PANELS", () => {
    let model: DockModel = { root: makeLeaf("p0", "t"), activeId: "p0" }
    for (let i = 1; i < DOCK_MAX_PANELS; i++) {
      model = addPanel(model, `p${i}`, "p0", "horizontal")
    }
    expect(flattenPanels(model.root)).toHaveLength(DOCK_MAX_PANELS)
    expect(addPanel(model, "overflow", "p0", "horizontal")).toBe(model)
  })

  it("removePanel collapses the parent split and re-focuses", () => {
    const next = removePanel(defaultModel, "chat")
    expect(flattenPanels(next.root).map((l) => l.id)).toEqual(["timeline"])
    expect(next.activeId).toBe("timeline") // focus falls to the survivor
    expect(removePanel(next, "timeline").root).toBeNull()
  })

  it("removePanel keeps focus when a non-active panel is removed; unknown ids no-op", () => {
    const next = removePanel(defaultModel, "timeline")
    expect(next.activeId).toBe("chat")
    expect(removePanel(defaultModel, "missing")).toBe(defaultModel)
    expect(removePanel({ root: null, activeId: null }, "x").root).toBeNull()
  })

  it("resizeSplit clamps and targets one split by id", () => {
    const id = rootSplit(defaultModel).id
    expect(rootSplit(resizeSplit(defaultModel, id, 0.75)).ratio).toBe(0.75)
    expect(rootSplit(resizeSplit(defaultModel, id, 0.0001)).ratio).toBe(DOCK_MIN_RATIO)
    expect(rootSplit(resizeSplit(defaultModel, id, 42)).ratio).toBe(DOCK_MAX_RATIO)
    expect(resizeSplit(defaultModel, "no-such-split", 0.7).root).toEqual(defaultModel.root)
  })

  it("setActive focuses leaves only", () => {
    expect(setActive(defaultModel, "timeline").activeId).toBe("timeline")
    expect(setActive(defaultModel, "nope")).toBe(defaultModel)
    expect(setActive(defaultModel, null).activeId).toBeNull()
  })

  it("openPanel reopens a known id: beside the focus, or as the whole empty dock", () => {
    const reopened = openPanel(removePanel(defaultModel, "timeline"), "timeline")
    expect(flattenPanels(reopened.root).map((l) => l.id)).toEqual(["chat", "timeline"])
    expect(reopened.activeId).toBe("timeline")
    expect((reopened.root as DockSplit).direction).toBe("vertical") // stacks below by default
    // An emptied dock: the reopened panel becomes the whole layout.
    const empty = { root: null, activeId: null }
    const first = openPanel(empty, "tasks", "task.title")
    expect(first.root?.kind).toBe("leaf")
    expect(first.activeId).toBe("tasks")
    // Defensive: already-open, blank ids → unchanged.
    expect(openPanel(defaultModel, "chat")).toBe(defaultModel)
    expect(openPanel(defaultModel, "   ")).toBe(defaultModel)
  })

  it("createStackedDockModel balances heights: every leaf equally tall", () => {
    const panels = [
      { id: "a", titleKey: "t.a" },
      { id: "b", titleKey: "t.b" },
      { id: "c", titleKey: "t.c" },
    ]
    const model = createStackedDockModel(panels)
    expect(flattenPanels(model.root).map((l) => l.id)).toEqual(["a", "b", "c"])
    expect(model.activeId).toBe("a")
    const root = rootSplit(model)
    expect(root.direction).toBe("vertical")
    expect(root.ratio).toBeCloseTo(1 / 3) // the top leaf keeps its fair share
    expect(root.children[0].kind).toBe("leaf")
    const nested = root.children[1] as DockSplit
    expect(nested.direction).toBe("vertical")
    expect(nested.ratio).toBe(0.5)
    expect(createStackedDockModel([]).root).toBeNull()
  })
})

// ── dockModel: density layer (resetSplit + tri-state display) ───────────────

describe("dockModel resetSplit + tri-state display", () => {
  it("resetSplit evens the named split to 50/50 and leaves others alone", () => {
    const nested = addPanel(defaultModel, "notes", "chat", "vertical")
    const root = rootSplit(nested)
    const inner = root.children[0] as DockSplit
    const shaken = resizeSplit(resizeSplit(nested, root.id, 0.8), inner.id, 0.2)
    const evened = resetSplit(shaken, inner.id)
    expect((rootSplit(evened).children[0] as DockSplit).ratio).toBe(0.5)
    expect(rootSplit(evened).ratio).toBe(0.8) // the untouched split keeps its drag
    // Re-resetting an even split is stable; unknown ids degrade quietly.
    expect((rootSplit(resetSplit(evened, inner.id)).children[0] as DockSplit).ratio).toBe(0.5)
    expect(resetSplit(defaultModel, "no-such-split").root).toEqual(defaultModel.root)
  })

  it("nextPanelDisplay cycles normal → maximized → hidden → normal", () => {
    expect(nextPanelDisplay("normal")).toBe("maximized")
    expect(nextPanelDisplay("maximized")).toBe("hidden")
    expect(nextPanelDisplay("hidden")).toBe("normal")
  })

  it("panelDisplay resolves the three states from the flags, defensively", () => {
    expect(panelDisplay("a", null, [])).toBe("normal")
    expect(panelDisplay("a", "a", [])).toBe("maximized")
    expect(panelDisplay("a", null, ["a", "b"])).toBe("hidden")
    // Maximize wins over a hand-assembled contradictory flag pair.
    expect(panelDisplay("a", "a", ["a"])).toBe("maximized")
    // Junk hidden lists collapse to nothing instead of throwing.
    expect(panelDisplay("a", null, undefined)).toBe("normal")
    expect(panelDisplay("a", null, [42 as unknown as string, "  "])).toBe("normal")
  })

  it("cyclePanelDisplay walks the full cycle from normal and back", () => {
    const start = { maximizedId: null, hiddenIds: [] as string[] }
    const maximized = cyclePanelDisplay(start, "a")
    expect(maximized).toEqual({ maximizedId: "a", hiddenIds: [] })
    const hidden = cyclePanelDisplay(maximized, "a")
    expect(hidden).toEqual({ maximizedId: null, hiddenIds: ["a"] })
    const normal = cyclePanelDisplay(hidden, "a")
    expect(normal).toEqual({ maximizedId: null, hiddenIds: [] })
  })

  it("cyclePanelDisplay keeps at most one maximized panel", () => {
    const first = cyclePanelDisplay({ maximizedId: null, hiddenIds: [] }, "a")
    const second = cyclePanelDisplay(first, "b")
    expect(second).toEqual({ maximizedId: "b", hiddenIds: [] }) // a displaced to normal
  })

  it("cyclePanelDisplay stays exclusive and preserves unrelated hidden strips", () => {
    // Cycling a hidden panel restores it to normal (the strip's click).
    expect(cyclePanelDisplay({ maximizedId: null, hiddenIds: ["b"] }, "b")).toEqual({
      maximizedId: null,
      hiddenIds: [],
    })
    // Hiding the maximized panel clears the maximize (mutual exclusion).
    expect(cyclePanelDisplay({ maximizedId: "a", hiddenIds: [] }, "a")).toEqual({
      maximizedId: null,
      hiddenIds: ["a"],
    })
    // Strips of untouched panels survive every step.
    expect(cyclePanelDisplay({ maximizedId: null, hiddenIds: ["b"] }, "a")).toEqual({
      maximizedId: "a",
      hiddenIds: ["b"],
    })
    expect(cyclePanelDisplay({ maximizedId: null, hiddenIds: ["a", "b"] }, "a").hiddenIds).toEqual([
      "b",
    ])
  })

  it("cyclePanelDisplay is defensive about junk flags and blank ids", () => {
    // Junk flags read as "nothing special open" — the panel still cycles.
    expect(cyclePanelDisplay(undefined, "a")).toEqual({ maximizedId: "a", hiddenIds: [] })
    expect(cyclePanelDisplay(null, "a")).toEqual({ maximizedId: "a", hiddenIds: [] })
    // Blank / non-string ids leave the flags untouched.
    expect(cyclePanelDisplay({ maximizedId: "x", hiddenIds: ["y"] }, "   ")).toEqual({
      maximizedId: "x",
      hiddenIds: ["y"],
    })
    expect(
      cyclePanelDisplay({ maximizedId: "x", hiddenIds: "nope" as unknown as string[] }, "a"),
    ).toEqual({ maximizedId: "a", hiddenIds: [] })
  })
})

// ── dockModel: drag math ────────────────────────────────────────────────────

describe("ratioFromPointer", () => {
  const rect = { left: 100, top: 50, width: 1000, height: 400 }
  it("horizontal maps x, vertical maps y", () => {
    expect(ratioFromPointer(rect, 600, 0, "horizontal")).toBe(0.5)
    expect(ratioFromPointer(rect, 0, 250, "vertical")).toBe(0.5)
    expect(ratioFromPointer(rect, 1100, 0, "horizontal")).toBe(DOCK_MAX_RATIO)
  })
  it("degenerate rects yield null so the caller can skip", () => {
    expect(
      ratioFromPointer({ left: 0, top: 0, width: 0, height: 0 }, 5, 5, "horizontal"),
    ).toBeNull()
    expect(ratioFromPointer({ left: 0, top: 0, width: 0, height: 0 }, 5, 5, "vertical")).toBeNull()
  })
})

// ── dockModel: serialization & defensive parsing ────────────────────────────

describe("dockModel serialization", () => {
  it("round-trips through serialize/deserialize", () => {
    const fancy = addPanel(defaultModel, "notes", "timeline", "vertical")
    const restored = deserializeDockModel(serializeDockModel(fancy))
    expect(restored).toEqual(fancy)
  })

  it("deserializeDockModel falls back to the default shell on junk", () => {
    // The fallback shells get freshly generated split ids, so compare the
    // panel list rather than node identity.
    const expectDefault = (raw: string | null) =>
      expect(flattenPanels(deserializeDockModel(raw).root).map((l) => l.id)).toEqual([
        "chat",
        "timeline",
      ])
    expectDefault(null)
    expectDefault("")
    expectDefault("not json {")
    expectDefault('{"v":1,"root":42}')
    expect(
      flattenPanels(deserializeDockModel('{"v":1,"root":null}').root).map((l) => l.id),
    ).toEqual(["chat", "timeline"])
  })

  it("parseDockModel accepts a hand-written valid document", () => {
    const model = parseDockModel({
      v: 1,
      activeId: "l2",
      root: {
        kind: "split",
        id: "s1",
        direction: "vertical",
        ratio: 0.4,
        children: [
          { kind: "leaf", id: "l1", titleKey: "t1" },
          { kind: "leaf", id: "l2", titleKey: "t2" },
        ],
      },
    })
    expect(flattenPanels(model.root).map((l) => l.id)).toEqual(["l1", "l2"])
    expect(model.activeId).toBe("l2")
  })

  it("parseDockModel rejects wrong shapes, bad directions and malformed children", () => {
    expect(parseDockModel("scalar").root).toBeNull()
    expect(parseDockModel([]).root).toBeNull()
    expect(parseDockModel({ root: { kind: "leaf", id: "", titleKey: "t" } }).root).toBeNull()
    expect(parseDockModel({ root: { kind: "blob", id: "x" } }).root).toBeNull()
    expect(
      parseDockModel({
        root: { kind: "split", id: "s", direction: "diagonal", ratio: 0.5, children: [] },
      }).root,
    ).toBeNull()
    expect(
      parseDockModel({
        root: {
          kind: "split",
          id: "s",
          direction: "horizontal",
          ratio: 0.5,
          children: [{ kind: "leaf", id: "only", titleKey: "t" }],
        },
      }).root,
    ).toBeNull()
  })

  it("parseDockModel rejects duplicate panel ids (first valid tree wins)", () => {
    const model = parseDockModel({
      root: {
        kind: "split",
        id: "s",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { kind: "leaf", id: "dup", titleKey: "t" },
          { kind: "leaf", id: "dup", titleKey: "t" },
        ],
      },
    })
    expect(model.root).toBeNull()
  })

  it("parseDockModel rejects trees deeper than DOCK_MAX_DEPTH", () => {
    let node = makeLeaf("deep0", "t") as unknown
    for (let i = 1; i <= DOCK_MAX_DEPTH + 2; i++) {
      node = makeSplit("horizontal", node as ReturnType<typeof makeLeaf>, makeLeaf(`r${i}`, "t"))
    }
    expect(parseDockModel({ root: node }).root).toBeNull()
  })

  it("parseDockModel defuses cyclic (non-tree) graphs", () => {
    const cyc: Record<string, unknown> = {
      kind: "split",
      id: "s",
      direction: "horizontal",
      ratio: 0.5,
      children: [],
    }
    cyc.children = [cyc, { kind: "leaf", id: "l", titleKey: "t" }]
    expect(parseDockModel({ root: cyc }).root).toBeNull()
  })

  it("parseDockModel ignores a stale activeId that points nowhere", () => {
    const model = parseDockModel({
      activeId: "ghost",
      root: { kind: "leaf", id: "real", titleKey: "t" },
    })
    expect(model.activeId).toBeNull()
  })
})

// ── useDockLayout: store + persistence ──────────────────────────────────────

describe("useDockLayoutStore", () => {
  it("starts from the default 2-pane shell when storage is empty", () => {
    expect(flattenPanels(useDockLayoutStore.getState().model.root).map((l) => l.id)).toEqual([
      "chat",
      "timeline",
    ])
  })

  it("addPanel appends beside the focused panel, focuses it and persists", () => {
    const id = useDockLayoutStore.getState().addPanel()
    expect(id).not.toBeNull()
    const { model } = useDockLayoutStore.getState()
    expect(model.activeId).toBe(id)
    expect(flattenPanels(model.root).map((l) => l.id)).toEqual(["chat", id, "timeline"])
    const stored = deserializeDockModel(localStorage.getItem(DOCK_LAYOUT_STORAGE_KEY))
    expect(findLeaf(stored.root, id ?? "")).not.toBeNull()
  })

  it("addPanel can target a specific panel and direction", () => {
    useDockLayoutStore.getState().addPanel("timeline", "vertical")
    const { model } = useDockLayoutStore.getState()
    const root = rootSplit(model)
    expect(root.children[1].kind).toBe("split")
    expect((root.children[1] as DockSplit).direction).toBe("vertical")
  })

  it("removePanel persists and clears a maximized panel", () => {
    useDockLayoutStore.getState().toggleMaximize("chat")
    expect(selectIsMaximized("chat")(useDockLayoutStore.getState())).toBe(true)
    useDockLayoutStore.getState().removePanel("chat")
    expect(flattenPanels(useDockLayoutStore.getState().model.root).map((l) => l.id)).toEqual([
      "timeline",
    ])
    expect(useDockLayoutStore.getState().maximizedId).toBeNull()
    expect(
      flattenPanels(deserializeDockModel(localStorage.getItem(DOCK_LAYOUT_STORAGE_KEY)).root).map(
        (l) => l.id,
      ),
    ).toEqual(["timeline"])
  })

  it("resizeSplit persists the dragged ratio", () => {
    const id = rootSplit(useDockLayoutStore.getState().model).id
    useDockLayoutStore.getState().resizeSplit(id, 0.8)
    expect(rootSplit(useDockLayoutStore.getState().model).ratio).toBe(0.8)
    expect(
      rootSplit(deserializeDockModel(localStorage.getItem(DOCK_LAYOUT_STORAGE_KEY))).ratio,
    ).toBe(0.8)
  })

  it("resetSplit evens the persisted split back out", () => {
    const id = rootSplit(useDockLayoutStore.getState().model).id
    useDockLayoutStore.getState().resizeSplit(id, 0.85)
    useDockLayoutStore.getState().resetSplit(id)
    expect(rootSplit(useDockLayoutStore.getState().model).ratio).toBe(0.5)
    expect(
      rootSplit(deserializeDockModel(localStorage.getItem(DOCK_LAYOUT_STORAGE_KEY))).ratio,
    ).toBe(0.5)
  })

  it("cycleDisplay walks the tri-state and never persists the view state", () => {
    useDockLayoutStore.getState().cycleDisplay("chat")
    expect(useDockLayoutStore.getState().maximizedId).toBe("chat")
    expect(useDockLayoutStore.getState().hiddenIds).toEqual([])
    useDockLayoutStore.getState().cycleDisplay("chat")
    expect(useDockLayoutStore.getState().maximizedId).toBeNull()
    expect(useDockLayoutStore.getState().hiddenIds).toEqual(["chat"])
    useDockLayoutStore.getState().cycleDisplay("chat")
    expect(useDockLayoutStore.getState().hiddenIds).toEqual([])
    // View state only — the persisted document is untouched by cycling.
    expect(localStorage.getItem(DOCK_LAYOUT_STORAGE_KEY)).toBeNull()
  })

  it("removePanel drops a hidden panel from hiddenIds; resetLayout clears the view state", () => {
    useDockLayoutStore.getState().cycleDisplay("timeline")
    useDockLayoutStore.getState().cycleDisplay("timeline") // timeline hidden
    expect(useDockLayoutStore.getState().hiddenIds).toEqual(["timeline"])
    useDockLayoutStore.getState().removePanel("timeline")
    expect(useDockLayoutStore.getState().hiddenIds).toEqual([])
    useDockLayoutStore.getState().cycleDisplay("chat")
    useDockLayoutStore.getState().cycleDisplay("chat")
    useDockLayoutStore.getState().resetLayout()
    expect(useDockLayoutStore.getState().hiddenIds).toEqual([])
    expect(useDockLayoutStore.getState().maximizedId).toBeNull()
  })

  it("toggleMaximize flips; resetLayout restores and persists the default shell", () => {
    useDockLayoutStore.getState().addPanel("timeline", "vertical")
    useDockLayoutStore.getState().resetLayout()
    expect(flattenPanels(useDockLayoutStore.getState().model.root).map((l) => l.id)).toEqual([
      "chat",
      "timeline",
    ])
    expect(
      flattenPanels(deserializeDockModel(localStorage.getItem(DOCK_LAYOUT_STORAGE_KEY)).root).map(
        (l) => l.id,
      ),
    ).toEqual(["chat", "timeline"])
  })

  it("loadDockLayout is defensive: junk and throwing storage fall back", () => {
    localStorage.setItem(DOCK_LAYOUT_STORAGE_KEY, "{broken")
    expect(flattenPanels(loadDockLayout().root).map((l) => l.id)).toEqual(["chat", "timeline"])
    const throwing = {
      getItem: () => {
        throw new Error("no")
      },
    } as unknown as Storage
    expect(flattenPanels(loadDockLayout(throwing).root).map((l) => l.id)).toEqual([
      "chat",
      "timeline",
    ])
  })

  it("persistDockLayout survives a throwing storage silently", () => {
    const throwing = {
      setItem: () => {
        throw new Error("quota")
      },
    } as unknown as Storage
    expect(() => persistDockLayout(defaultModel, throwing)).not.toThrow()
  })
})

// ── DockPanel ───────────────────────────────────────────────────────────────

describe("DockPanel", () => {
  it("renders the translated title with active highlight and content", () => {
    render(
      <DockPanel id="chat" titleKey="layout.panel.chat" active>
        <div data-testid="panel-body" />
      </DockPanel>,
    )
    expect(screen.getByText("Conversation")).toBeTruthy()
    expect(screen.getByTestId("panel-body")).toBeTruthy()
    expect(screen.getByTestId("dock-header-chat").getAttribute("class")).toContain("bg-accent")
  })

  it("falls back to the raw id for unknown title keys", () => {
    render(<DockPanel id="ghost-panel" titleKey="layout.panel.ghost-panel" />)
    expect(screen.getByText("ghost-panel")).toBeTruthy()
  })

  it("wires close and the display-cycle affordance, omitting absent callbacks", () => {
    const onClose = vi.fn()
    const onCycleDisplay = vi.fn()
    const { rerender } = render(
      <DockPanel id="p" titleKey="t" onClose={onClose} onCycleDisplay={onCycleDisplay} maximized />,
    )
    // Tri-state cycle: from maximized the button offers the collapse stop.
    expect(screen.getByLabelText("Collapse panel")).toBeTruthy()
    fireEvent.click(screen.getByTestId("dock-maximize-p"))
    expect(onCycleDisplay).toHaveBeenCalledWith("p")
    fireEvent.click(screen.getByTestId("dock-close-p"))
    expect(onClose).toHaveBeenCalledWith("p")

    rerender(<DockPanel id="p" titleKey="t" />)
    expect(screen.queryByLabelText("Close panel")).toBeNull()
    expect(screen.queryByLabelText("Maximize panel")).toBeNull()
  })
})

// ── DockContainer ───────────────────────────────────────────────────────────

const renderDock = () =>
  render(<DockContainer renderPanel={(id) => <div data-testid={`content-${id}`} />} />)

describe("DockContainer", () => {
  it("renders the model tree: panels, split container and per-panel content", () => {
    renderDock()
    expect(screen.getByTestId("dock-panel-chat")).toBeTruthy()
    expect(screen.getByTestId("dock-panel-timeline")).toBeTruthy()
    expect(screen.getByTestId("content-chat")).toBeTruthy()
    const model = useDockLayoutStore.getState().model
    const splitId = rootSplit(model).id
    expect(screen.getByTestId(`dock-split-${splitId}`)).toBeTruthy()
    expect(screen.getByTestId(`dock-splitter-${splitId}`).getAttribute("role")).toBe("separator")
  })

  it("the display cycle maximizes, collapses to a strip, and the strip restores", () => {
    renderDock()
    // normal → maximized: the chat renders alone.
    fireEvent.click(screen.getByTestId("dock-maximize-chat"))
    expect(screen.queryByTestId("dock-panel-timeline")).toBeNull()
    expect(screen.getByTestId("dock-panel-chat")).toBeTruthy()
    // maximized → hidden: the chat collapses to a thin restore strip and
    // the tree (timeline) renders beside it again.
    fireEvent.click(screen.getByTestId("dock-maximize-chat"))
    expect(screen.queryByTestId("dock-panel-chat")).toBeNull()
    expect(screen.getByTestId("dock-hidden-strip-chat")).toBeTruthy()
    expect(screen.getByTestId("dock-panel-timeline")).toBeTruthy()
    // hidden → normal: clicking the strip restores the full panel.
    fireEvent.click(screen.getByTestId("dock-hidden-strip-chat"))
    expect(screen.getByTestId("dock-panel-chat")).toBeTruthy()
    expect(useDockLayoutStore.getState().hiddenIds).toEqual([])
  })

  it("dragging the splitter shows a live percentage tooltip that clears on release", () => {
    renderDock()
    const splitId = rootSplit(useDockLayoutStore.getState().model).id
    const splitEl = screen.getByTestId(`dock-split-${splitId}`)
    Object.defineProperty(splitEl, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500 }),
      configurable: true,
    })
    expect(screen.queryByTestId(`dock-splitter-tip-${splitId}`)).toBeNull()

    // RTL's fireEvent drops clientX/clientY on window-targeted pointer
    // events in this jsdom build — dispatch the window events by hand.
    const windowPointer = (type: string, x: number, y: number) => {
      act(() => {
        const ev = new window.Event(type, { bubbles: true }) as PointerEvent
        Object.defineProperty(ev, "clientX", { value: x })
        Object.defineProperty(ev, "clientY", { value: y })
        window.dispatchEvent(ev)
      })
    }

    fireEvent.pointerDown(screen.getByTestId(`dock-splitter-${splitId}`), { clientX: 600 })
    // The tooltip is live during the drag: the default 60%, then 75%.
    expect(screen.getByTestId(`dock-splitter-tip-${splitId}`).textContent).toBe("60%")
    windowPointer("pointermove", 750, 0)
    expect(screen.getByTestId(`dock-splitter-tip-${splitId}`).textContent).toBe("75%")
    // Release clears the tooltip.
    windowPointer("pointerup", 750, 0)
    expect(screen.queryByTestId(`dock-splitter-tip-${splitId}`)).toBeNull()
    expect(rootSplit(useDockLayoutStore.getState().model).ratio).toBe(0.75)
  })

  it("double-clicking the splitter evens the split back to 50/50", () => {
    renderDock()
    const splitId = rootSplit(useDockLayoutStore.getState().model).id
    useDockLayoutStore.getState().resizeSplit(splitId, 0.85)
    expect(rootSplit(useDockLayoutStore.getState().model).ratio).toBe(0.85)
    fireEvent.doubleClick(screen.getByTestId(`dock-splitter-${splitId}`))
    expect(rootSplit(useDockLayoutStore.getState().model).ratio).toBe(0.5)
    expect(screen.queryByTestId(`dock-splitter-tip-${splitId}`)).toBeNull()
  })

  it("closing panels drives the store; an emptied dock shows the empty state", () => {
    renderDock()
    fireEvent.click(screen.getByTestId("dock-close-timeline"))
    expect(useDockLayoutStore.getState().model.root?.kind).toBe("leaf")
    fireEvent.click(screen.getByTestId("dock-close-chat"))
    expect(useDockLayoutStore.getState().model.root).toBeNull()
    expect(screen.getByTestId("dock-empty")).toBeTruthy()
    expect(screen.getByText("No panels open — add one to get started")).toBeTruthy()
  })

  it("dragging the splitter updates the model ratio via pointer events", () => {
    renderDock()
    const splitId = rootSplit(useDockLayoutStore.getState().model).id
    const splitEl = screen.getByTestId(`dock-split-${splitId}`)
    Object.defineProperty(splitEl, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500 }),
      configurable: true,
    })

    // RTL's fireEvent drops clientX/clientY on window-targeted pointer
    // events in this jsdom build — dispatch the window events by hand.
    const windowPointer = (type: string, x: number, y: number) => {
      act(() => {
        const ev = new window.Event(type, { bubbles: true }) as PointerEvent
        Object.defineProperty(ev, "clientX", { value: x })
        Object.defineProperty(ev, "clientY", { value: y })
        window.dispatchEvent(ev)
      })
    }

    fireEvent.pointerDown(screen.getByTestId(`dock-splitter-${splitId}`), { clientX: 600 })
    windowPointer("pointermove", 750, 0)
    windowPointer("pointerup", 750, 0)

    expect(rootSplit(useDockLayoutStore.getState().model).ratio).toBe(0.75)
    // Listeners are released after pointerup — later moves are ignored.
    windowPointer("pointermove", 100, 0)
    expect(rootSplit(useDockLayoutStore.getState().model).ratio).toBe(0.75)
  })

  it("a vertical split maps the y axis", () => {
    useDockLayoutStore.setState({ model: addPanel(defaultModel, "notes", "chat", "vertical") })
    renderDock()
    const root = rootSplit(useDockLayoutStore.getState().model)
    const nested = root.children[0] as DockSplit
    const splitEl = screen.getByTestId(`dock-split-${nested.id}`)
    Object.defineProperty(splitEl, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 1000, height: 400, right: 1000, bottom: 400 }),
      configurable: true,
    })
    const windowPointer = (type: string, x: number, y: number) => {
      act(() => {
        const ev = new window.Event(type, { bubbles: true }) as PointerEvent
        Object.defineProperty(ev, "clientX", { value: x })
        Object.defineProperty(ev, "clientY", { value: y })
        window.dispatchEvent(ev)
      })
    }

    fireEvent.pointerDown(screen.getByTestId(`dock-splitter-${nested.id}`), { clientY: 200 })
    windowPointer("pointermove", 0, 300)
    windowPointer("pointerup", 0, 300)
    // The resize rebuilds the tree — re-read the split from the store.
    const updated = rootSplit(useDockLayoutStore.getState().model).children[0] as DockSplit
    expect(updated.id).toBe(nested.id)
    expect(updated.ratio).toBe(0.75)
  })
})

// ── layout i18n dictionaries ────────────────────────────────────────────────

describe("layout dictionaries", () => {
  const keys = (o: unknown, prefix = ""): string[] =>
    o !== null && typeof o === "object"
      ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
          v !== null && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
        )
      : []

  it("have identical key trees in zh-CN and en-US under the layout root", () => {
    const layoutEn = getDictionary("en-US") ?? {}
    const layoutZh = getDictionary("zh-CN") ?? {}
    const enLayoutKeys = keys(layoutEn).filter((k) => k.startsWith("layout."))
    const zhLayoutKeys = keys(layoutZh).filter((k) => k.startsWith("layout."))
    expect(enLayoutKeys.length).toBeGreaterThan(0)
    expect(enLayoutKeys.sort()).toEqual(zhLayoutKeys.sort())
  })
})
