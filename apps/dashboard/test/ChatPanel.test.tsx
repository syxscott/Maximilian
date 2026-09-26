import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { getDictionary, setLocale } from "@max/i18n"
import { ChatPanel } from "../src/components/ChatPanel"
import { applyDashboardDictionaries } from "../src/locales/index"
import type { RuntimeEvent, Workspace } from "../src/api"

// The timeline renders conversation.* strings from the dashboard domain
// dictionaries — register them exactly like main.tsx does (setup.ts pins
// the locale to en-US).
applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
setLocale("en-US")

const baseWorkspace: Workspace = {
  id: "ws-1",
  userRequest: "Build a todo app",
  status: "running",
  plan: null,
  results: [],
  review: null,
  error: null,
  createdAt: "2026-06-25T10:00:00Z",
}

/** Event fixture in the conversation tests' style (passthrough cast). */
const evx = (over: Record<string, unknown>): RuntimeEvent =>
  ({ type: "unknown", ...over }) as RuntimeEvent

describe("ChatPanel", () => {
  it("renders textarea, presets, and disabled Send button", () => {
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={null} />)
    expect(screen.getByPlaceholderText(/enter your request/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled()
    // Button inventory BY IDENTITY, not a global count — a global count
    // breaks whenever any other surface (empty state, toolbar) grows a
    // control, which is not this panel's contract to freeze.
    expect(screen.getByRole("button", { name: /todo web app/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /scraper/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /blog/i })).toBeInTheDocument()
    // The timeline toolbar's four controls (find / prev / next / share)…
    for (const name of [/find/i, /next task/i, /prev task/i, /copy as markdown/i]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument()
    }
    // …and the onboarding "Skip tour" button in the empty state.
    expect(screen.getByRole("button", { name: /skip tour/i })).toBeInTheDocument()
  })

  it("enables Send when text is entered", async () => {
    const user = userEvent.setup()
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={null} />)
    const textarea = screen.getByPlaceholderText(/enter your request/i)
    await user.type(textarea, "hello")
    expect(screen.getByRole("button", { name: /send/i })).not.toBeDisabled()
  })

  it("calls onSubmit with trimmed text and clears textarea", async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<ChatPanel onSubmit={onSubmit} submitting={false} workspace={null} />)
    const textarea = screen.getByPlaceholderText(/enter your request/i)
    await user.type(textarea, "  build something  ")
    await user.click(screen.getByRole("button", { name: /send/i }))
    expect(onSubmit).toHaveBeenCalledWith("build something")
    expect(textarea).toHaveValue("")
  })

  it("calls onSubmit when a preset is clicked", async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<ChatPanel onSubmit={onSubmit} submitting={false} workspace={null} />)
    const preset = screen.getByRole("button", { name: /todo web app/i })
    await user.click(preset)
    expect(onSubmit).toHaveBeenCalledWith(expect.stringContaining("Todo"))
  })

  it("disables Send while submitting", () => {
    render(<ChatPanel onSubmit={() => {}} submitting={true} workspace={null} />)
    expect(screen.getByRole("button", { name: /sending/i })).toBeDisabled()
  })

  it("Cmd+Enter on textarea submits", async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<ChatPanel onSubmit={onSubmit} submitting={false} workspace={null} />)
    const textarea = screen.getByPlaceholderText(/enter your request/i)
    await user.type(textarea, "submit me")
    await user.keyboard("{Meta>}{Enter}{/Meta}")
    expect(onSubmit).toHaveBeenCalledWith("submit me")
  })

  it("shows user request and completion message when workspace completed", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      status: "completed",
      review: {
        score: 9,
        summary: "Looks good",
        issues: [],
        suggestions: [],
        reviewedAt: "2026-06-25T11:00:00Z",
      },
    }
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={ws} />)
    expect(screen.getByText(/Build a todo app/)).toBeInTheDocument()
    // The timeline's review turn carries the verdict (pipeline wording).
    expect(screen.getByText(/Review complete/i)).toBeInTheDocument()
    expect(screen.getByText(/score 9/)).toBeInTheDocument()
  })

  it("shows error message when workspace failed", () => {
    const ws: Workspace = { ...baseWorkspace, status: "failed", error: "agent timeout" }
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={ws} />)
    expect(screen.getByText(/agent timeout/)).toBeInTheDocument()
  })

  // 会话顶格渲染: the conversation column has no standalone heading row —
  // the title rides IN the timeline's toolbar row via the toolbarLead
  // slot (a flex sibling of the find button), so the timeline keeps the
  // ~2 rows the old text-lg heading consumed in both dock and
  // standalone modes.
  it("renders the title as a compact badge inside the timeline toolbar row, not a heading", () => {
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={null} />)
    const badge = screen.getByTestId("chat-title-badge")
    expect(badge).toBeInTheDocument()
    // The i18n core title (chat.title), now compact rather than an h2 row.
    expect(badge.textContent).toMatch(/chat|conversation/i)
    // The badge is a flex sibling of the toolbar's find button — native
    // alignment, no absolutely-positioned overlay, no reserved margin.
    const toolbarRow = screen.getByRole("button", { name: /find/i }).parentElement
    expect(toolbarRow?.contains(badge)).toBe(true)
    expect(badge.className).not.toContain("absolute")
    const shell = screen.getByTestId("chat-timeline-shell")
    expect(shell.className).not.toContain("absolute")
    expect(shell.className).not.toContain("ml-20")
    expect(document.querySelector("h2")).toBeNull()
    // The badge is not a button — the toolbar row keeps its four
    // controls (find / prev / next / share). Scoped to the row: this
    // panel's toolbar contract, not a whole-document inventory.
    expect(within(toolbarRow!).getAllByRole("button")).toHaveLength(4)
  })

  it("omits the title badge entirely when dock-hosted (showHeading=false)", () => {
    render(
      <ChatPanel onSubmit={() => {}} submitting={false} workspace={null} showHeading={false} />,
    )
    expect(screen.queryByTestId("chat-title-badge")).toBeNull()
    expect(screen.getByTestId("chat-timeline-shell")).toBeInTheDocument()
  })

  // 两态一致性: dock (showHeading=false) and standalone (true) differ ONLY
  // by the badge — toolbar row and scroll region keep identical classes,
  // so padding and the scrolling box are the same in both modes.
  it("keeps toolbar and scroll geometry identical across dock and standalone modes", () => {
    const dock = render(
      <ChatPanel onSubmit={() => {}} submitting={false} workspace={null} showHeading={false} />,
    )
    const dockToolbar = screen.getByRole("button", { name: /find/i }).parentElement?.className
    const dockScroll = screen.getByTestId("conversation-timeline").className
    dock.unmount()

    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={null} />)
    expect(screen.getByRole("button", { name: /find/i }).parentElement?.className).toBe(dockToolbar)
    expect(screen.getByTestId("conversation-timeline").className).toBe(dockScroll)
    // The scroll region is the overflow owner in both modes.
    expect(screen.getByTestId("conversation-timeline").className).toContain("overflow-y-auto")
  })

  // 抽屉合一: the sidebar is no longer a grid-sibling column — it opens
  // as an absolutely-positioned 320px drawer overlaying the conversation's
  // right edge (z-30 above the timeline and its popups). The conversation
  // column keeps full width underneath; the drawer chrome matches the old
  // trailing column (rounded border, card background, scrolling stack).
  it("renders the sidebar as an overlay drawer above the conversation's right edge", () => {
    render(
      <ChatPanel
        onSubmit={() => {}}
        submitting={false}
        workspace={null}
        sidebar={<div data-testid="ws-sidebar">sidebar</div>}
      />,
    )
    const drawer = document.querySelector("aside")
    expect(drawer).not.toBeNull()
    expect(drawer?.getAttribute("data-testid")).toBe("workspace-sidebar-aside")
    // Overlay semantics: absolute + 320px (w-80) + stacked above the chat.
    expect(drawer?.className).toContain("absolute")
    expect(drawer?.className).toContain("w-80")
    expect(drawer?.className).toContain("z-30")
    // The registry content lands inside the drawer's scroll region.
    expect(
      drawer?.querySelector(".overflow-y-auto")?.contains(screen.getByTestId("ws-sidebar")),
    ).toBe(true)
    // The conversation column is a full-height, min-h-0 child of the same
    // grid — never squeezed by the drawer (single-column grid always).
    const column = screen.getByTestId("chat-timeline-shell").parentElement
    expect(column?.className).toContain("h-full")
    expect(column?.className).toContain("min-h-0")
    expect(drawer?.parentElement).toBe(column?.parentElement)
    // Without a toggle callback the close affordance is omitted.
    expect(screen.queryByTestId("workspace-sidebar-close")).toBeNull()
  })

  // 抽屉开合 1/3 — OFF state: sidebarHidden (workspace pref / keyboard
  // layer) mounts NO drawer at all; the conversation stays untouched.
  it("mounts no drawer while sidebarHidden is set", () => {
    render(
      <ChatPanel
        onSubmit={() => {}}
        submitting={false}
        workspace={null}
        sidebar={<div data-testid="ws-sidebar">sidebar</div>}
        sidebarHidden
      />,
    )
    expect(document.querySelector("aside")).toBeNull()
    expect(screen.queryByTestId("ws-sidebar")).toBeNull()
    // The conversation keeps its composer + timeline.
    expect(screen.getByPlaceholderText(/enter your request/i)).toBeInTheDocument()
    expect(screen.getByTestId("chat-timeline-shell")).toBeInTheDocument()
  })

  // 抽屉开合 2/3 — two-state round trip: clearing sidebarHidden brings
  // the drawer back with its content (pref flip semantics).
  it("shows the drawer again once sidebarHidden clears", () => {
    const view = render(
      <ChatPanel
        onSubmit={() => {}}
        submitting={false}
        workspace={null}
        sidebar={<div data-testid="ws-sidebar">sidebar</div>}
        sidebarHidden
      />,
    )
    expect(document.querySelector("aside")).toBeNull()
    view.rerender(
      <ChatPanel
        onSubmit={() => {}}
        submitting={false}
        workspace={null}
        sidebar={<div data-testid="ws-sidebar">sidebar</div>}
      />,
    )
    expect(document.querySelector("aside")).not.toBeNull()
    expect(screen.getByTestId("ws-sidebar")).toBeInTheDocument()
  })

  // 抽屉开合 3/3 — the drawer's close button routes through the SAME
  // toggle the App keyboard layer (Ctrl+Shift+B) performs: one shared
  // workspace-prefs write, no parallel open/close state.
  it("routes the drawer close button through the shared sidebar toggle", async () => {
    const user = userEvent.setup()
    const onToggleSidebar = vi.fn()
    render(
      <ChatPanel
        onSubmit={() => {}}
        submitting={false}
        workspace={null}
        sidebar={<div data-testid="ws-sidebar">sidebar</div>}
        onToggleSidebar={onToggleSidebar}
      />,
    )
    await user.click(screen.getByTestId("workspace-sidebar-close"))
    expect(onToggleSidebar).toHaveBeenCalledTimes(1)
    // The drawer stays mounted — visibility follows the sidebarHidden
    // prop (the prefs write re-renders the tree from App downward).
    expect(document.querySelector("aside")).not.toBeNull()
  })

  // 键盘: Cmd/Ctrl+F opens find ONLY when the focus already lives inside
  // the timeline container (the browser's own find stays untouched
  // elsewhere); Esc leaves find mode entirely.
  it("opens find with Cmd/Ctrl+F only when focus is inside the timeline, Esc closes", async () => {
    const user = userEvent.setup()
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={null} />)
    expect(screen.queryByTestId("timeline-find")).toBeNull()

    // Focus OUTSIDE the timeline (composer textarea) — no hijack.
    await user.click(screen.getByPlaceholderText(/enter your request/i))
    await user.keyboard("{Control>}{f}{/Control}")
    expect(screen.queryByTestId("timeline-find")).toBeNull()

    // Focus INSIDE the timeline (a toolbar button) — find opens, input
    // receives the focus.
    await user.click(screen.getByRole("button", { name: /prev task/i }))
    await user.keyboard("{Meta>}{f}{/Meta}")
    expect(screen.getByTestId("timeline-find")).toBeInTheDocument()
    expect(screen.getByTestId("timeline-find")).toHaveFocus()

    // Esc closes the box again.
    await user.keyboard("{Escape}")
    expect(screen.queryByTestId("timeline-find")).toBeNull()
  })
})

// ── Text units on screen (textUnits → TextUnitBlock in the render chain) ────

describe("ChatPanel text units", () => {
  it("surfaces steering messages as purple TextUnitBlocks inside the steered task turn", () => {
    const events = [
      evx({ type: "task-start", taskId: "t1", agentRole: "backend" }),
      evx({ type: "steering-applied", taskIds: ["t1"], messages: ["prefer sqlite", "skip bench"] }),
    ]
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={null} events={events} />)
    const blocks = screen.getAllByTestId("text-unit-block")
    expect(blocks).toHaveLength(2)
    for (const block of blocks) {
      expect(block).toHaveAttribute("data-source", "steering")
      // The purple steering styling (TextUnitBlock's source map).
      expect(block.className).toContain("border-purple-500/40")
    }
    expect(screen.getAllByTestId("text-unit-body")[0]).toHaveTextContent("prefer sqlite")
    // The blocks join the task's turn — not a separate section above it.
    const turn = screen.getByTestId("turn-group")
    expect(turn).toHaveAttribute("data-turn-id", "task-t1")
    expect(turn.contains(blocks[0]!)).toBe(true)
    expect(turn.contains(blocks[1]!)).toBe(true)
  })

  it("inserts steering segments at their stream position, before the turn's later units", () => {
    const events = [
      evx({ type: "task-start", taskId: "t1" }),
      evx({ type: "steering-applied", taskIds: ["t1"], messages: ["steer mid-run"] }),
      evx({ type: "assistant-text", text: "narration after steering", taskId: "t1" }),
    ]
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={null} events={events} />)
    const block = screen.getByTestId("text-unit-block")
    const narration = screen.getByTestId("turn-text")
    // The steering block precedes the narration that follows it in the
    // stream — "same turn, inserted before later units".
    expect(block.compareDocumentPosition(narration) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Ordinary narration keeps the plain text render (no provenance
    // block of its own — source tiers are for extracted units only).
    expect(narration).toHaveTextContent("narration after steering")
  })

  it("surfaces task description prose as system blocks without duplicating the user request", () => {
    const events = [evx({ type: "task-start", taskId: "t1", description: "Ship login flow first" })]
    render(
      <ChatPanel
        onSubmit={() => {}}
        submitting={false}
        workspace={baseWorkspace}
        events={events}
      />,
    )
    const block = screen.getByTestId("text-unit-block")
    expect(block).toHaveAttribute("data-source", "system")
    expect(screen.getByText("Ship login flow first")).toBeInTheDocument()
    // The user request renders once (the leading turn text) — the user-
    // sourced text unit is deliberately NOT re-injected as a block.
    expect(screen.getAllByText(/Build a todo app/)).toHaveLength(1)
    expect(
      screen
        .getAllByTestId("text-unit-block")
        .filter((b) => b.getAttribute("data-source") === "user"),
    ).toHaveLength(0)
  })
})

// ── Live status through the panel (running feedback, failed-expand) ─────────

describe("ChatPanel live status", () => {
  it("surfaces a failed turn's failing tool error expanded — no click needed", () => {
    const events = [
      evx({ type: "task-start", taskId: "t1", agentRole: "backend" }),
      evx({ type: "tool-start", taskId: "t1", toolName: "bash", input: { command: "exit 1" } }),
      evx({
        type: "tool-end",
        taskId: "t1",
        toolName: "bash",
        ok: false,
        durationMs: 8,
        error: "command failed with code 1",
      }),
      evx({ type: "task-failed", taskId: "t1", error: "boom" }),
    ]
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={null} events={events} />)
    expect(screen.getByTestId("turn-status")).toHaveTextContent("Failed")
    // defaultExpanded per status: the ErrorBlock detail is already open.
    expect(screen.getByTestId("tool-error")).toHaveTextContent("command failed with code 1")
    expect(screen.queryByTestId("tool-error-collapsed")).not.toBeInTheDocument()
  })

  // Flash timing (hold → 2s fade, driven by the component's mount
  // timer) is covered at the strongest level in test/conversation
  // .test.tsx "flashes a steering block once on entry and fades it out
  // over 2s" (fake timers). Here the panel-level contract is the
  // flash-once REGISTRY: historical steering never re-flashes.

  // Flash-once across the workspace switch: tab A → tab B → tab A makes
  // the panel replay A's FULL event list, and the historical steering
  // block remounts — with the flash retired (the flash-once registry
  // scopes its keys per workspace, so B's own steering still flashes).
  // This is also the source-tier x flash COEXISTENCE proof: both
  // features ride the SAME unit — the provenance source tier (data-source
  // + purple styling) is permanent, the entry flash is a one-shot
  // overlay on top of it, and replaying retires ONLY the overlay.
  it("keeps source styling on a steering unit while the flash retires across a workspace round trip", () => {
    const wsA: Workspace = { ...baseWorkspace, id: "ws-A" }
    const wsB: Workspace = { ...baseWorkspace, id: "ws-B" }
    const steeringEvents = [
      evx({ type: "task-start", taskId: "t1" }),
      evx({ type: "steering-applied", taskIds: ["t1"], messages: ["focus the flaky tests"] }),
    ]
    const { rerender } = render(
      <ChatPanel onSubmit={() => {}} submitting={false} workspace={wsA} events={steeringEvents} />,
    )
    const block = screen.getByTestId("text-unit-block")
    // FIRST sighting — source tier and the lit flash ride the SAME
    // element without interfering: purple provenance + overlay + the
    // one-time screen-reader announcement.
    expect(block).toHaveAttribute("data-source", "steering")
    expect(block.className).toContain("border-purple-500/40")
    expect(block).toHaveAttribute("data-flash", "true")
    expect(screen.getByTestId("text-unit-flash")).toBeInTheDocument()
    // The one-time announcement rides the fresh flash (screen-reader only).
    expect(screen.getByTestId("text-unit-flash-status")).toHaveTextContent("Steering applied")

    // Switch away — another stream entirely, no steering units at all.
    rerender(
      <ChatPanel
        onSubmit={() => {}}
        submitting={false}
        workspace={wsB}
        events={[evx({ type: "task-start", taskId: "other" })]}
      />,
    )
    expect(screen.queryByTestId("text-unit-block")).toBeNull()

    // Back to ws-A: the full event list replays, the block remounts —
    // without re-flashing (same stream scope, registry remembers it).
    rerender(
      <ChatPanel onSubmit={() => {}} submitting={false} workspace={wsA} events={steeringEvents} />,
    )
    const replayed = screen.getByTestId("text-unit-block")
    // The flash layer retired…
    expect(replayed).toHaveAttribute("data-flash", "false")
    expect(screen.getByTestId("text-unit-flash")).toHaveClass("opacity-0")
    expect(screen.queryByTestId("text-unit-flash-status")).toBeNull()
    // …while the source tier survives untouched on the same unit.
    expect(replayed).toHaveAttribute("data-source", "steering")
    expect(replayed.className).toContain("border-purple-500/40")
    expect(screen.getByTestId("text-unit-source")).toHaveTextContent("Steering")
  })
})

// ── "/" slash menu (QuickPick over the command registry) ────────────────────

describe("ChatPanel slash quickpick", () => {
  it("opens the QuickPick on a lone / with the navigation commands listed", async () => {
    const user = userEvent.setup()
    render(
      <ChatPanel onSubmit={() => {}} submitting={false} workspace={null} onNavigate={() => {}} />,
    )
    expect(screen.queryByTestId("quickpick")).toBeNull()
    await user.type(screen.getByPlaceholderText(/enter your request/i), "/")
    expect(screen.getByTestId("quickpick")).toBeInTheDocument()
    // Registry sections, localized through the quickpick domain keys.
    expect(screen.getByText("Navigation")).toBeInTheDocument()
    // QuickPick items carry role="option" with the i18n title as name.
    expect(screen.getByRole("option", { name: /Workspace/ })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /Usage/ })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /Governance/ })).toBeInTheDocument()
  })

  it("selecting a navigation command calls onNavigate with the tab and inserts nothing into the composer", async () => {
    const onNavigate = vi.fn()
    const user = userEvent.setup()
    render(
      <ChatPanel onSubmit={() => {}} submitting={false} workspace={null} onNavigate={onNavigate} />,
    )
    const textarea = screen.getByPlaceholderText(/enter your request/i)
    await user.type(textarea, "/")
    await user.click(screen.getByRole("option", { name: /Usage/ }))
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledWith("usage")
    // The lone trigger slash is dropped; no command text was inserted.
    expect(textarea).toHaveValue("")
    // The picker closed after selection.
    expect(screen.queryByTestId("quickpick")).toBeNull()
  })

  it("wired custom actions fire their panel executors (palette, stop-stream)", async () => {
    const onOpenPalette = vi.fn()
    const onAbort = vi.fn()
    const user = userEvent.setup()
    render(
      <ChatPanel
        onSubmit={() => {}}
        submitting={false}
        workspace={baseWorkspace}
        onOpenPalette={onOpenPalette}
        onAbort={onAbort}
      />,
    )
    const textarea = screen.getByPlaceholderText(/enter your request/i)
    await user.type(textarea, "/")
    expect(screen.getByText("Actions")).toBeInTheDocument()
    await user.click(screen.getByRole("option", { name: /Open command palette/ }))
    expect(onOpenPalette).toHaveBeenCalledTimes(1)
    expect(onAbort).not.toHaveBeenCalled()

    // The trigger slash was dropped on selection — a fresh "/" reopens.
    expect(textarea).toHaveValue("")
    await user.type(textarea, "/")
    await user.click(screen.getByRole("option", { name: /Stop current run/ }))
    expect(onAbort).toHaveBeenCalledTimes(1)
    expect(onOpenPalette).toHaveBeenCalledTimes(1)
  })

  it("offers navigation even without an onNavigate callback; selection inserts no command text", async () => {
    const user = userEvent.setup()
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={null} />)
    const textarea = screen.getByPlaceholderText(/enter your request/i)
    await user.type(textarea, "/")
    // Navigation commands always list (they route through onNavigate);
    // without executors the action items simply are not offered.
    expect(screen.getByRole("option", { name: /Usage/ })).toBeInTheDocument()
    expect(screen.queryByText("Actions")).toBeNull()
    expect(screen.queryByRole("option", { name: /Toggle sidebar/ })).toBeNull()
    await user.click(screen.getByRole("option", { name: /Usage/ }))
    // No handler was passed — nothing navigates — and the composer only
    // lost the lone trigger slash; no command text was ever inserted.
    expect(textarea).toHaveValue("")
    expect(screen.queryByTestId("quickpick")).toBeNull()
  })

  it("Escape closes the slash menu without touching the composer", async () => {
    const user = userEvent.setup()
    render(
      <ChatPanel onSubmit={() => {}} submitting={false} workspace={null} onNavigate={() => {}} />,
    )
    const textarea = screen.getByPlaceholderText(/enter your request/i)
    await user.type(textarea, "/")
    expect(screen.getByTestId("quickpick")).toBeInTheDocument()
    // Focus moved into the quickpick's query box — Escape closes it.
    await user.keyboard("{Escape}")
    expect(screen.queryByTestId("quickpick")).toBeNull()
  })
})

// ── Mention popup grouping (Agent roles / Skills) ───────────────────────────

describe("ChatPanel mention groups", () => {
  const ROLES = [
    { token: "backend", description: "agent role" },
    { token: "frontend", description: "agent role" },
  ]

  it("heads the popup with Agent roles and Skills sections and explains the empty skills list", async () => {
    const user = userEvent.setup()
    render(
      <ChatPanel
        onSubmit={() => {}}
        submitting={false}
        workspace={null}
        mentionSuggestions={ROLES}
      />,
    )
    await user.type(screen.getByPlaceholderText(/enter your request/i), "@")
    expect(screen.getByTestId("mention-popup")).toBeInTheDocument()
    expect(screen.getByTestId("mention-group-header-roles")).toHaveTextContent("Agent roles")
    expect(screen.getByTestId("mention-group-header-skills")).toHaveTextContent("Skills")
    // Roles land in their section...
    expect(screen.getByTestId("mention-group-roles")).toHaveTextContent("@backend")
    expect(screen.getByTestId("mention-group-roles")).toHaveTextContent("@frontend")
    // ...and the honestly-empty skills section explains itself instead
    // of inventing entries.
    expect(screen.getByTestId("mention-skills-empty")).toHaveTextContent(/static placeholder/i)
  })

  it("keeps keyboard highlight working across the grouped popup", async () => {
    const user = userEvent.setup()
    render(
      <ChatPanel
        onSubmit={() => {}}
        submitting={false}
        workspace={null}
        mentionSuggestions={ROLES}
      />,
    )
    const textarea = screen.getByPlaceholderText(/enter your request/i)
    await user.type(textarea, "@")
    const backendRow = screen.getByText("@backend").closest("li")
    const frontendRow = screen.getByText("@frontend").closest("li")
    expect(backendRow?.className).toContain("bg-accent")
    await user.keyboard("{ArrowDown}")
    // Flat highlight index (roles first, then skills) maps onto the
    // grouped render: the second role row takes the accent.
    expect(frontendRow?.className).toContain("bg-accent")
    expect(backendRow?.className).not.toContain("bg-accent")
    await user.keyboard("{ArrowDown}")
    // Highlight wraps the flat list (roles first, then the empty skills
    // section) back onto the first role row.
    expect(screen.getByText("@backend").closest("li")?.className).toContain("bg-accent")
  })
})
