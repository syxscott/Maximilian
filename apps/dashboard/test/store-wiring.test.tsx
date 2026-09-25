// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Store-wiring integration tests: every domain store built in stores/ is
 * consumed by real shell components — each test walks one full chain
 * (component interaction → store write → persisted state / second
 * component read → rendered output):
 *
 *   1. composerDraftStore     ↔ ChatPanel draft round-trip (typed → saved →
 *                               restored on remount → cleared on submit)
 *   2. onboardingStore        ↔ EmptyState completion → card hides
 *   3. workspacePrefsStore    ↔ WorkspaceTabStrip close persistence +
 *                               sidebar visibility
 *   4. connectionStore        ↔ App injection (useConnectionSync) → banner
 *   5. settingsUiStore        ↔ SettingsPanel active section migration
 *   6. jobsStore + notif.     ↔ JobsDomainSection mount + snapshot
 *                               injection + new-job notification
 *   6b. App pickWorkspace     ↔ SettingsPanel → JobsDomainSection → JobsPanel
 *                               materialized-workspace chip opener
 *   7. sessionProjectionStore ↔ TrajectoryPanel / SubagentsPanel reads
 *   8. taskSelectionStore     ↔ TaskPanel click → TrajectoryPanel filter
 *   9. searchStore            ↔ AppCommandPalette recent history
 *  10. notificationStore      ↔ ToastHost render + dismiss
 *  11. notificationStore      ↔ runtimeNotifications bridge: steering-applied
 *                               stream events land a durable, rendered toast
 *  12. jobsStore              ↔ snapshot diff → job trigger-completion
 *                               notifications (success + failure, silent no-ops)
 *  13. trajectoryStore        ↔ pane window knobs (windowSize/expanded)
 *                               size the trajectory visible window
 */

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from "vitest"
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  renderHook,
  act,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, setLocale, t } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"

import { ChatPanel } from "../src/components/ChatPanel"
import { EmptyState } from "../src/components/EmptyState"
import { WorkspaceTabStrip } from "../src/components/WorkspaceTabStrip"
import { TaskPanel } from "../src/components/TaskPanel"
import { SubagentsPanel } from "../src/components/SubagentsPanel"
import { TrajectoryPanel } from "../src/features/trajectory"
import { AppCommandPalette } from "../src/components/AppCommandPalette"
import { ToastHost } from "../src/components/ToastHost"
import { SettingsPanel } from "../src/components/SettingsPanel"
import { ConnectionBanner, useConnectionSync } from "../src/App"
import type { Workspace, RuntimeEvent } from "../src/api"

import {
  useComposerDraftStore,
  COMPOSER_DRAFTS_STORAGE_KEY,
} from "../src/stores/composerDraftStore"
import {
  useOnboardingStore,
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_STEPS,
} from "../src/stores/onboardingStore"
import {
  useWorkspacePrefsStore,
  useWorkspacePrefs,
  WORKSPACE_PREFS_STORAGE_KEY,
} from "../src/stores/workspacePrefsStore"
import { useConnectionStore } from "../src/stores/connectionStore"
import { useTaskSelectionStore } from "../src/stores/taskSelectionStore"
import { useSessionProjectionStore } from "../src/stores/sessionProjectionStore"
import { useSearchStore, SEARCH_STORAGE_KEY } from "../src/stores/searchStore"
import { useSettingsUiStore } from "../src/stores/settingsUiStore"
import { useJobsStore } from "../src/stores/jobsStore"
import { useNotificationStore } from "../src/stores/notificationStore"
import { notifySteeringApplied } from "../src/stores/runtimeNotifications"
import {
  TRAJECTORY_WINDOW_DEFAULT,
  useTrajectoryStore,
  windowTrajectoryEntries,
} from "../src/stores/trajectoryStore"

// ── Harness ─────────────────────────────────────────────────────────────────

beforeAll(() => {
  // Register the aggregated dashboard dictionaries exactly like main.tsx so
  // domain keys (shell.*, stores.*, jobs.title, …) resolve.
  applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
  setLocale("en-US")
})

beforeEach(() => {
  localStorage.clear()
  useComposerDraftStore.setState({ drafts: {} })
  useOnboardingStore.getState().reset()
  useWorkspacePrefsStore.setState({ prefs: {} })
  useConnectionStore.setState({
    status: "reachable",
    lastError: null,
    retryCount: 0,
    lastCheckedAt: null,
  })
  useTaskSelectionStore.getState().clear()
  useSessionProjectionStore.setState({
    events: [],
    projection: { turns: [], lastEventAt: null, runningTaskIds: [] },
  })
  useSearchStore.setState({ query: "", results: [], resultsFor: null, recent: [] })
  useSettingsUiStore.getState().reset()
  useJobsStore.setState({ jobs: [], sortKey: "nextRunAt", sortAsc: true, filter: "all" })
  useNotificationStore.getState().clear()
  useTrajectoryStore.getState().reset()
})

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response

const wsFixture: Workspace = {
  id: "ws-draft-1",
  userRequest: "Build a todo app",
  status: "running",
  plan: null,
  results: [],
  review: null,
  error: null,
  createdAt: "2026-06-25T10:00:00Z",
}

const ev = (over: Record<string, unknown>): RuntimeEvent =>
  ({ workspaceId: "ws1", ...over }) as RuntimeEvent

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// ── 1. composerDraftStore ↔ ChatPanel ───────────────────────────────────────

describe("composer draft wiring (ChatPanel)", () => {
  it("persists the draft per workspace, restores it on remount, clears on submit", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const first = render(<ChatPanel onSubmit={onSubmit} submitting={false} workspace={wsFixture} />)
    const textarea = screen.getByPlaceholderText(/enter your request/i)
    await user.type(textarea, "half written plan")
    // Store + storage both hold the draft under the workspace id.
    expect(useComposerDraftStore.getState().drafts["ws-draft-1"]).toBe("half written plan")
    const persisted = JSON.parse(localStorage.getItem(COMPOSER_DRAFTS_STORAGE_KEY) ?? "{}")
    expect(persisted["ws-draft-1"]).toBe("half written plan")
    first.unmount()

    // Remount (fresh form state) — the draft comes back from the store.
    render(<ChatPanel onSubmit={onSubmit} submitting={false} workspace={wsFixture} />)
    expect(screen.getByPlaceholderText(/enter your request/i)).toHaveValue("half written plan")

    // Submitting sends the text and clears the draft everywhere.
    await user.click(screen.getByRole("button", { name: /send/i }))
    expect(onSubmit).toHaveBeenCalledWith("half written plan")
    expect(useComposerDraftStore.getState().drafts["ws-draft-1"]).toBeUndefined()
    expect(screen.getByPlaceholderText(/enter your request/i)).toHaveValue("")
  })

  it("switching workspaces switches the draft (no bleed between ids)", async () => {
    const user = userEvent.setup()
    const ws2: Workspace = { ...wsFixture, id: "ws-draft-2" }
    const view = render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={wsFixture} />)
    await user.type(screen.getByPlaceholderText(/enter your request/i), "draft one")

    view.rerender(<ChatPanel onSubmit={() => {}} submitting={false} workspace={ws2} />)
    // The other workspace has no draft — the textarea starts clean.
    expect(screen.getByPlaceholderText(/enter your request/i)).toHaveValue("")

    view.rerender(<ChatPanel onSubmit={() => {}} submitting={false} workspace={wsFixture} />)
    expect(screen.getByPlaceholderText(/enter your request/i)).toHaveValue("draft one")
  })
})

// ── 2. onboardingStore ↔ EmptyState ─────────────────────────────────────────

describe("onboarding wiring (EmptyState)", () => {
  it("marks 'welcome' on mount and 'connect'/'workspace' on the shortcut clicks", () => {
    const onProviders = vi.fn()
    const onPalette = vi.fn()
    render(<EmptyState onOpenProviders={onProviders} onOpenPalette={onPalette} />)
    expect(useOnboardingStore.getState().completed).toEqual(["welcome"])
    fireEvent.click(screen.getByRole("button", { name: /configure providers/i }))
    fireEvent.click(screen.getByRole("button", { name: /open command palette/i }))
    expect(onProviders).toHaveBeenCalledTimes(1)
    expect(onPalette).toHaveBeenCalledTimes(1)
    expect(useOnboardingStore.getState().completed).toEqual(["welcome", "connect", "workspace"])
    // Progress survives in storage.
    const doc = JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? "{}")
    expect(doc.completed).toEqual(["welcome", "connect", "workspace"])
  })

  it("hides the guidance once the tour is complete and after skip", () => {
    const view = render(<EmptyState />)
    expect(screen.getByTestId("onboarding-empty-state")).toBeTruthy()
    // Skip hides the card immediately and persists.
    fireEvent.click(screen.getByTestId("onboarding-skip"))
    expect(screen.queryByTestId("onboarding-empty-state")).toBeNull()
    expect(useOnboardingStore.getState().skipped).toBe(true)
    expect(JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? "{}").skipped).toBe(true)

    // Completing every step also hides it for future sessions.
    useOnboardingStore.getState().reset()
    act(() => {
      for (const step of ONBOARDING_STEPS) useOnboardingStore.getState().completeStep(step)
    })
    view.rerender(<EmptyState />)
    expect(screen.queryByTestId("onboarding-empty-state")).toBeNull()
  })
})

// ── 3. workspacePrefsStore ↔ WorkspaceTabStrip + sidebar ────────────────────

describe("workspace prefs wiring (tabs + sidebar)", () => {
  it("persists a closed tab through the store and keeps it closed on reload", () => {
    const onPick = vi.fn()
    const first = render(
      <WorkspaceTabStrip workspaces={["ws-a", "ws-b"]} activeId="ws-b" onPick={onPick} />,
    )
    expect(screen.getByTestId("workspace-tab-ws-a")).toBeTruthy()
    fireEvent.click(screen.getByTestId("workspace-tab-close-ws-a"))
    // Tab hidden + persisted as tabClosed in the prefs map.
    expect(screen.queryByTestId("workspace-tab-ws-a")).toBeNull()
    const prefs = JSON.parse(localStorage.getItem(WORKSPACE_PREFS_STORAGE_KEY) ?? "{}")
    expect(prefs["ws-a"].tabClosed).toBe(true)
    first.unmount()

    // A fresh mount (simulated reload) reads the same persisted record.
    render(<WorkspaceTabStrip workspaces={["ws-a", "ws-b"]} activeId="ws-b" onPick={onPick} />)
    expect(screen.queryByTestId("workspace-tab-ws-a")).toBeNull()
    expect(screen.getByTestId("workspace-tab-ws-b")).toBeTruthy()
  })

  it("drives sidebar visibility per prefs key through useWorkspacePrefs", () => {
    const { result, rerender } = renderHook(() => useWorkspacePrefs("__app__"))
    expect(result.current.sidebarHidden).toBe(false)
    act(() => {
      // Same write the App keyboard toggle performs.
      const current = useWorkspacePrefsStore.getState().prefs["__app__"]?.sidebarHidden ?? false
      useWorkspacePrefsStore.getState().updatePrefs("__app__", { sidebarHidden: !current })
    })
    expect(result.current.sidebarHidden).toBe(true)
    rerender()
    expect(useWorkspacePrefsStore.getState().prefs["__app__"]?.sidebarHidden).toBe(true)
  })
})

// ── 4. connectionStore ↔ App injection + banner ─────────────────────────────

describe("connection wiring (App injection → banner)", () => {
  const healthy = { status: "ok", telemetry: "on", metaAgent: "v9", providers: [{}, {}] }

  it("injects a healthy observation and renders the store-driven banner", () => {
    renderHook(() => useConnectionSync(healthy as never, undefined))
    expect(useConnectionStore.getState().status).toBe("reachable")
    expect(useConnectionStore.getState().lastCheckedAt).not.toBeNull()

    render(<ConnectionBanner health={healthy as never} />)
    const banner = screen.getByTestId("connection-banner")
    expect(banner.textContent).toContain("Connected")
    expect(banner.textContent).toContain("on") // telemetry
  })

  it("injects a query failure (sticky error, degraded) and shows it", () => {
    renderHook(() => useConnectionSync(undefined, new Error("boom")))
    expect(useConnectionStore.getState().status).toBe("degraded")
    expect(useConnectionStore.getState().lastError?.message).toBe("boom")

    render(<ConnectionBanner health={undefined} />)
    const banner = screen.getByTestId("connection-banner")
    expect(banner.textContent).toContain("Degraded")
    expect(banner.textContent).toContain("Last error: boom")
  })

  it("a healthy observation clears the sticky error", () => {
    renderHook(() => useConnectionSync(undefined, new Error("boom")))
    expect(useConnectionStore.getState().lastError?.message).toBe("boom")
    renderHook(() => useConnectionSync(healthy as never, undefined))
    expect(useConnectionStore.getState().lastError).toBeNull()
    expect(useConnectionStore.getState().status).toBe("reachable")
  })
})

// ── 5. settingsUiStore ↔ SettingsPanel ──────────────────────────────────────

describe("settings section wiring (settingsUiStore → SettingsPanel)", () => {
  it("migrates the active section into the store and rejects unknown ids", () => {
    const { result } = renderHook(() => useSettingsUiStore((s) => s.activeSection))
    expect(result.current).toBeNull()
    act(() => useSettingsUiStore.getState().setSection("memory"))
    expect(result.current).toBe("memory")
    act(() => useSettingsUiStore.getState().setSection("not-a-section" as never))
    expect(result.current).toBeNull()
  })

  it("the nav writes the store and the four deep domains mount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => okJson({})),
    )
    renderWithQuery(<SettingsPanel />)
    // Default section is appearance (client cards visible).
    expect(screen.getByTestId("theme-option-dark")).toBeTruthy()

    // Nav entries for the four newly mounted domains exist.
    fireEvent.click(screen.getByRole("button", { name: "Skill catalog" }))
    await waitFor(() => expect(screen.getByTestId("settings-skills")).toBeTruthy())
    expect(useSettingsUiStore.getState().activeSection).toBe("skills")

    fireEvent.click(screen.getByRole("button", { name: "Role memory" }))
    await waitFor(() => expect(screen.getByTestId("settings-memory")).toBeTruthy())
    expect(useSettingsUiStore.getState().activeSection).toBe("memory")

    fireEvent.click(screen.getByRole("button", { name: "Automations" }))
    await waitFor(() => expect(screen.getByTestId("settings-automations")).toBeTruthy())
    expect(useSettingsUiStore.getState().activeSection).toBe("automations")
  })
})

// ── 6. jobsStore + notificationStore ↔ JobsDomainSection ────────────────────

describe("jobs wiring (jobsStore injection + creation notification)", () => {
  it("mounts the jobs section, injects the query snapshot and notifies on new jobs", async () => {
    let payload: unknown = { jobs: [] }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        okJson(String(input).includes("/jobs") ? payload : {}),
      ),
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <SettingsPanel />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Job scheduler" }))
    await waitFor(() => expect(screen.getByTestId("settings-jobs")).toBeTruthy())

    // A created job appears in the next snapshot → store update + notification.
    payload = {
      jobs: [
        {
          id: "job-1",
          name: "Nightly scrape",
          schedule: "* * * * *",
          scheduleKind: "cron",
          createdAt: "2026-09-24T00:00:00Z",
        },
      ],
    }
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["jobs", "list"] })
    })
    await waitFor(() => expect(useJobsStore.getState().jobs.length).toBe(1))
    expect(useJobsStore.getState().jobs[0]?.name).toBe("Nightly scrape")
    // The store summary strip reads the store state back out.
    await waitFor(() => expect(screen.getByTestId("jobs-store-summary").textContent).toContain("1"))
    // New-job notification landed in the durable store.
    const created = useNotificationStore
      .getState()
      .items.find((n) => n.messageKey === "shell.notify.jobCreated")
    expect(created?.params?.name).toBe("Nightly scrape")
  })

  it("threads the App workspace opener through SettingsPanel into the jobs chip", async () => {
    const openWorkspace = vi.fn()
    const payload: unknown = {
      jobs: [
        {
          id: "job-mat",
          name: "Materializer",
          schedule: "* * * * *",
          scheduleKind: "cron",
          createdAt: "2026-09-24T00:00:00Z",
          events: [
            { at: "2026-09-24T00:01:00Z", kind: "dispatched", queued: true },
            { at: "2026-09-24T00:01:05Z", kind: "materialized", workspaceId: "ws-mat-9" },
          ],
        },
      ],
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        okJson(String(input).includes("/jobs") ? payload : {}),
      ),
    )
    // The App hands its pickWorkspace bridge down the SettingsPanel chain.
    renderWithQuery(<SettingsPanel onOpenWorkspace={openWorkspace} activeWorkspaceId="ws-active" />)
    fireEvent.click(screen.getByRole("button", { name: "Job scheduler" }))
    await waitFor(() => expect(screen.getByTestId("settings-jobs")).toBeTruthy())

    // Unfold the detail block once the queried row lands.
    fireEvent.click(await waitFor(() => screen.getByText("Materializer")))
    const chip = await waitFor(() => screen.getByTestId("jobs-workspace-job-mat"))
    expect(chip.tagName).toBe("BUTTON")
    fireEvent.click(chip)
    expect(openWorkspace).toHaveBeenCalledTimes(1)
    expect(openWorkspace).toHaveBeenCalledWith("ws-mat-9")
  })
})

// ── 7. sessionProjectionStore ↔ TrajectoryPanel / SubagentsPanel ────────────

describe("session projection wiring (store-fed panels)", () => {
  const stream: RuntimeEvent[] = [
    ev({ type: "task-start", taskId: "t1", agentRole: "backend" }),
    ev({ type: "tool-end", taskId: "t1", toolName: "edit", ok: true }),
    ev({ type: "task-start", taskId: "t2", agentRole: "frontend" }),
  ]

  it("panels render the projected stream without prop drilling", () => {
    act(() => useSessionProjectionStore.getState().setEvents(stream))
    render(
      <div>
        <TrajectoryPanel />
        <SubagentsPanel />
      </div>,
    )
    expect(screen.getByTestId("trajectory-list").children.length).toBe(3)
    expect(screen.getByTestId("subagents-list").children.length).toBe(2)
  })

  it("re-projects when App injects a fresh array", () => {
    render(<TrajectoryPanel />)
    expect(screen.getByText(/no events yet/i)).toBeTruthy()
    act(() => useSessionProjectionStore.getState().setEvents(stream))
    expect(screen.getByTestId("trajectory-list").children.length).toBe(3)
    act(() => useSessionProjectionStore.getState().setEvents([]))
    expect(screen.getByText(/no events yet/i)).toBeTruthy()
  })
})

// ── 8. taskSelectionStore ↔ TaskPanel click → TrajectoryPanel filter ────────

describe("task selection wiring (TaskPanel → TrajectoryPanel)", () => {
  const planWs: Workspace = {
    ...wsFixture,
    status: "running",
    plan: {
      id: "plan-1",
      workspaceId: "ws-draft-1",
      userRequest: "Build a todo app",
      rationale: "Split UI and API",
      tasks: [
        {
          id: "t1",
          description: "Build UI",
          agentRole: "frontend",
          dependsOn: [],
          status: "pending",
        },
        {
          id: "t2",
          description: "Build API",
          agentRole: "backend",
          dependsOn: [],
          status: "pending",
        },
      ],
      createdAt: "2026-06-25T10:00:00Z",
    },
  }
  const stream: RuntimeEvent[] = [
    ev({ type: "task-start", taskId: "t1" }),
    ev({ type: "task-start", taskId: "t2" }),
  ]

  it("clicking a task row selects it and the trajectory filter follows the same store", () => {
    act(() => useSessionProjectionStore.getState().setEvents(stream))
    render(
      <div>
        <TaskPanel workspace={planWs} />
        <TrajectoryPanel />
      </div>,
    )
    // Both tasks visible while "all".
    expect(screen.getByTestId("trajectory-list").children.length).toBe(2)

    fireEvent.click(screen.getByText("Build API"))
    expect(useTaskSelectionStore.getState().taskId).toBe("t2")
    expect(useTaskSelectionStore.getState().source).toBe("taskPanel")
    // The trajectory select mirrors the shared selection and filters.
    expect(screen.getByLabelText(/filter by task/i)).toHaveValue("t2")
    expect(screen.getByTestId("trajectory-list").children.length).toBe(1)

    // Picking "all" in the trajectory clears the shared selection.
    fireEvent.change(screen.getByLabelText(/filter by task/i), { target: { value: "all" } })
    expect(useTaskSelectionStore.getState().taskId).toBeNull()
    expect(screen.getByTestId("trajectory-list").children.length).toBe(2)
  })
})

// ── 9. searchStore ↔ AppCommandPalette ──────────────────────────────────────

describe("search history wiring (AppCommandPalette → searchStore)", () => {
  it("records executed commands into the persisted recent list and renders it", async () => {
    const onNavigate = vi.fn()
    const user = userEvent.setup()
    const view = render(
      <AppCommandPalette
        open
        onOpenChange={() => {}}
        onNavigate={onNavigate}
        onToggleTheme={() => {}}
        onOpenUsage={() => {}}
      />,
    )
    // Execute a navigation command (the palette closes itself after select).
    await user.click(screen.getByRole("option", { name: /Workspace/ }))
    expect(onNavigate).toHaveBeenCalledWith("workspace")
    expect(useSearchStore.getState().recent).toEqual([t("nav.workspace")])
    const persisted = JSON.parse(localStorage.getItem(SEARCH_STORAGE_KEY) ?? "{}")
    expect(persisted.recent).toEqual([t("nav.workspace")])

    // The Recent group appears and replays the recorded label.
    view.rerender(
      <AppCommandPalette
        open
        onOpenChange={() => {}}
        onNavigate={onNavigate}
        onToggleTheme={() => {}}
        onOpenUsage={() => {}}
      />,
    )
    expect(screen.getByText("Recent")).toBeTruthy()
    // The recent entry and the navigation command now share the label.
    expect(screen.getAllByRole("option", { name: /Workspace/ }).length).toBe(2)
  })

  it("dedupes and caps the history at 10 entries", () => {
    act(() => {
      for (let i = 0; i < 12; i++) {
        useSearchStore.getState().setQuery(`cmd-${i}`)
        useSearchStore.getState().commitSearch()
      }
    })
    expect(useSearchStore.getState().recent.length).toBe(10)
    expect(useSearchStore.getState().recent[0]).toBe("cmd-11")
  })
})

// ── 10. notificationStore ↔ ToastHost ───────────────────────────────────────

describe("notification wiring (ToastHost)", () => {
  it("renders pushed notifications and removes them on dismiss", async () => {
    vi.useFakeTimers()
    try {
      act(() => {
        useNotificationStore.getState().push("error", "shell.notify.workspaceSwitchFailed", {
          workspaceId: "ws-42",
        })
        useNotificationStore.getState().push("success", "shell.notify.jobCreated", { name: "Sync" })
      })
      render(<ToastHost />)
      expect(screen.getByTestId("toast-host").children.length).toBe(2)
      expect(screen.getByTestId("toast-error").textContent).toContain("ws-42")
      expect(screen.getByTestId("toast-success").textContent).toContain("Sync")

      // Dismissal removes the entry from the durable store too.
      fireEvent.click(screen.getAllByRole("button", { name: /dismiss notification/i })[0]!)
      expect(screen.getByTestId("toast-host").children.length).toBe(1)
      expect(useNotificationStore.getState().items.length).toBe(1)

      // Auto-retire: the TTL marks toasts read so the stack empties.
      act(() => vi.advanceTimersByTime(7000))
      expect(screen.queryByTestId("toast-host")).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

// ── 11. notificationStore ↔ runtimeNotifications bridge (steering-applied) ──

describe("steering wiring (runtime event → notificationStore → ToastHost)", () => {
  it("a steering-applied stream event lands a durable notification that renders", () => {
    // Same call the App-level SSE handler makes for ev.type === "steering-applied".
    act(() => notifySteeringApplied(["t1", "t2"]))
    const item = useNotificationStore
      .getState()
      .items.find((n) => n.messageKey === "shell.notify.steeringApplied")
    expect(item?.kind).toBe("info")
    expect(item?.params?.task).toBe("t1, t2")

    // The ToastHost consumer renders the bridged notification.
    render(<ToastHost />)
    expect(screen.getByTestId("toast-info").textContent).toContain("t1, t2")
  })

  it("defensive param shaping: junk payloads degrade instead of rendering undefined", () => {
    act(() => notifySteeringApplied(undefined))
    expect(
      useNotificationStore
        .getState()
        .items.find((n) => n.messageKey === "shell.notify.steeringApplied")?.params?.task,
    ).toBe("?")
    act(() => notifySteeringApplied(["  ", 42, "t9"]))
    expect(
      useNotificationStore.getState().items.find((n) => n.params?.task?.includes("t9"))?.params
        ?.task,
    ).toBe("t9")
  })
})

// ── 12. jobsStore ↔ snapshot diff → trigger-completion notifications ────────

describe("job trigger wiring (jobsStore snapshot diff → notificationStore)", () => {
  it("a known job finishing a run notifies; failures use the error key", () => {
    // First sighting = creation — no trigger notification (the jobs
    // domain section owns the created-notification).
    useJobsStore.getState().setJobs({
      jobs: [{ id: "j1", name: "Nightly scrape", schedule: "* * * * *", state: "idle" }],
    })
    expect(
      useNotificationStore
        .getState()
        .items.filter((n) => n.messageKey.startsWith("shell.notify.job")),
    ).toEqual([])

    // Trigger completed: lastRunAt advanced → success notification.
    act(() => {
      useJobsStore.getState().setJobs({
        jobs: [
          {
            id: "j1",
            name: "Nightly scrape",
            schedule: "* * * * *",
            state: "succeeded",
            lastRunAt: 1_000,
          },
        ],
      })
    })
    const done = useNotificationStore
      .getState()
      .items.find((n) => n.messageKey === "shell.notify.jobTriggered")
    expect(done?.kind).toBe("success")
    expect(done?.params?.name).toBe("Nightly scrape")

    // A later failed run flips to the error notification with the detail.
    act(() => {
      useJobsStore.getState().setJobs({
        jobs: [
          {
            id: "j1",
            name: "Nightly scrape",
            schedule: "* * * * *",
            state: "failed",
            lastRunAt: 2_000,
            error: "boom",
          },
        ],
      })
    })
    const failed = useNotificationStore
      .getState()
      .items.find((n) => n.messageKey === "shell.notify.jobRunFailed")
    expect(failed?.kind).toBe("error")
    expect(failed?.params?.error).toContain("boom")
  })

  it("unchanged snapshots and running → running transitions stay silent", () => {
    const runningJob = {
      id: "j2",
      name: "Sync",
      schedule: "* * * * *",
      state: "running" as const,
      lastRunAt: 5_000,
    }
    act(() => useJobsStore.getState().setJobs({ jobs: [runningJob] }))
    const countAfterFirst = useNotificationStore.getState().items.length

    // Re-injected identical snapshot (query refetch) — no new notification.
    act(() => useJobsStore.getState().setJobs({ jobs: [runningJob] }))
    expect(useNotificationStore.getState().items.length).toBe(countAfterFirst)

    // A job with no prior record never notifies (creation, not completion).
    act(() =>
      useJobsStore.getState().setJobs({
        jobs: [runningJob, { id: "j3", name: "Fresh", schedule: "@daily", state: "idle" }],
      }),
    )
    expect(useNotificationStore.getState().items.length).toBe(countAfterFirst)
  })
})

// ── 13. trajectoryStore ↔ trajectory pane window knobs ──────────────────────

describe("trajectory window wiring (store knobs size the visible window)", () => {
  const entries = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

  it("windowSize caps the visible tail; expanded lifts the cap", () => {
    // Default window (50) shows everything the stream derived.
    expect(windowTrajectoryEntries(entries, TRAJECTORY_WINDOW_DEFAULT, false)).toEqual(entries)
    // The store's window knob drives the slice (replaces the pane's
    // former in-component useState pair).
    act(() => useTrajectoryStore.getState().setWindowSize(10))
    expect(useTrajectoryStore.getState().windowSize).toBe(10)
    expect(
      windowTrajectoryEntries(entries, useTrajectoryStore.getState().windowSize, false),
    ).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    // Expanding the pane shows every entry again.
    act(() => useTrajectoryStore.getState().toggleExpanded())
    expect(useTrajectoryStore.getState().expanded).toBe(true)
    expect(
      windowTrajectoryEntries(entries, useTrajectoryStore.getState().windowSize, true),
    ).toEqual(entries)
  })

  it("junk window sizes clamp and reset restores the pane defaults", () => {
    act(() => useTrajectoryStore.getState().setWindowSize(Number.NaN))
    expect(useTrajectoryStore.getState().windowSize).toBe(TRAJECTORY_WINDOW_DEFAULT)
    // Sub-floor requests clamp to the renderable minimum (10).
    act(() => useTrajectoryStore.getState().setWindowSize(2))
    expect(useTrajectoryStore.getState().windowSize).toBe(10)
    expect(windowTrajectoryEntries(entries, 10, false).length).toBe(10)
    act(() => useTrajectoryStore.getState().toggleExpanded())
    act(() => useTrajectoryStore.getState().reset())
    expect(useTrajectoryStore.getState().expanded).toBe(false)
    expect(useTrajectoryStore.getState().windowSize).toBe(TRAJECTORY_WINDOW_DEFAULT)
    expect(windowTrajectoryEntries(entries, TRAJECTORY_WINDOW_DEFAULT, false)).toEqual(entries)
  })
})
