// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SessionsPanel consumer tests for the deepseek chat-demo borrowings:
 * session time-grouping headers, the message-tree `<n/m>` version
 * switcher, and the backup/restore flows. The API boundary is mocked —
 * these pin the component wiring against the pinned endpoint contracts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent, cleanup, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getDictionary } from "@max/i18n"
import { SessionsPanel } from "../src/components/SessionsPanel"
import { useNotificationStore } from "../src/stores/notificationStore"
import { applyDashboardDictionaries } from "../src/locales/index"

// Register the aggregated dashboard dictionaries exactly like main.tsx so
// the panel's t() calls resolve (setup.ts pins the locale to en-US).
applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  getSessionMessages: vi.fn(),
  selectMessageVersion: vi.fn(),
  backupSessions: vi.fn(),
  restoreSessions: vi.fn(),
}))

vi.mock("@/api", async () => {
  const { z } = await import("zod")
  return {
    z,
    BASE: "/api",
    authHeaders: () => ({}),
    fetchJson: vi.fn(),
    // Modules imported transitively by lib/api/hooks — unused here.
    chatApi: {},
    metaApi: {},
    obsApi: {},
    govApi: {},
    usageApi: {},
    sessionsApi: { list: mocks.list },
  }
})

vi.mock("@/api-sessions", () => ({
  sessionsTreeApi: {
    getSessionMessages: mocks.getSessionMessages,
    selectMessageVersion: mocks.selectMessageVersion,
    backupSessions: mocks.backupSessions,
    restoreSessions: mocks.restoreSessions,
  },
}))

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const DAY = 86_400_000
const startOfToday = new Date().setHours(0, 0, 0, 0)

beforeEach(() => {
  useNotificationStore.setState({ items: [] })
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:mock"),
    revokeObjectURL: vi.fn(),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("SessionsPanel time grouping", () => {
  it("renders today / yesterday / month section headers", async () => {
    mocks.list.mockResolvedValue({
      sessions: [
        {
          id: "s-now",
          title: "Live run",
          workspaceId: "w1",
          updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
        },
        {
          id: "s-yesterday",
          title: "Night run",
          workspaceId: "w1",
          updatedAt: new Date(startOfToday - 2 * 3_600_000).toISOString(),
        },
        {
          id: "s-old",
          title: "Archive",
          workspaceId: "w1",
          updatedAt: new Date(startOfToday - 45 * DAY).toISOString(),
        },
      ],
    })
    renderWithQuery(<SessionsPanel />)

    await waitFor(() => expect(screen.getByTestId("sessions-list")).toBeTruthy())
    expect(screen.getByText("Today")).toBeTruthy()
    expect(screen.getByText("Yesterday")).toBeTruthy()
    // The 45-day-old session groups under its calendar month (YYYY-MM).
    const monthDate = new Date(startOfToday - 45 * DAY)
    expect(
      screen.getByText(
        `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`,
      ),
    ).toBeTruthy()
  })
})

describe("SessionsPanel message version switcher", () => {
  it("renders <n/m> only for messages with siblings and selects on click", async () => {
    mocks.list.mockResolvedValue({
      sessions: [
        { id: "s1", title: "Branched", workspaceId: "w1", updatedAt: new Date().toISOString() },
      ],
    })
    const treeMessages = {
      sessionId: "s1",
      messages: [
        {
          id: "a",
          role: "user",
          content: "root",
          createdAt: null,
          parentId: null,
          selectedChildId: "b",
        },
        {
          id: "b",
          role: "assistant",
          content: "first",
          createdAt: null,
          parentId: "a",
          selectedChildId: "c",
        },
        {
          id: "b2",
          role: "assistant",
          content: "second",
          createdAt: null,
          parentId: "a",
          selectedChildId: null,
        },
        {
          id: "c",
          role: "user",
          content: "follow-up",
          createdAt: null,
          parentId: "b",
          selectedChildId: null,
        },
      ],
    }
    mocks.getSessionMessages.mockResolvedValue(treeMessages)
    mocks.selectMessageVersion.mockResolvedValue({ ok: true })
    renderWithQuery(<SessionsPanel />)

    // Wait for the list, then expand the session to load its messages.
    await waitFor(() => expect(screen.getByText("Branched")).toBeTruthy())
    fireEvent.click(screen.getByText("Branched"))
    await waitFor(() => expect(screen.getByTestId("session-messages")).toBeTruthy())

    // Every message inside a sibling group gets its own <n/m> switcher:
    // b shows 1/2, b2 shows 2/2; a and c are singletons and show none.
    const switchers = screen.getAllByTestId("message-versions")
    expect(switchers).toHaveLength(2)
    const indexes = switchers.map(
      (el) => el.querySelector('[data-testid="message-version-index"]')?.textContent,
    )
    expect(indexes).toEqual(["1/2", "2/2"])

    // Step "b" to its next sibling → POST select, then the list refetches.
    fireEvent.click(within(switchers[0] as HTMLElement).getByLabelText("Next version"))
    await waitFor(() => expect(mocks.selectMessageVersion).toHaveBeenCalledWith("s1", "b2"))
    await waitFor(() => expect(mocks.getSessionMessages).toHaveBeenCalledTimes(2))
  })

  it("renders no switcher for a linear (all-null parent) session", async () => {
    mocks.list.mockResolvedValue({
      sessions: [
        { id: "s2", title: "Linear", workspaceId: "w1", updatedAt: new Date().toISOString() },
      ],
    })
    mocks.getSessionMessages.mockResolvedValue({
      sessionId: "s2",
      messages: [
        {
          id: "m1",
          role: "user",
          content: "hi",
          createdAt: null,
          parentId: null,
          selectedChildId: null,
        },
        {
          id: "m2",
          role: "assistant",
          content: "hello",
          createdAt: null,
          parentId: null,
          selectedChildId: null,
        },
      ],
    })
    renderWithQuery(<SessionsPanel />)

    await waitFor(() => expect(screen.getByText("Linear")).toBeTruthy())
    fireEvent.click(screen.getByText("Linear"))
    await waitFor(() => expect(screen.getByTestId("session-messages")).toBeTruthy())
    expect(screen.queryByTestId("message-versions")).toBeNull()
  })
})

describe("SessionsPanel backup / restore", () => {
  it("downloads the archive with the server-suggested filename", async () => {
    mocks.list.mockResolvedValue({ sessions: [] })
    mocks.backupSessions.mockResolvedValue({
      blob: new Blob(["zip"], { type: "application/zip" }),
      filename: "backup-2026.zip",
    })
    let createdAnchor: HTMLAnchorElement | undefined
    const createElementOriginal = document.createElement.bind(document)
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = createElementOriginal(tag)
      if (tag === "a") createdAnchor = el as HTMLAnchorElement
      return el
    })
    renderWithQuery(<SessionsPanel />)

    fireEvent.click(screen.getByTestId("sessions-backup"))
    await waitFor(() => expect(mocks.backupSessions).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        useNotificationStore
          .getState()
          .items.some((item) => item.messageKey === "sessions.notify.backupDone"),
      ).toBe(true),
    )
    expect(createdAnchor?.download).toBe("backup-2026.zip")
    expect(createdAnchor?.href).toContain("blob:mock")
  })

  it("confirms before importing and reports the restored count", async () => {
    mocks.list.mockResolvedValue({ sessions: [] })
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    mocks.restoreSessions.mockResolvedValue({ restored: 5 })
    renderWithQuery(<SessionsPanel />)

    fireEvent.click(screen.getByTestId("sessions-restore"))
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toBeTruthy()
    fireEvent.change(input, { target: { files: [new File(["zip"], "a.zip")] } })

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled())
    await waitFor(() => expect(mocks.restoreSessions).toHaveBeenCalled())
    const entry = useNotificationStore
      .getState()
      .items.find((item) => item.messageKey === "sessions.notify.restoreDone")
    expect(entry?.params?.count).toBe("5")
  })

  it("skips the import when confirm is dismissed", async () => {
    mocks.list.mockResolvedValue({ sessions: [] })
    vi.spyOn(window, "confirm").mockReturnValue(false)
    renderWithQuery(<SessionsPanel />)

    fireEvent.click(screen.getByTestId("sessions-restore"))
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(["zip"], "a.zip")] } })

    await waitFor(() => expect(window.confirm).toHaveBeenCalled())
    expect(mocks.restoreSessions).not.toHaveBeenCalled()
  })

  it("surfaces the server's 400 reason on a failed import", async () => {
    mocks.list.mockResolvedValue({ sessions: [] })
    vi.spyOn(window, "confirm").mockReturnValue(true)
    mocks.restoreSessions.mockRejectedValue(new Error("400 Bad Request: bad archive"))
    renderWithQuery(<SessionsPanel />)

    fireEvent.click(screen.getByTestId("sessions-restore"))
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(["zip"], "a.zip")] } })

    const entry = await waitFor(() => {
      const found = useNotificationStore
        .getState()
        .items.find((item) => item.messageKey === "sessions.notify.restoreFailed")
      expect(found).toBeTruthy()
      return found
    })
    expect(entry?.params?.message).toBe("400 Bad Request: bad archive")
  })
})
