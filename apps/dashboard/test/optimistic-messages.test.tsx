// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Optimistic user-message tests (OpenHands optimistic-user-message-store
 * borrowing): the store's queue semantics (echo consumption, workspace
 * scoping, error/Retry transitions, the 150s watchdog) plus the ChatPanel
 * rendering contract — faded "sending" bubbles above the composer, error
 * bubbles with Retry/Dismiss, and no cross-workspace leakage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { getDictionary, setLocale } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"
import {
  PENDING_MESSAGE_TIMEOUT_MS,
  registerPendingResend,
  retryPendingMessage,
  useOptimisticMessages,
} from "../src/lib/optimistic-messages"
import { useComposerDraftStore } from "../src/stores/composerDraftStore"
import { ChatPanel } from "../src/components/ChatPanel"
import type { Workspace } from "../src/api"

applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
setLocale("en-US")

const wsA: Workspace = {
  id: "ws-a",
  userRequest: "earlier request",
  status: "running",
  plan: null,
  results: [],
  review: null,
  error: null,
  createdAt: "2026-06-25T10:00:00Z",
}
const wsB: Workspace = { ...wsA, id: "ws-b" }

function resetStore(): void {
  useOptimisticMessages.getState().reset()
  registerPendingResend(null)
  // The composer draft store holds drafts IN MEMORY (localStorage.clear()
  // alone leaves them behind and pollutes the next mount's draft restore).
  for (const key of Object.keys(useComposerDraftStore.getState().drafts)) {
    useComposerDraftStore.getState().clearDraft(key)
  }
}

beforeEach(() => {
  localStorage.clear()
  resetStore()
})

afterEach(() => {
  cleanup()
  resetStore()
})

describe("optimistic message store", () => {
  it("enqueues a sending entry and binds it to a workspace later", () => {
    const id = useOptimisticMessages.getState().enqueue(null, "hello")
    expect(useOptimisticMessages.getState().pendingMessages).toEqual([
      { id, workspaceId: null, text: "hello", status: "sending" },
    ])
    useOptimisticMessages.getState().bindWorkspace(id, "ws-a")
    expect(useOptimisticMessages.getState().pendingMessages[0].workspaceId).toBe("ws-a")
  })

  it("consumes the echo by workspace id and trimmed content", () => {
    const state = useOptimisticMessages.getState()
    const id = state.enqueue("ws-a", "hello world")
    // A different workspace's echo must NOT consume it (不串台).
    expect(state.consumeEcho("ws-b", "hello world")).toBeNull()
    expect(useOptimisticMessages.getState().pendingMessages).toHaveLength(1)
    // Whitespace differences between client and server text don't block matching.
    expect(state.consumeEcho("ws-a", "  hello world ")).toBe(id)
    expect(useOptimisticMessages.getState().pendingMessages).toEqual([])
  })

  it("prefers a sending entry but a late echo still consumes an errored one", () => {
    const state = useOptimisticMessages.getState()
    state.enqueue("ws-a", "dup")
    const erroredId = state.enqueue("ws-a", "dup")
    state.markError(erroredId)
    const consumed = state.consumeEcho("ws-a", "dup")
    expect(consumed).not.toBeNull()
    expect(consumed).not.toBe(erroredId) // the sending entry was consumed first
    expect(useOptimisticMessages.getState().pendingMessages.map((m) => m.id)).toEqual([erroredId])
    expect(state.consumeEcho("ws-a", "dup")).toBe(erroredId)
    expect(useOptimisticMessages.getState().pendingMessages).toEqual([])
  })

  it("returns null (not a failure) when nothing matches", () => {
    const state = useOptimisticMessages.getState()
    state.enqueue("ws-a", "hello")
    expect(state.consumeEcho("ws-a", "different")).toBeNull()
    expect(state.consumeEcho("ws-a", "")).toBeNull()
    expect(useOptimisticMessages.getState().pendingMessages).toHaveLength(1)
  })

  it("flips a still-sending entry to error after the 150s watchdog", () => {
    vi.useFakeTimers()
    try {
      const state = useOptimisticMessages.getState()
      const id = state.enqueue("ws-a", "hello")
      act(() => {
        vi.advanceTimersByTime(PENDING_MESSAGE_TIMEOUT_MS - 1)
      })
      expect(useOptimisticMessages.getState().pendingMessages[0].status).toBe("sending")
      act(() => {
        vi.advanceTimersByTime(1)
      })
      const entry = useOptimisticMessages.getState().pendingMessages[0]
      expect(entry.status).toBe("error")
      expect(entry.errorMessage).toBe("Request timeout") // t("error.timeout")
      expect(entry.text).toBe("hello") // the text survives for the retry
      expect(id).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it("re-arms the watchdog on retry (markSending)", () => {
    vi.useFakeTimers()
    try {
      const state = useOptimisticMessages.getState()
      const id = state.enqueue("ws-a", "hello")
      act(() => {
        vi.advanceTimersByTime(PENDING_MESSAGE_TIMEOUT_MS)
      })
      expect(useOptimisticMessages.getState().pendingMessages[0].status).toBe("error")
      state.markSending(id)
      expect(useOptimisticMessages.getState().pendingMessages[0]).toMatchObject({
        status: "sending",
        errorMessage: undefined,
      })
      act(() => {
        vi.advanceTimersByTime(PENDING_MESSAGE_TIMEOUT_MS)
      })
      expect(useOptimisticMessages.getState().pendingMessages[0].status).toBe("error")
    } finally {
      vi.useRealTimers()
    }
  })

  it("retryPendingMessage re-sends through the registered transport", () => {
    const state = useOptimisticMessages.getState()
    const id = state.enqueue("ws-a", "hello")
    state.markError(id, "boom")
    const resend = vi.fn()
    registerPendingResend(resend)
    retryPendingMessage(id)
    expect(resend).toHaveBeenCalledWith("hello", id)
    expect(useOptimisticMessages.getState().pendingMessages[0].status).toBe("sending")
  })

  it("retry without a registered transport leaves the entry errored", () => {
    const state = useOptimisticMessages.getState()
    const id = state.enqueue("ws-a", "hello")
    state.markError(id, "boom")
    retryPendingMessage(id) // no transport registered
    expect(useOptimisticMessages.getState().pendingMessages[0].status).toBe("error")
  })

  it("retry is a no-op unless the entry is errored", () => {
    const resend = vi.fn()
    registerPendingResend(resend)
    const state = useOptimisticMessages.getState()
    const id = state.enqueue("ws-a", "hello")
    retryPendingMessage(id)
    expect(resend).not.toHaveBeenCalled()
    expect(useOptimisticMessages.getState().pendingMessages[0].status).toBe("sending")
  })
})

describe("ChatPanel pending bubbles", () => {
  it("renders the workspace's pending queue above the composer and filters others out", () => {
    const state = useOptimisticMessages.getState()
    const mine = state.enqueue("ws-a", "mine")
    state.enqueue("ws-b", "theirs") // another workspace's entry must not leak
    state.enqueue(null, "shell entry") // pre-workspace entry
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={wsA} />)
    const queue = screen.getByTestId("pending-user-messages")
    expect(queue.textContent).toContain("mine")
    expect(queue.textContent).not.toContain("theirs")
    expect(queue.textContent).not.toContain("shell entry")
    expect(screen.getByTestId("pending-user-message")).toHaveAttribute("data-status", "sending")
    expect(mine).toBeTruthy()
    // "Sending…" status label, no retry affordance while sending.
    expect(screen.getByTestId("pending-user-message").textContent).toContain("Sending")
    expect(screen.queryByTestId("pending-message-retry")).toBeNull()
  })

  it("shows pre-workspace entries only in the empty shell", () => {
    useOptimisticMessages.getState().enqueue(null, "first message")
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={null} />)
    expect(screen.getByTestId("pending-user-messages").textContent).toContain("first message")
  })

  it("renders error bubbles with Retry/Dismiss and the transport message", async () => {
    const state = useOptimisticMessages.getState()
    const id = state.enqueue("ws-a", "hello")
    state.markError(id, "500 Internal Server Error")
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={wsA} />)
    const row = screen.getByTestId("pending-user-message")
    expect(row).toHaveAttribute("data-status", "error")
    expect(row.textContent).toContain("hello")
    expect(row.textContent).toContain("500 Internal Server Error")
    expect(screen.getByTestId("pending-message-retry")).toBeEnabled()
    expect(screen.getByTestId("pending-message-dismiss")).toBeEnabled()
  })

  it("Retry flips the bubble back to sending through the registered transport", async () => {
    const user = userEvent.setup()
    const state = useOptimisticMessages.getState()
    const id = state.enqueue("ws-a", "hello")
    state.markError(id, "boom")
    const resend = vi.fn()
    registerPendingResend(resend)
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={wsA} />)
    await user.click(screen.getByTestId("pending-message-retry"))
    expect(resend).toHaveBeenCalledWith("hello", id)
    expect(screen.getByTestId("pending-user-message")).toHaveAttribute("data-status", "sending")
    expect(screen.queryByTestId("pending-message-retry")).toBeNull()
  })

  it("Dismiss removes the bubble and restores the text to an empty composer", async () => {
    const user = userEvent.setup()
    const state = useOptimisticMessages.getState()
    const id = state.enqueue("ws-a", "the lost words")
    state.markError(id, "boom")
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={wsA} />)
    await user.click(screen.getByTestId("pending-message-dismiss"))
    expect(screen.queryByTestId("pending-user-messages")).toBeNull()
    expect(useOptimisticMessages.getState().pendingMessages).toEqual([])
    // The composer (and its persisted draft) got the text back.
    expect(screen.getByRole("textbox")).toHaveValue("the lost words")
    expect(localStorage.getItem("maximilian.composer-drafts")).toContain("the lost words")
  })

  it("Dismiss keeps the composer untouched when the user is typing something else", async () => {
    const user = userEvent.setup()
    const state = useOptimisticMessages.getState()
    const id = state.enqueue("ws-a", "old message")
    state.markError(id, "boom")
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={wsA} />)
    const textarea = screen.getByRole("textbox")
    await user.type(textarea, "new draft")
    await user.click(screen.getByTestId("pending-message-dismiss"))
    expect(screen.queryByTestId("pending-user-messages")).toBeNull()
    expect(textarea).toHaveValue("new draft") // never clobbered
  })
})
