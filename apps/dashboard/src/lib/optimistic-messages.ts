// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Optimistic user-message store (OpenHands
 * `src/stores/optimistic-user-message-store.ts` borrowing): a message the
 * user submitted renders IMMEDIATELY as a faded "sending" bubble instead
 * of only appearing once the backend stream echoes it. Before this store
 * a failed `POST /api/chat` cleared the composer and the draft store at
 * submit time, so the text was genuinely lost — the user retyped it from
 * memory.
 *
 * Mechanism (mirroring the reference):
 *   - Submit renders a "sending" bubble from the global queue; the queue
 *     is global but every entry carries the workspace id it was enqueued
 *     from, so the ChatPanel filters by the active workspace and messages
 *     never leak across a workspace switch.
 *   - The server echo is matched by content: the workspace snapshot frame
 *     carries `workspace.userRequest` (the backend's rendering of the
 *     submitted text — `Commander.plan(userRequest)` stores it verbatim),
 *     and a matching pending entry is consumed (removed). A late echo
 *     still consumes an errored entry (the send DID land).
 *   - A POST failure flips the entry to "error" with a retry affordance;
 *     retry goes back through the same submit path (App-registered
 *     transport below) and re-arms the "sending" state.
 *   - A `PENDING_MESSAGE_TIMEOUT_MS` watchdog flips a still-"sending"
 *     entry to "error" — guards against the "server crashed / stream
 *     dropped after the POST resolved, echo never arrives" scenario where
 *     the bubble would otherwise hang forever.
 *
 * Entries are in-memory only (a reload means the page is fresh; the
 * durable cross-reload record for the uplink itself lives in
 * `lib/pending-uplinks.ts`).
 */
import { create } from "zustand"
import { t } from "@max/i18n"

export type PendingUserMessageStatus = "sending" | "error"

export interface PendingUserMessage {
  id: string
  /**
   * The workspace this message belongs to. Null while the POST that will
   * create (or steer) the workspace is still in flight; bound to the
   * response's workspace id once it resolves. ChatPanel filters the
   * global queue by the active workspace id so switching workspaces never
   * carries pending bubbles over.
   */
  workspaceId: string | null
  /** User-visible bubble text (the trimmed message as submitted). */
  text: string
  status: PendingUserMessageStatus
  /** Populated on "error" (transport message or the watchdog timeout). */
  errorMessage?: string
}

/**
 * How long a pending message may stay in "sending" before it flips to
 * "error" with a retry affordance (OpenHands parity). Exported so tests
 * can drive it via fake timers without hard-coding the value.
 */
export const PENDING_MESSAGE_TIMEOUT_MS = 150_000

/**
 * Use a timestamp + random suffix instead of a module-level counter so ids
 * stay unique across test resets and don't accumulate state between runs
 * (OpenHands' generatePendingId borrowing; crypto.randomUUID is ideal but
 * a base36 suffix is the safer lowest common denominator).
 */
const generatePendingId = (): string =>
  `pending-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

// Watchdog timers per entry. If the echo never lands (stream dropped,
// server crashed, network partition), the entry flips to "error" so the
// user gets a retry affordance instead of a permanently-pinned
// "Sending…" bubble.
const watchdogs = new Map<string, ReturnType<typeof setTimeout>>()

function clearWatchdog(id: string): void {
  const timer = watchdogs.get(id)
  if (timer === undefined) return
  clearTimeout(timer)
  watchdogs.delete(id)
}

function scheduleWatchdog(id: string): void {
  clearWatchdog(id)
  watchdogs.set(
    id,
    setTimeout(() => {
      const entry = useOptimisticMessages.getState().pendingMessages.find((m) => m.id === id)
      if (entry?.status !== "sending") return
      useOptimisticMessages.getState().markError(id, t("error.timeout"))
    }, PENDING_MESSAGE_TIMEOUT_MS),
  )
}

interface OptimisticMessageState {
  pendingMessages: PendingUserMessage[]
  /**
   * Append a "sending" bubble for `text` tagged with the submitting
   * workspace (null = the pre-workspace shell). Returns the generated id
   * the caller binds to the POST outcome.
   */
  enqueue(workspaceId: string | null, text: string): string
  /** Bind a pending entry to the workspace the server assigned it. */
  bindWorkspace(id: string, workspaceId: string): void
  /** Re-arm a failed entry as "sending" (retry path) and reset its watchdog. */
  markSending(id: string): void
  /** Mark a pending message as failed (the API rejected it). */
  markError(id: string, errorMessage?: string): void
  /** Drop a pending message (echo confirmed, dismissed, or replaced). */
  remove(id: string): void
  /**
   * Match a server echo against the queue: prefer a "sending" entry, a
   * late echo may still consume an errored one. Matching is by workspace
   * id and trimmed content (OpenHands consumeMatchingPendingMessage
   * borrowing). Returns the consumed id, or null when nothing matches —
   * the caller must NOT treat a null as a failure.
   */
  consumeEcho(workspaceId: string, content: string): string | null
  /** Wipe the queue (test isolation). */
  reset(): void
}

export const useOptimisticMessages = create<OptimisticMessageState>((set, get) => ({
  pendingMessages: [],

  enqueue: (workspaceId, text) => {
    const id = generatePendingId()
    set((state) => ({
      pendingMessages: [
        ...state.pendingMessages,
        { id, workspaceId, text, status: "sending" as const },
      ],
    }))
    scheduleWatchdog(id)
    return id
  },

  bindWorkspace: (id, workspaceId) =>
    set((state) => ({
      pendingMessages: state.pendingMessages.map((m) => (m.id === id ? { ...m, workspaceId } : m)),
    })),

  markSending: (id) => {
    const entry = get().pendingMessages.find((m) => m.id === id)
    if (!entry || entry.status === "sending") return
    set((state) => ({
      pendingMessages: state.pendingMessages.map((m) =>
        m.id === id ? { ...m, status: "sending" as const, errorMessage: undefined } : m,
      ),
    }))
    scheduleWatchdog(id)
  },

  markError: (id, errorMessage) => {
    const entry = get().pendingMessages.find((m) => m.id === id)
    if (!entry || entry.status === "error") return
    clearWatchdog(id)
    set((state) => ({
      pendingMessages: state.pendingMessages.map((m) =>
        m.id === id ? { ...m, status: "error" as const, errorMessage } : m,
      ),
    }))
  },

  remove: (id) => {
    if (!get().pendingMessages.some((m) => m.id === id)) return
    clearWatchdog(id)
    set((state) => ({ pendingMessages: state.pendingMessages.filter((m) => m.id !== id) }))
  },

  consumeEcho: (workspaceId, content) => {
    const trimmed = content.trim()
    if (!trimmed) return null
    const matches = (m: PendingUserMessage): boolean =>
      m.workspaceId === workspaceId && m.text.trim() === trimmed
    const pending = get().pendingMessages
    // Prefer a sending attempt; an errored attempt may still receive a
    // late echo (OpenHands parity).
    let target = pending.find((m) => m.status === "sending" && matches(m))
    if (!target) target = pending.find(matches)
    if (!target) return null
    get().remove(target.id)
    return target.id
  },

  reset: () => {
    for (const id of [...watchdogs.keys()]) clearWatchdog(id)
    set({ pendingMessages: [] })
  },
}))

// ── Retry transport (OpenHands useSendMessage borrowing, adapted) ──────────
//
// The dock renders ChatPanel, so a retry cannot ride props from App; and
// the arch boundary forbids network access outside src/api.ts / src/hooks/.
// App (which owns chatApi) registers the retry transport once; the store
// invokes it on the user's Retry click. Kept as a plain module variable —
// it is a transport handle, not renderable state.

type ResendExecutor = (text: string, pendingId: string) => void

let resendExecutor: ResendExecutor | null = null

/** App registers the retry transport (its submit path) exactly once. */
export function registerPendingResend(executor: ResendExecutor | null): void {
  resendExecutor = executor
}

/**
 * Retry a failed pending message: flip it back to "sending" and hand it to
 * the registered transport. Without a registered transport (no App mounted
 * — e.g. a stray test) the entry returns to "error" instead of silently
 * pretending to retry.
 */
export function retryPendingMessage(id: string): void {
  const entry = useOptimisticMessages.getState().pendingMessages.find((m) => m.id === id)
  if (!entry || entry.status !== "error") return
  const executor = resendExecutor
  if (!executor) return
  useOptimisticMessages.getState().markSending(id)
  executor(entry.text, id)
}
