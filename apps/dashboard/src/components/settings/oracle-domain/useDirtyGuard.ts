// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * useDirtyGuard — an unsaved-work confirmation gate (conductor
 * `SaveProtectionPrompt.tsx` borrowing, simplified for a single editor
 * surface). The caller supplies the pristine baseline and the live value;
 * the hook derives `dirty` (structural equality, no dependency) and gates
 * every action that would drop unsaved content behind a confirmation:
 *
 *   guard(action)  → runs immediately when clean; when dirty the action is
 *                    parked and the confirm dialog opens
 *   discard()      → user confirmed: run the parked action, drop the draft
 *   keepEditing()  → user cancelled: stay in the editor
 *
 * The confirm dialog itself is rendered by the consumer with the dashboard
 * Dialog primitives — the hook stays headless and jsdom-testable.
 */

import { useCallback, useRef, useState } from "react"

/**
 * Structural equality over JSON-ish values (primitives, plain objects,
 * arrays). No dependency: the baseline/current pairs used here are small,
 * so a bounded recursive compare beats pulling in fast-deep-equal.
 */
export function structuralEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (typeof a !== "object") return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b as Record<string, unknown>)
  if (aKeys.length !== bKeys.length) return false
  const bObj = b as Record<string, unknown>
  const aObj = a as Record<string, unknown>
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false
    if (!structuralEqual(aObj[key], bObj[key])) return false
  }
  return true
}

export interface DirtyGuardOptions<T> {
  /** The pristine snapshot the editor started from. */
  baseline: T
  /** The live value being edited. */
  current: T
  /** Equality check; defaults to {@link structuralEqual}. */
  isEqual?: (a: T, b: T) => boolean
}

export interface DirtyGuardApi<T> {
  /** True when `current` differs from `baseline` (unsaved work exists). */
  dirty: boolean
  /** Route every content-dropping transition through this. */
  guard: (action: () => void) => void
  /** True while the confirmation dialog should render. */
  confirmOpen: boolean
  /** Confirm: run the parked action, throwing the draft away. */
  discard: () => void
  /** Cancel: keep editing, drop the parked action. */
  keepEditing: () => void
}

export function useDirtyGuard<T>({
  baseline,
  current,
  isEqual = structuralEqual,
}: DirtyGuardOptions<T>): DirtyGuardApi<T> {
  const dirty = !isEqual(baseline, current)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  // Ref so guard() always sees the latest dirtiness even inside stale
  // closures (event handlers captured before the last keystroke).
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  const guard = useCallback((action: () => void) => {
    if (!dirtyRef.current) {
      action()
      return
    }
    setPendingAction(() => action)
  }, [])

  const discard = useCallback(() => {
    const action = pendingAction
    setPendingAction(null)
    action?.()
  }, [pendingAction])

  const keepEditing = useCallback(() => setPendingAction(null), [])

  return { dirty, guard, confirmOpen: pendingAction !== null, discard, keepEditing }
}
