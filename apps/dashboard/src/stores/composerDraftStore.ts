// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Composer draft store (ZCode input-draft borrowing): one unsent message
 * draft per workspace, persisted to localStorage under
 * "maximilian.composer-drafts" so a reload never loses what the user was
 * typing. Every storage touch is wrapped in try/catch — private-mode
 * browsers and sandboxed iframes throw, and drafts are too cheap to
 * crash the app over.
 *
 * Send histories (opencode composer/history/entry.ts + TUI draft-stash.ts
 * borrowing): per-workspace sent-message recall. Entries prepend on a
 * CONFIRMED send (the optimistic bubble's server echo), consecutive
 * duplicates dedupe, and a FAILED send is removed again and returned to
 * the composer — a failed uplink never counts as history.
 */
import { create } from "zustand"

export const COMPOSER_DRAFTS_STORAGE_KEY = "maximilian.composer-drafts"
export const COMPOSER_HISTORIES_STORAGE_KEY = "maximilian.composer-histories"

type Drafts = Record<string, string>

/** One sent message in a workspace's recall history (newest first). */
export interface ComposerHistoryEntry {
  text: string
  /** Epoch ms the send landed. */
  at: number
}

type Histories = Record<string, ComposerHistoryEntry[]>

/** History length cap (opencode MAX_HISTORY borrowing, text-only here). */
export const MAX_HISTORY_ENTRIES = 100

/** Defensive parse — anything that is not a string→string map becomes {}. */
export function parseDrafts(raw: string | null | undefined): Drafts {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {}
  const out: Drafts = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof key === "string" && key !== "" && typeof value === "string") out[key] = value
  }
  return out
}

/** Defensive histories parse — string→entry[] maps with valid entries only. */
export function parseHistories(raw: string | null | undefined): Histories {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {}
  const out: Histories = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof key !== "string" || key === "" || !Array.isArray(value)) continue
    const entries: ComposerHistoryEntry[] = []
    for (const item of value.slice(0, MAX_HISTORY_ENTRIES)) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) continue
      const o = item as Record<string, unknown>
      const text = typeof o.text === "string" ? o.text : ""
      const at = typeof o.at === "number" && Number.isFinite(o.at) ? o.at : 0
      if (text !== "") entries.push({ text, at })
    }
    if (entries.length > 0) out[key] = entries
  }
  return out
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined
  } catch {
    return undefined
  }
}

/** Read drafts from storage; never throws. */
export function loadDrafts(storage: Storage | undefined = defaultStorage()): Drafts {
  if (!storage) return {}
  try {
    return parseDrafts(storage.getItem(COMPOSER_DRAFTS_STORAGE_KEY))
  } catch {
    return {}
  }
}

/** Write drafts to storage; never throws. */
export function persistDrafts(
  drafts: Drafts,
  storage: Storage | undefined = defaultStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(COMPOSER_DRAFTS_STORAGE_KEY, JSON.stringify(drafts))
  } catch {
    // Quota exceeded / storage disabled — drafts simply stay in memory.
  }
}

/** Read histories from storage; never throws. */
export function loadHistories(storage: Storage | undefined = defaultStorage()): Histories {
  if (!storage) return {}
  try {
    return parseHistories(storage.getItem(COMPOSER_HISTORIES_STORAGE_KEY))
  } catch {
    return {}
  }
}

/** Write histories to storage; never throws. */
export function persistHistories(
  histories: Histories,
  storage: Storage | undefined = defaultStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(COMPOSER_HISTORIES_STORAGE_KEY, JSON.stringify(histories))
  } catch {
    // Storage unavailable — recall still works for this page lifetime.
  }
}

/**
 * Prepend one sent message (opencode prependHistoryEntry borrowing):
 * empty text is ignored, a CONSECUTIVE duplicate keeps the list stable,
 * length capped at MAX_HISTORY_ENTRIES. Returns the same array reference
 * when nothing changed so zustand can skip the update.
 */
export function prependHistoryEntry(
  entries: ComposerHistoryEntry[],
  text: string,
  now = Date.now(),
): ComposerHistoryEntry[] {
  const trimmed = text.trim()
  if (trimmed === "") return entries
  const first = entries[0]
  if (first !== undefined && first.text === trimmed) return entries
  return [{ text: trimmed, at: now }, ...entries].slice(0, MAX_HISTORY_ENTRIES)
}

/**
 * Remove every entry matching the text (opencode removeHistoryEntry
 * borrowing): a send that FAILED returns to the composer, so keeping its
 * history entry would only duplicate the draft. Same-reference parity.
 */
export function removeHistoryEntry(
  entries: ComposerHistoryEntry[],
  text: string,
): ComposerHistoryEntry[] {
  const trimmed = text.trim()
  if (trimmed === "") return entries
  const next = entries.filter((entry) => entry.text !== trimmed)
  return next.length === entries.length ? entries : next
}

interface ComposerDraftState {
  drafts: Drafts
  histories: Histories
  setDraft: (workspaceId: string, text: string) => void
  clearDraft: (workspaceId: string) => void
  /** A send LANDED (server echo) — record it for ↑ recall. */
  pushHistory: (workspaceId: string, text: string) => void
  /** A send FAILED — remove it from the recall history. */
  removeHistory: (workspaceId: string, text: string) => void
  /** Wipe histories (test isolation). */
  resetHistories: () => void
}

export const useComposerDraftStore = create<ComposerDraftState>((set) => ({
  drafts: loadDrafts(),
  histories: loadHistories(),
  setDraft: (workspaceId, text) =>
    set((s) => {
      const drafts = { ...s.drafts, [workspaceId]: text }
      persistDrafts(drafts)
      return { drafts }
    }),
  clearDraft: (workspaceId) =>
    set((s) => {
      if (!(workspaceId in s.drafts)) return s
      const drafts = { ...s.drafts }
      delete drafts[workspaceId]
      persistDrafts(drafts)
      return { drafts }
    }),
  pushHistory: (workspaceId, text) =>
    set((s) => {
      const next = prependHistoryEntry(s.histories[workspaceId] ?? [], text)
      if (next === s.histories[workspaceId]) return s
      const histories = { ...s.histories, [workspaceId]: next }
      persistHistories(histories)
      return { histories }
    }),
  removeHistory: (workspaceId, text) =>
    set((s) => {
      const current = s.histories[workspaceId]
      if (current === undefined) return s
      const next = removeHistoryEntry(current, text)
      if (next === current) return s
      const histories = { ...s.histories, [workspaceId]: next }
      persistHistories(histories)
      return { histories }
    }),
  resetHistories: () =>
    set(() => {
      persistHistories({})
      return { histories: {} }
    }),
}))

/** Selector: the draft text for one workspace ("" when none). */
export const selectDraft =
  (workspaceId: string) =>
  (s: ComposerDraftState): string =>
    s.drafts[workspaceId] ?? ""

/** Selector: the recall history for one workspace ([] when none). */
export const selectHistory =
  (workspaceId: string) =>
  (s: ComposerDraftState): ComposerHistoryEntry[] =>
    s.histories[workspaceId] ?? []
