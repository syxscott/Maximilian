// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * App-level chat submit flow tests: the optimistic user-message lifecycle
 * (OpenHands borrowing) and the durable uplink ledger (ZCode registry
 * borrowing) wired through the REAL App submit path — chatApi.chat,
 * openWorkspaceStream, permissionsApi answers and the ledger's backing
 * storage are controlled by the test, everything in between is production
 * code. Covers the fixed P1s: a failed POST no longer loses the message
 * (error bubble + retry), the snapshot echo consumes the sending bubble,
 * the ledger clue is written before the uplink, and the keepalive loop
 * reconnects after a transport error but not after a terminal `done`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getDictionary, setLocale } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"
import { App } from "../src/App"
import { chatApi, openWorkspaceStream } from "../src/api"
import { permissionsApi } from "../src/lib/permissions"
import type { Workspace, WorkspaceStreamHandle } from "../src/api"
import { registerPendingResend, useOptimisticMessages } from "../src/lib/optimistic-messages"

applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
setLocale("en-US")

// The ledger's backing storage is controlled per-test (the App uses the
// exported singleton, so the module mock swaps in a test-scoped instance
// with the same factory — full isolation between tests).
const { ledgerStorage, ledgerState, ledgerData } = vi.hoisted(() => {
  const data = new Map<string, string>()
  const state = { failWrites: false, now: 0 }
  return {
    ledgerState: state,
    ledgerStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (state.failWrites) throw new Error("quota exceeded")
        data.set(key, value)
      },
      removeItem: (key: string) => {
        data.delete(key)
      },
    },
    ledgerData: data,
  }
})

// Mock ONLY the network entry points the submit flow uses; every other
// export (zod, schemas, fetchJson, …) stays real so the production wiring
// around them is exercised.
vi.mock("../src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api")>()
  return {
    ...actual,
    chatApi: {
      ...actual.chatApi,
      chat: vi.fn(),
      getWorkspace: vi.fn(),
    },
    permissionsApi: {
      ...actual.permissionsApi,
      answer: vi.fn(),
      answerApproval: vi.fn(),
    },
    openWorkspaceStream: vi.fn(),
  }
})

vi.mock("../src/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/permissions")>()
  return {
    ...actual,
    permissionsApi: {
      ...actual.permissionsApi,
      answer: vi.fn(),
      answerApproval: vi.fn(),
    },
  }
})

vi.mock("../src/lib/pending-uplinks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/pending-uplinks")>()
  return {
    ...actual,
    pendingUplinks: actual.createPendingUplinks({
      storage: ledgerStorage,
      now: () => ledgerState.now,
    }),
  }
})

const chatMock = vi.mocked(chatApi.chat)
const answerMock = vi.mocked(permissionsApi.answer)
const streamMock = vi.mocked(openWorkspaceStream)

const MESSAGE = "build me a todo app"

const wsFixture: Workspace = {
  id: "ws-1",
  userRequest: MESSAGE,
  status: "running",
  plan: null,
  results: [],
  review: null,
  error: null,
  createdAt: "2026-06-25T10:00:00Z",
}

type ChatResponse = { workspaceId: string; planId: string; status: string }

/** Deferred so tests assert the mid-flight states precisely. */
function makeDeferred<T>(): {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
} {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface CapturedStream {
  workspaceId: string
  onMessage: (data: Record<string, unknown>) => void
  onError: (err: unknown) => void
  onClose: () => void
  close: ReturnType<typeof vi.fn>
}

/** openWorkspaceStream mock capturing handlers; optionally errors after open. */
function captureStreams(opts?: { failAttempts?: number }): CapturedStream[] {
  const captured: CapturedStream[] = []
  let attempts = 0
  streamMock.mockImplementation((workspaceId, handlers) => {
    const close = vi.fn()
    captured.push({
      workspaceId,
      onMessage: handlers.onMessage,
      onError: handlers.onError ?? (() => {}),
      onClose: handlers.onClose ?? (() => {}),
      close,
    })
    attempts += 1
    if (opts?.failAttempts && attempts <= opts.failAttempts) {
      // Transport failure AFTER the open (async, like the real fetch impl):
      // onError followed by the close report that drives the keepalive loop.
      queueMicrotask(() => {
        handlers.onError?.(new Error("transport dropped"))
        handlers.onClose?.()
      })
    }
    return { close } as WorkspaceStreamHandle
  })
  return captured
}

function readLedger(): Array<Record<string, unknown>> {
  const raw = ledgerStorage.getItem("maximilian.pending-uplinks:v1")
  return raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : []
}

function renderApp(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
}

async function submitMessage(text: string): Promise<void> {
  const user = userEvent.setup()
  // The App surface hosts several text inputs (palette, settings panels…)
  // — always target the conversation composer by its placeholder.
  await user.type(screen.getByPlaceholderText(/enter your request/i), text)
  await user.click(screen.getByRole("button", { name: "Send" }))
}

beforeEach(() => {
  ledgerData.clear()
  ledgerState.failWrites = false
  // Advance past the 24h TTL: the ledger instance keeps stale entries in
  // memory across tests, and the next register's prune pass (anchored TTL)
  // drops them — test isolation through the ledger's own semantics.
  ledgerState.now += 25 * 60 * 60 * 1000
  useOptimisticMessages.getState().reset()
  registerPendingResend(null)
  chatMock.mockReset()
  answerMock.mockReset()
  streamMock.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "info").mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("App chat submit flow (optimistic bubble + uplink ledger)", () => {
  it("shows the message as a sending bubble immediately; a failed POST flips it to an error bubble with retry", async () => {
    const gate = makeDeferred<ChatResponse>()
    chatMock.mockImplementationOnce(() => gate.promise)
    captureStreams()
    renderApp()
    await submitMessage(MESSAGE)

    // Optimistic: the bubble renders while the POST is still in flight.
    expect(screen.getByTestId("pending-user-message")).toHaveAttribute("data-status", "sending")
    expect(screen.getByTestId("pending-user-message").textContent).toContain(MESSAGE)
    expect(chatMock).toHaveBeenCalledWith(MESSAGE, expect.anything())
    // Ledger: the clue was persisted BEFORE the uplink (still pending).
    expect(readLedger()).toHaveLength(1)

    gate.reject(new Error("500 backend exploded"))
    await waitFor(() => {
      expect(screen.getByTestId("pending-user-message")).toHaveAttribute("data-status", "error")
    })
    // The P1 fix: the message text survives in the error bubble with a
    // working retry. The send-history recovery (opencode draft-stash
    // borrowing) additionally RETURNS the failed words to the empty
    // composer automatically — a failed uplink never loses them, and its
    // history entry is pulled again.
    expect(screen.getByPlaceholderText(/enter your request/i)).toHaveValue(MESSAGE)
    expect(screen.getByTestId("pending-user-message").textContent).toContain(MESSAGE)
    expect(screen.getByTestId("pending-user-message").textContent).toContain("500 backend exploded")
    expect(screen.getByTestId("pending-message-retry")).toBeEnabled()
    // The clue stays (marked failed) — a client failure is not proof of
    // non-delivery; reconciliation or a retry settles it.
    expect(readLedger()).toMatchObject([{ kind: "chat", status: "failed" }])
    expect(JSON.stringify(readLedger())).toContain(MESSAGE)
  })

  it("retry re-POSTs the same text through the same submit path and re-arms the bubble", async () => {
    const first = makeDeferred<ChatResponse>()
    const second = makeDeferred<ChatResponse>()
    chatMock
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const streams = captureStreams()
    renderApp()
    await submitMessage(MESSAGE)
    first.reject(new Error("first attempt failed"))
    await waitFor(() => {
      expect(screen.getByTestId("pending-message-retry")).toBeEnabled()
    })
    await userEvent.click(screen.getByTestId("pending-message-retry"))

    expect(chatMock).toHaveBeenCalledTimes(2)
    expect(chatMock).toHaveBeenLastCalledWith(MESSAGE, expect.anything())
    // ONE bubble, back to sending — a retry never duplicates the entry,
    // and the ledger clue keeps its original id.
    expect(screen.getAllByTestId("pending-user-message")).toHaveLength(1)
    expect(screen.getByTestId("pending-user-message")).toHaveAttribute("data-status", "sending")

    // The retried POST lands: the ledger clue is closed, the snapshot echo
    // flips the App onto the new workspace and the bubble stays visible
    // there until the (already-delivered) echo consumed it — deliver the
    // echo AFTER the workspace flipped to assert the bound bubble shows.
    second.resolve({ workspaceId: "ws-1", planId: "p1", status: "planning" })
    // The FIRST attempt never opened a stream (its POST failed), so the
    // retried POST opens stream #1 — the keepalive loop's first connection.
    await waitFor(() => {
      expect(streamMock).toHaveBeenCalledTimes(1)
    })
    act(() => {
      streams[0].onMessage({ type: "workspace", workspace: wsFixture })
    })
    await waitFor(() => {
      expect(screen.queryByTestId("pending-user-messages")).toBeNull()
    })
    expect(readLedger()).toEqual([])
  })

  it("the workspace snapshot echo consumes the bubble and closes the ledger clue", async () => {
    const gate = makeDeferred<ChatResponse>()
    chatMock.mockImplementationOnce(() => gate.promise)
    const streams = captureStreams()
    renderApp()
    await submitMessage(MESSAGE)
    expect(screen.getByTestId("pending-user-message")).toHaveAttribute("data-status", "sending")
    expect(readLedger()).toHaveLength(1) // pending while in flight

    gate.resolve({ workspaceId: "ws-1", planId: "p1", status: "planning" })
    await waitFor(() => {
      expect(streamMock).toHaveBeenCalled()
    })
    expect(streams[0].workspaceId).toBe("ws-1")
    // The POST resolved — the ledger clue is closed out (server ack) even
    // though the bubble still waits for the UI-level echo.
    expect(readLedger()).toEqual([])

    // The echo: the snapshot frame carries workspace.userRequest.
    act(() => {
      streams[0].onMessage({ type: "workspace", workspace: wsFixture })
    })
    await waitFor(() => {
      expect(screen.queryByTestId("pending-user-messages")).toBeNull()
    })
  })

  it("a steering receipt retires the bubble immediately (no snapshot echo exists for steering)", async () => {
    const gate = makeDeferred<ChatResponse>()
    chatMock.mockImplementationOnce(() => gate.promise)
    captureStreams()
    renderApp()
    await submitMessage(MESSAGE)
    expect(screen.getByTestId("pending-user-message")).toHaveAttribute("data-status", "sending")

    gate.resolve({ workspaceId: "ws-1", planId: "p1", status: "steered" })
    await waitFor(() => {
      expect(screen.queryByTestId("pending-user-messages")).toBeNull()
    })
    expect(readLedger()).toEqual([])
  })

  it("a keepalive reconnect re-opens the stream after a transport error, but a terminal done does not", async () => {
    const gate = makeDeferred<ChatResponse>()
    chatMock.mockImplementationOnce(() => gate.promise)
    const streams = captureStreams({ failAttempts: 1 })
    renderApp()
    await submitMessage(MESSAGE)
    gate.resolve({ workspaceId: "ws-1", planId: "p1", status: "planning" })

    // First attempt fails → the keepalive loop schedules the retry (250ms).
    await waitFor(
      () => {
        expect(streamMock).toHaveBeenCalledTimes(2)
      },
      { timeout: 2_000 },
    )
    expect(streams[1].workspaceId).toBe("ws-1")

    // The second attempt delivers the snapshot echo, then the terminal done.
    act(() => {
      streams[1].onMessage({ type: "workspace", workspace: wsFixture })
      streams[1].onMessage({ type: "done" })
    })
    await waitFor(() => {
      expect(screen.queryByTestId("pending-user-messages")).toBeNull()
    })
    // done tears the stream down; the loop must NOT re-open it.
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(streamMock).toHaveBeenCalledTimes(2)
  }, 10_000)

  it("refuses the uplink entirely when the ledger cannot persist", async () => {
    ledgerState.failWrites = true
    renderApp()
    await submitMessage(MESSAGE)
    // Persistence failure → the uplink is refused (ZCode discipline).
    expect(chatMock).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByTestId("pending-user-message")).toHaveAttribute("data-status", "error")
    })
    expect(readLedger()).toEqual([])
  })

  it("registers a sensitive permission answer before the POST and closes it on the ACK", async () => {
    const gate = makeDeferred<ChatResponse>()
    chatMock.mockImplementationOnce(() => gate.promise)
    const streams = captureStreams()
    renderApp()
    await submitMessage(MESSAGE)
    gate.resolve({ workspaceId: "ws-1", planId: "p1", status: "planning" })
    await waitFor(() => {
      expect(streamMock).toHaveBeenCalled()
    })

    // Feed a permission-request through the stream and answer it.
    act(() => {
      streams[0].onMessage({
        type: "event",
        event: {
          type: "permission-request",
          requestId: "perm-1",
          workspaceId: "ws-1",
          taskId: "t1",
          tool: "bash",
          target: "rm -rf /tmp/x",
        },
      })
    })
    const allow = await screen.findByTestId("perm-dialog-allow")
    const answerDeferred = makeDeferred<{ requestId: string; decision: "allow" | "deny" }>()
    answerMock.mockImplementationOnce(() => answerDeferred.promise)
    fireEvent.click(allow)

    // The answer POST is the only consumer of the clue's ACK: it fired
    // exactly once (the dialog's dispatchAnswer + App's answerPermission
    // share the idempotent register — one clue, one POST).
    await waitFor(() => {
      expect(answerMock).toHaveBeenCalledTimes(1)
    })
    const pending = readLedger()
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ id: "perm-1", kind: "permission", sensitive: true })
    expect(JSON.stringify(pending)).not.toContain("rm -rf")

    answerDeferred.resolve({ requestId: "perm-1", decision: "allow" })
    // ACK accepted → the dialog closes only after the server acknowledged,
    // and the clue is closed out — nothing sensitive lingers.
    await waitFor(() => {
      expect(screen.queryByTestId("permission-dialog")).toBeNull()
    })
    expect(readLedger()).toEqual([])
  })
})
