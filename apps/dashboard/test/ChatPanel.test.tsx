import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { getDictionary, setLocale } from "@max/i18n"
import { ChatPanel } from "../src/components/ChatPanel"
import { applyDashboardDictionaries } from "../src/locales/index"
import type { Workspace } from "../src/api"

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

describe("ChatPanel", () => {
  it("renders textarea, presets, and disabled Send button", () => {
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={null} />)
    expect(screen.getByPlaceholderText(/enter your request/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled()
    // 3 presets + send + 4 timeline toolbar buttons (find / prev / next / share)
    // + the onboarding "Skip tour" button in the empty state.
    expect(screen.getAllByRole("button")).toHaveLength(9)
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
  // the title collapses into a small badge inside the timeline's toolbar
  // row (the wrapper overlays it on the row's reserved left edge), so the
  // timeline gains the ~2 rows the old text-lg heading consumed.
  it("renders the title as a compact badge in the timeline toolbar row, not a heading", () => {
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={null} />)
    const badge = screen.getByTestId("chat-title-badge")
    expect(badge).toBeInTheDocument()
    // The i18n core title (chat.title), now compact rather than an h2 row.
    expect(badge.textContent).toMatch(/chat|conversation/i)
    // The shell hosts the overlay + timeline; no h2 heading row remains.
    expect(screen.getByTestId("chat-timeline-shell")).toBeInTheDocument()
    expect(document.querySelector("h2")).toBeNull()
    // Button inventory unchanged (the badge is not a button).
    expect(screen.getAllByRole("button")).toHaveLength(9)
  })

  it("omits the title badge entirely when dock-hosted (showHeading=false)", () => {
    render(
      <ChatPanel onSubmit={() => {}} submitting={false} workspace={null} showHeading={false} />,
    )
    expect(screen.queryByTestId("chat-title-badge")).toBeNull()
    expect(screen.getByTestId("chat-timeline-shell")).toBeInTheDocument()
  })
})
