// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Onboarding store (ZCode first-run borrowing): which guided steps the
 * user has completed, whether they skipped the tour, and the derived
 * progress. Completion survives reloads via localStorage under
 * "maximilian.onboarding"; every storage touch is defensive (try/catch)
 * and the parser only accepts step ids from the known ONBOARDING_STEPS
 * list, so a stale or tampered payload can never wedge the flow.
 */
import { create } from "zustand"

export const ONBOARDING_STORAGE_KEY = "maximilian.onboarding"

/** The guided steps, in the order the tour shows them. */
export const ONBOARDING_STEPS = ["welcome", "connect", "workspace", "first-task"] as const

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

interface OnboardingDoc {
  completed: OnboardingStep[]
  skipped: boolean
}

function isStep(v: unknown): v is OnboardingStep {
  return typeof v === "string" && (ONBOARDING_STEPS as readonly string[]).includes(v)
}

/** Pure step set → doc (stable order, deduped). */
function docFromSteps(completed: ReadonlySet<string>, skipped: boolean): OnboardingDoc {
  return { completed: ONBOARDING_STEPS.filter((s) => completed.has(s)), skipped }
}

/** Defensive parse — unknown steps and junk shapes fall back to defaults. */
export function parseOnboardingDoc(raw: string | null | undefined): OnboardingDoc {
  if (!raw) return { completed: [], skipped: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { completed: [], skipped: false }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { completed: [], skipped: false }
  }
  const o = parsed as Record<string, unknown>
  const list = Array.isArray(o.completed) ? o.completed.filter(isStep) : []
  return docFromSteps(new Set(list), o.skipped === true)
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined
  } catch {
    return undefined
  }
}

/** Read persisted onboarding state; never throws. */
export function loadOnboardingDoc(storage: Storage | undefined = defaultStorage()): OnboardingDoc {
  if (!storage) return { completed: [], skipped: false }
  try {
    return parseOnboardingDoc(storage.getItem(ONBOARDING_STORAGE_KEY))
  } catch {
    return { completed: [], skipped: false }
  }
}

/** Write onboarding state to storage; never throws. */
export function persistOnboardingDoc(
  doc: OnboardingDoc,
  storage: Storage | undefined = defaultStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(doc))
  } catch {
    // Quota exceeded / storage disabled — progress simply stays in memory.
  }
}

/** Pure progress: 0..1, and a skipped tour counts as done. */
export function computeProgress(completed: readonly string[], skipped: boolean): number {
  if (skipped || completed.length >= ONBOARDING_STEPS.length) return 1
  return completed.length / ONBOARDING_STEPS.length
}

/** Pure "first incomplete step" — null when the tour is over. */
export function nextStep(completed: readonly string[], skipped: boolean): OnboardingStep | null {
  if (skipped) return null
  return ONBOARDING_STEPS.find((s) => !completed.includes(s)) ?? null
}

interface OnboardingState {
  completed: OnboardingStep[]
  skipped: boolean
  completeStep: (step: OnboardingStep) => void
  /** Undo a step (the back arrow inside the tour). */
  reopenStep: (step: OnboardingStep) => void
  /** Mark the whole tour skipped — implies isComplete. */
  skip: () => void
  /** Restart the tour from the beginning. */
  reset: () => void
}

export const useOnboardingStore = create<OnboardingState>((set) => {
  const initial = loadOnboardingDoc()
  const persist = (s: { completed: OnboardingStep[]; skipped: boolean }) =>
    persistOnboardingDoc({ completed: s.completed, skipped: s.skipped })
  return {
    completed: initial.completed,
    skipped: initial.skipped,
    completeStep: (step) =>
      set((s) => {
        if (!isStep(step) || s.completed.includes(step)) return s
        // Keep `completed` in tour order so in-memory state and the
        // persisted (parse-normalized) document always agree.
        const completed = ONBOARDING_STEPS.filter((st) => st === step || s.completed.includes(st))
        const next = { ...s, completed }
        persist(next)
        return next
      }),
    reopenStep: (step) =>
      set((s) => {
        if (!isStep(step) || !s.completed.includes(step)) return s
        const next = { ...s, completed: s.completed.filter((c) => c !== step) }
        persist(next)
        return next
      }),
    skip: () =>
      set((s) => {
        if (s.skipped) return s
        const next = { ...s, skipped: true }
        persist(next)
        return next
      }),
    reset: () =>
      set(() => {
        const fresh = { completed: [] as OnboardingStep[], skipped: false }
        persistOnboardingDoc(fresh)
        return fresh
      }),
  }
})

// ── Selector hooks ──────────────────────────────────────────────────────────

export const useOnboardingProgress = (): number =>
  useOnboardingStore((s) => computeProgress(s.completed, s.skipped))

export const useOnboardingComplete = (): boolean =>
  useOnboardingStore((s) => computeProgress(s.completed, s.skipped) === 1)

export const useCurrentOnboardingStep = (): OnboardingStep | null =>
  useOnboardingStore((s) => nextStep(s.completed, s.skipped))
