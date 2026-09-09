import "@testing-library/jest-dom/vitest"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { OpencodeSessionList } from "../src/components/OpencodeSessionList"
import type { OpencodeSession, OpencodeSessionDetail } from "../src/hooks/useOpencodeSessions"

// Stable mock factories so individual tests can override the per-test
// behavior without re-importing the module.
const useOpencodeSessionsMock = vi.fn()
const fetchOpencodeSessionMock = vi.fn()

vi.mock("../src/hooks/useOpencodeSessions", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>
  return {
    ...mod,
    useOpencodeSessions: (...args: unknown[]) => useOpencodeSessionsMock(...args),
    fetchOpencodeSession: (...args: unknown[]) => fetchOpencodeSessionMock(...args),
  }
})

const baseSession: OpencodeSession = {
  sessionId: "ws-1",
  aggregateId: "ws-1",
  status: "busy",
  messageCount: 12,
  toolCallCount: 4,
  lastEventAt: new Date().toISOString(),
  lastEventType: "message:part",
}

const idleSession: OpencodeSession = {
  ...baseSession,
  sessionId: "ws-2",
  status: "idle",
  messageCount: 2,
  toolCallCount: 0,
  lastEventAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  lastEventType: "session:idle",
}

beforeEach(() => {
  useOpencodeSessionsMock.mockReset()
  fetchOpencodeSessionMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("OpencodeSessionList", () => {
  it("renders an empty-state when no sessions are returned", () => {
    useOpencodeSessionsMock.mockReturnValue({
      sessions: [],
      loading: false,
      error: null,
      generatedAt: null,
      live: false,
      refetch: vi.fn(),
    })
    render(<OpencodeSessionList />)
    expect(screen.getByTestId("opencode-session-list")).toBeInTheDocument()
    expect(screen.getByText(/no.*session|empty/i)).toBeInTheDocument()
  })

  it("renders a loading state", () => {
    useOpencodeSessionsMock.mockReturnValue({
      sessions: [],
      loading: true,
      error: null,
      generatedAt: null,
      live: false,
      refetch: vi.fn(),
    })
    render(<OpencodeSessionList />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it("renders an error message when the hook reports one", () => {
    useOpencodeSessionsMock.mockReturnValue({
      sessions: [],
      loading: false,
      error: new Error("upstream offline"),
      generatedAt: null,
      live: false,
      refetch: vi.fn(),
    })
    render(<OpencodeSessionList />)
    expect(screen.getByText(/upstream offline/i)).toBeInTheDocument()
  })

  it("renders one row per session with status badges", () => {
    useOpencodeSessionsMock.mockReturnValue({
      sessions: [baseSession, idleSession],
      loading: false,
      error: null,
      generatedAt: new Date().toISOString(),
      live: true,
      refetch: vi.fn(),
    })
    render(<OpencodeSessionList />)
    expect(screen.getByTestId("opencode-session-ws-1")).toBeInTheDocument()
    expect(screen.getByTestId("opencode-session-ws-2")).toBeInTheDocument()
    // busy + idle badges both render
    expect(screen.getByText(/busy/i)).toBeInTheDocument()
    expect(screen.getByText(/idle/i)).toBeInTheDocument()
  })

  it("shows the live indicator when SSE is connected", () => {
    useOpencodeSessionsMock.mockReturnValue({
      sessions: [baseSession],
      loading: false,
      error: null,
      generatedAt: new Date().toISOString(),
      live: true,
      refetch: vi.fn(),
    })
    render(<OpencodeSessionList />)
    expect(screen.getByTestId("opencode-live-indicator").textContent).toMatch(/live/i)
  })

  it("expands a row on click and renders recent events", async () => {
    useOpencodeSessionsMock.mockReturnValue({
      sessions: [baseSession],
      loading: false,
      error: null,
      generatedAt: new Date().toISOString(),
      live: true,
      refetch: vi.fn(),
    })
    const detail: OpencodeSessionDetail = {
      ...baseSession,
      recent: [
        {
          id: "e1",
          type: "message:part",
          timestamp: new Date().toISOString(),
          seq: 1,
          data: { sessionID: "ws-1", part: { text: "hello world" } },
        },
        {
          id: "e2",
          type: "tool:called",
          timestamp: new Date().toISOString(),
          seq: 2,
          data: { sessionID: "ws-1", tool: "bash", callID: "call-abc" },
        },
      ],
    }
    fetchOpencodeSessionMock.mockResolvedValue(detail)

    render(<OpencodeSessionList />)
    fireEvent.click(screen.getByTestId("opencode-session-ws-1"))

    await waitFor(() => {
      expect(screen.getByTestId("opencode-session-events")).toBeInTheDocument()
    })
    expect(screen.getAllByTestId("opencode-event-row")).toHaveLength(2)
    expect(screen.getByText(/message:part/i)).toBeInTheDocument()
    expect(screen.getByText(/tool:called/i)).toBeInTheDocument()
    expect(screen.getByText(/hello world/i)).toBeInTheDocument()
    expect(screen.getByText(/tool=bash/i)).toBeInTheDocument()
  })

  it("collapses a previously expanded row when clicked again", async () => {
    useOpencodeSessionsMock.mockReturnValue({
      sessions: [baseSession],
      loading: false,
      error: null,
      generatedAt: new Date().toISOString(),
      live: true,
      refetch: vi.fn(),
    })
    fetchOpencodeSessionMock.mockResolvedValue({
      ...baseSession,
      recent: [
        {
          id: "e1",
          type: "message:part",
          timestamp: new Date().toISOString(),
          seq: 1,
          data: { sessionID: "ws-1" },
        },
      ],
    })

    render(<OpencodeSessionList />)
    const row = screen.getByTestId("opencode-session-ws-1")
    fireEvent.click(row)
    await waitFor(() => {
      expect(screen.getByTestId("opencode-session-events")).toBeInTheDocument()
    })
    fireEvent.click(row)
    await waitFor(() => {
      expect(screen.queryByTestId("opencode-session-events")).not.toBeInTheDocument()
    })
  })

  it("shows an error when the detail fetch fails", async () => {
    useOpencodeSessionsMock.mockReturnValue({
      sessions: [baseSession],
      loading: false,
      error: null,
      generatedAt: new Date().toISOString(),
      live: false,
      refetch: vi.fn(),
    })
    fetchOpencodeSessionMock.mockRejectedValue(new Error("not found"))

    render(<OpencodeSessionList />)
    fireEvent.click(screen.getByTestId("opencode-session-ws-1"))

    await waitFor(() => {
      expect(screen.getByText(/not found/i)).toBeInTheDocument()
    })
  })

  it("calls refetch when the refresh button is clicked", () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    useOpencodeSessionsMock.mockReturnValue({
      sessions: [baseSession],
      loading: false,
      error: null,
      generatedAt: new Date().toISOString(),
      live: true,
      refetch,
    })
    render(<OpencodeSessionList />)
    const btn = screen.getByRole("button", { name: /refresh/i })
    fireEvent.click(btn)
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
