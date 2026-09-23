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
 */
import { create } from "zustand"

export const COMPOSER_DRAFTS_STORAGE_KEY = "maximilian.composer-drafts"

type Drafts = Record<string, string>

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

interface ComposerDraftState {
  drafts: Drafts
  setDraft: (workspaceId: string, text: string) => void
  clearDraft: (workspaceId: string) => void
}

export const useComposerDraftStore = create<ComposerDraftState>((set) => ({
  drafts: loadDrafts(),
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
}))

/** Selector: the draft text for one workspace ("" when none). */
export const selectDraft =
  (workspaceId: string) =>
  (s: ComposerDraftState): string =>
    s.drafts[workspaceId] ?? ""
