// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * List-stabilization wiring tests (ZCode taskListItemStabilization
 * borrowing, consumed via ui-react's stabilizeList): the two dashboard
 * injection points — useOpencodeSessions snapshots and jobsStore
 * setJobs payloads — must reuse row/array references across equivalent
 * snapshots, so memoized consumers skip re-rendering (an activity
 * timestamp change re-renders its row only), and an echoed "job finished"
 * payload cannot double-notify.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { memo } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

import { fetchJson } from "../src/api"
import { useOpencodeSessions, type OpencodeSession } from "../src/hooks/useOpencodeSessions"
import { useJobsStore, type JobRecord } from "../src/stores/jobsStore"
import { useNotificationStore } from "../src/stores/notificationStore"

vi.mock("../src/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/api")>()
  return { ...mod, fetchJson: vi.fn() }
})

const mockFetchJson = vi.mocked(fetchJson)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ── useOpencodeSessions ─────────────────────────────────────────────────────

const session = (over: Partial<OpencodeSession> = {}): OpencodeSession => ({
  sessionId: "ws-1",
  aggregateId: "ws-1",
  status: "busy",
  messageCount: 3,
  toolCallCount: 1,
  lastEventAt: "2026-01-01T00:00:00.000Z",
  lastEventType: "message:part",
  ...over,
})

const payloadOf = (sessions: OpencodeSession[]) => ({
  count: sessions.length,
  generatedAt: new Date().toISOString(),
  sessions,
})

const sessionRenders = new Map<string, number>()
const SessionRow = memo(function SessionRow({ session }: { session: OpencodeSession }) {
  sessionRenders.set(session.sessionId, (sessionRenders.get(session.sessionId) ?? 0) + 1)
  return <li data-testid={`session-row-${session.sessionId}`}>{session.sessionId}</li>
})

function SessionsProbe() {
  const { sessions, refetch } = useOpencodeSessions({
    pollIntervalMs: 3_600_000,
    disableLive: true,
  })
  return (
    <div>
      <ul>
        {sessions.map((s) => (
          <SessionRow key={s.sessionId} session={s} />
        ))}
      </ul>
      <button type="button" data-testid="refetch" onClick={() => void refetch()} />
    </div>
  )
}

describe("useOpencodeSessions snapshot stabilization", () => {
  beforeEach(() => {
    sessionRenders.clear()
    mockFetchJson.mockReset()
  })

  it("an equivalent re-delivered snapshot re-renders no session row", async () => {
    mockFetchJson.mockResolvedValue(
      payloadOf([session(), session({ sessionId: "ws-2", status: "idle" })]),
    )
    render(<SessionsProbe />)
    // The mount poll delivers the first snapshot.
    await waitFor(() => expect(screen.getAllByTestId(/session-row-/)).toHaveLength(2))
    expect([...sessionRenders.entries()].sort()).toEqual([
      ["ws-1", 1],
      ["ws-2", 1],
    ])

    // Same content, freshly parsed objects (generatedAt advances — the
    // hook still re-renders, but the memoized rows must not).
    mockFetchJson.mockResolvedValue(
      payloadOf([session(), session({ sessionId: "ws-2", status: "idle" })]),
    )
    fireEvent.click(screen.getByTestId("refetch"))
    await waitFor(() => expect(mockFetchJson).toHaveBeenCalledTimes(2))
    expect([...sessionRenders.entries()].sort()).toEqual([
      ["ws-1", 1],
      ["ws-2", 1],
    ])
  })

  it("one activity timestamp bump re-renders exactly that row", async () => {
    mockFetchJson.mockResolvedValue(
      payloadOf([session(), session({ sessionId: "ws-2", status: "idle" })]),
    )
    render(<SessionsProbe />)
    await waitFor(() => expect(screen.getAllByTestId(/session-row-/)).toHaveLength(2))

    mockFetchJson.mockResolvedValue(
      payloadOf([
        session(),
        // ws-2's activity timestamp moved; ws-1 untouched.
        session({ sessionId: "ws-2", status: "idle", lastEventAt: "2026-01-01T00:05:00.000Z" }),
      ]),
    )
    fireEvent.click(screen.getByTestId("refetch"))
    await waitFor(() => expect(sessionRenders.get("ws-2")).toBe(2))
    expect(sessionRenders.get("ws-1")).toBe(1)
  })
})

// ── jobsStore ───────────────────────────────────────────────────────────────

const job = (over: Partial<JobRecord> = {}): JobRecord => ({
  id: "j1",
  name: "Nightly",
  kind: "scheduled",
  state: "running",
  ...over,
})

describe("jobsStore.setJobs stabilization", () => {
  beforeEach(() => {
    useJobsStore.getState().clear()
    useNotificationStore.getState().clear()
    localStorage.clear()
  })

  it("reuses the array reference for an equivalent re-injection", () => {
    useJobsStore.getState().setJobs([job()])
    const first = useJobsStore.getState().jobs
    // Freshly parsed copies of the same payload (conditional-spread key
    // order and undefined-vs-absent shapes included).
    useJobsStore.getState().setJobs([{ ...job(), durationMs: undefined }])
    expect(useJobsStore.getState().jobs).toBe(first)
  })

  it("reuses row references and swaps only the changed job", () => {
    useJobsStore.getState().setJobs([job(), job({ id: "j2", name: "Sweep" })])
    const prev = useJobsStore.getState().jobs
    useJobsStore
      .getState()
      .setJobs([job(), job({ id: "j2", name: "Sweep", state: "succeeded", lastRunAt: 100 })])
    const next = useJobsStore.getState().jobs
    expect(next).not.toBe(prev)
    expect(next[0]).toBe(prev[0])
    expect(next[1]).not.toBe(prev[1])
    expect(next[1]).toMatchObject({ state: "succeeded" })
  })

  it("never re-notifies an echoed finished run", () => {
    useJobsStore.getState().setJobs([job({ state: "running" })])
    const finished = () => [job({ state: "succeeded", lastRunAt: 100 })]
    useJobsStore.getState().setJobs(finished())
    const triggeredCount = () =>
      useNotificationStore
        .getState()
        .items.filter((n) => n.messageKey === "shell.notify.jobTriggered").length
    expect(triggeredCount()).toBe(1)
    // The same completion injected again (two injectors racing) is a
    // structural no-op — no duplicate toast.
    useJobsStore.getState().setJobs(finished())
    expect(triggeredCount()).toBe(1)
  })
})
