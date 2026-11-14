// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Composer send-history tests (opencode composer/history + TUI
 * draft-stash borrowing): consecutive-duplicate dedupe on push, failure
 * removal + composer backfill via the optimistic-bubble error path, the
 * localStorage persistence and the ↑/↓ recall sequence.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { act } from "react"
import { getDictionary, setLocale } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"
import {
  useComposerDraftStore,
  prependHistoryEntry,
  removeHistoryEntry,
  COMPOSER_HISTORIES_STORAGE_KEY,
  type ComposerHistoryEntry,
} from "../src/stores/composerDraftStore"
import { useOptimisticMessages } from "../src/lib/optimistic-messages"
import { ChatPanel } from "../src/components/ChatPanel"
import type { Workspace } from "../src/api"

// Isolate the composer/history behaviors from the (currently in-flight)
// conversation-timeline implementation: this suite targets the composer,
// not the timeline's render contract (covered by ChatPanel.test.tsx).
vi.mock("../src/components/ConversationTimeline", () => ({
  ConversationTimeline: () => <div data-testid="conversation-timeline" />,
}))

applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
setLocale("en-US")

const ws: Workspace = {
  id: "ws-1",
  userRequest: "whatever",
  status: "running",
  plan: null,
  results: [],
  review: null,
  error: null,
  createdAt: "2026-06-25T10:00:00Z",
}

beforeEach(() => {
  localStorage.clear()
  useComposerDraftStore.setState({ drafts: {}, histories: {} })
  useComposerDraftStore.getState().resetHistories()
  act(() => {
    useOptimisticMessages.getState().reset()
  })
})

afterEach(() => {
  cleanup()
  act(() => {
    useOptimisticMessages.getState().reset()
  })
})

describe("history entry model", () => {
  const e = (text: string, at = 1): ComposerHistoryEntry => ({ text, at })

  it("prependHistoryEntry skips empties, dedupes CONSECUTIVE repeats, caps length", () => {
    let entries: ComposerHistoryEntry[] = []
    entries = prependHistoryEntry(entries, "first")
    entries = prependHistoryEntry(entries, "second")
    entries = prependHistoryEntry(entries, "second") // consecutive dup — no change
    expect(entries.map((x) => x.text)).toEqual(["second", "first"])
    entries = prependHistoryEntry(entries, "first") // non-consecutive — kept
    expect(entries.map((x) => x.text)).toEqual(["first", "second", "first"])
    entries = prependHistoryEntry(entries, "   ") // empty — ignored
    expect(entries).toHaveLength(3)
    for (let i = 0; i < 150; i++) entries = prependHistoryEntry(entries, `n${i}`)
    expect(entries).toHaveLength(100)
  })

  it("removeHistoryEntry removes every match and keeps the reference when absent", () => {
    const entries = [e("a"), e("b"), e("a")]
    const next = removeHistoryEntry(entries, "a")
    expect(next.map((x) => x.text)).toEqual(["b"])
    expect(removeHistoryEntry(next, "missing")).toBe(next)
    expect(removeHistoryEntry(next, "")).toBe(next)
  })
})

describe("history store + persistence", () => {
  it("pushHistory/removeHistory drive the store and localStorage", () => {
    const { pushHistory, removeHistory } = useComposerDraftStore.getState()
    pushHistory("ws-1", "hello")
    pushHistory("ws-1", "hello again")
    expect(useComposerDraftStore.getState().histories["ws-1"]?.map((x) => x.text)).toEqual([
      "hello again",
      "hello",
    ])
    // persisted
    const persisted = parse(localStorage.getItem(COMPOSER_HISTORIES_STORAGE_KEY))
    expect(persisted["ws-1"]?.map((x) => x.text)).toEqual(["hello again", "hello"])
    removeHistory("ws-1", "hello again")
    expect(useComposerDraftStore.getState().histories["ws-1"]?.map((x) => x.text)).toEqual([
      "hello",
    ])
  })
})

function parse(raw: string | null): Record<string, ComposerHistoryEntry[]> {
  return raw === null ? {} : (JSON.parse(raw) as Record<string, ComposerHistoryEntry[]>)
}

describe("ChatPanel history integration", () => {
  it("a send that lands (echo consumed) enters history; ↑ recalls it", async () => {
    const user = userEvent.setup()
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={ws} />)
    const textarea = screen.getByPlaceholderText(/enter your request/i)

    // Simulate App's flow: an optimistic entry leaves the queue while
    // "sending" (echo consumed) → history push.
    act(() => {
      useOptimisticMessages.getState().enqueue("ws-1", "first message")
      useOptimisticMessages.getState().enqueue("ws-1", "second message")
    })
    const [id1, id2] = useOptimisticMessages.getState().pendingMessages.map((m) => m.id)
    act(() => {
      useOptimisticMessages.getState().remove(id1 ?? "")
      useOptimisticMessages.getState().remove(id2 ?? "")
    })
    expect(useComposerDraftStore.getState().histories["ws-1"]?.map((x) => x.text)).toEqual([
      "second message",
      "first message",
    ])

    // ↑ in the empty composer recalls the MOST RECENT send.
    await user.click(textarea)
    fireEvent.keyDown(textarea, { key: "ArrowUp" })
    expect(textarea).toHaveValue("second message")
    // ↑ again steps further back.
    fireEvent.keyDown(textarea, { key: "ArrowUp" })
    expect(textarea).toHaveValue("first message")
    // ↓ moves forward again.
    fireEvent.keyDown(textarea, { key: "ArrowDown" })
    expect(textarea).toHaveValue("second message")
    // ↓ past the newest clears the composer.
    fireEvent.keyDown(textarea, { key: "ArrowDown" })
    expect(textarea).toHaveValue("")
  })

  it("a FAILED send is pulled from history and backfills an empty composer", async () => {
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={ws} />)
    const textarea = screen.getByPlaceholderText(/enter your request/i)

    act(() => {
      useOptimisticMessages.getState().enqueue("ws-1", "doomed message")
    })
    const [id] = useOptimisticMessages.getState().pendingMessages.map((m) => m.id)
    // It "landed" briefly (echo consumption → history push)…
    act(() => {
      useOptimisticMessages.getState().remove(id ?? "")
    })
    expect(useComposerDraftStore.getState().histories["ws-1"]?.map((x) => x.text)).toEqual([
      "doomed message",
    ])
    // …then the send FAILED (separate act so the panel observes the
    // sending → error transition, like a real POST rejection).
    let restoredId = ""
    act(() => {
      restoredId = useOptimisticMessages.getState().enqueue("ws-1", "doomed message")
    })
    act(() => {
      useOptimisticMessages.getState().markError(restoredId)
    })
    // Composer was empty → the words come back automatically.
    expect(textarea).toHaveValue("doomed message")
    // And the failed send is NOT in the recall history.
    expect(useComposerDraftStore.getState().histories["ws-1"] ?? []).toEqual([])
  })

  it("typing cancels the recall; non-empty composer ignores bare ↑", async () => {
    const user = userEvent.setup()
    act(() => {
      useComposerDraftStore.getState().pushHistory("ws-1", "remembered")
    })
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={ws} />)
    const textarea = screen.getByPlaceholderText(/enter your request/i)
    // Non-empty composer: ↑ does not recall.
    await user.type(textarea, "x")
    fireEvent.keyDown(textarea, { key: "ArrowUp" })
    expect(textarea).toHaveValue("x")
    // Clear, recall, then type — editing cancels the recall cursor.
    await user.clear(textarea)
    fireEvent.keyDown(textarea, { key: "ArrowUp" })
    expect(textarea).toHaveValue("remembered")
    await user.type(textarea, "!")
    fireEvent.keyDown(textarea, { key: "ArrowDown" })
    // No recall cursor anymore: ↓ is a plain caret move (value untouched).
    expect(textarea).toHaveValue("remembered!")
  })

  it("recall is per workspace — another workspace's history is not addressable", async () => {
    const other: Workspace = { ...ws, id: "ws-2" }
    act(() => {
      useComposerDraftStore.getState().pushHistory("ws-2", "other ws message")
    })
    const view = render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={ws} />)
    const textarea = screen.getByPlaceholderText(/enter your request/i)
    fireEvent.keyDown(textarea, { key: "ArrowUp" })
    expect(textarea).toHaveValue("")
    view.unmount()
    render(<ChatPanel onSubmit={() => {}} submitting={false} workspace={other} />)
    const textarea2 = screen.getByPlaceholderText(/enter your request/i)
    fireEvent.keyDown(textarea2, { key: "ArrowUp" })
    expect(textarea2).toHaveValue("other ws message")
  })
})
