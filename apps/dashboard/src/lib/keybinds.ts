// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Keybind utilities — the generic layer over the `Keybind` shape declared
 * in lib/commands.ts (ZCode keymap / useShortcutRecording borrowing).
 *
 * Three concerns live here, all pure and unit-tested:
 *  1. matching a keydown event against a Keybind (mod = Cmd on mac, Ctrl
 *     elsewhere) and formatting one for display;
 *  2. the recorder model: keydown → Keybind (bare modifiers ignored,
 *     unmodified printable keys rejected, Esc is the caller's cancel);
 *  3. the localStorage persistence model for user shortcut overrides
 *     ("maximilian.shortcut-overrides"), defensive against tampered JSON.
 *
 * The storage access is injected as a `StorageLike` so the model stays
 * testable without jsdom.
 */

import type { Keybind } from "@/lib/commands"

export type KeyPlatform = "mac" | "other"

/** The slice of KeyboardEvent the model needs — trivially fakeable in tests. */
export interface KeyEventLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

/** Minimal storage surface (window.localStorage satisfies it). */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"])

/** localStorage key for user shortcut overrides. */
export const SHORTCUT_OVERRIDES_KEY = "maximilian.shortcut-overrides"

/** Normalize an event key: single letters lowercase, " " → "space". */
export function normalizeKey(key: string): string {
  if (key === " ") return "space"
  return key.length === 1 ? key.toLowerCase() : key
}

export function isModifierOnly(e: KeyEventLike): boolean {
  return MODIFIER_KEYS.has(e.key)
}

/** Does the key act as `mod` on this platform? */
function modHeld(e: KeyEventLike, platform: KeyPlatform): boolean {
  return platform === "mac" ? !!e.metaKey : !!e.ctrlKey
}

/**
 * Match a keydown event against a Keybind. `mod` means Cmd on macOS and
 * Ctrl elsewhere; remaining modifiers must match exactly. Key comparison
 * is case-insensitive (Shift+letter vs the bound letter).
 */
export function matchKeybind(
  e: KeyEventLike,
  kb: Keybind,
  platform: KeyPlatform = "other",
): boolean {
  if (normalizeKey(e.key) !== normalizeKey(kb.key)) return false
  // A bind without `mod` must NOT fire while a mod key is held on the
  // platform's non-mod modifier either (Ctrl held on macOS must not turn
  // the plain bind "C" into a match).
  if (!kb.mod && (e.ctrlKey || e.metaKey)) return false
  if (!!kb.mod !== modHeld(e, platform)) return false
  if (!!kb.shift !== !!e.shiftKey) return false
  if (!!kb.alt !== !!e.altKey) return false
  return true
}

/** Extra display names for multi-char keys ("escape" → "Esc"). */
const DISPLAY_KEYS: Record<string, string> = {
  space: "Space",
  escape: "Esc",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  enter: "Enter",
  tab: "Tab",
  backspace: "⌫",
  delete: "Del",
  home: "Home",
  end: "End",
  pageup: "PgUp",
  pagedown: "PgDn",
}

/**
 * Format a Keybind for display — the generic counterpart of the
 * commands.ts formatter, aware of normalized keys ("space", "escape").
 * "⌘K" on macOS, "Ctrl+K" elsewhere.
 */
export function formatKeybind(kb: Keybind, platform: KeyPlatform = "other"): string {
  const parts: string[] = []
  if (kb.mod) parts.push(platform === "mac" ? "⌘" : "Ctrl")
  if (kb.shift) parts.push(platform === "mac" ? "⇧" : "Shift")
  if (kb.alt) parts.push(platform === "mac" ? "⌥" : "Alt")
  const normalized = normalizeKey(kb.key)
  const key =
    normalized.length === 1 ? normalized.toUpperCase() : (DISPLAY_KEYS[normalized] ?? kb.key)
  parts.push(key)
  return parts.join(platform === "mac" ? "" : "+")
}

/** Structural equality of two keybinds (after normalization). */
export function keybindEquals(a: Keybind, b: Keybind): boolean {
  return (
    normalizeKey(a.key) === normalizeKey(b.key) &&
    !!a.mod === !!b.mod &&
    !!a.shift === !!b.shift &&
    !!a.alt === !!b.alt
  )
}

/**
 * Convert a keydown event into a Keybind. Returns null for bare modifier
 * presses (Shift alone is not a shortcut). Either Ctrl or Meta maps to
 * `mod` so recordings stay platform-agnostic.
 */
export function eventToKeybind(e: KeyEventLike): Keybind | null {
  if (isModifierOnly(e)) return null
  const mod = e.ctrlKey || e.metaKey
  return {
    mod: mod || undefined,
    shift: e.shiftKey || undefined,
    alt: e.altKey || undefined,
    key: normalizeKey(e.key),
  }
}

/** Outcome of one keydown while the shortcut recorder is armed. */
export type RecorderOutcome =
  /** Esc without modifiers — the user backed out. */
  | { kind: "cancel" }
  /** A valid combo — capture it and stop recording. */
  | { kind: "capture"; keybind: Keybind }
  /** Bare modifier or unmodified printable key — keep waiting. */
  | { kind: "ignore" }

/** F-keys, arrows, Home/End… (anything longer than one char). */
function isNonPrintableKey(key: string): boolean {
  return normalizeKey(key).length > 1
}

/**
 * Pure recorder state machine: classify the next keydown while recording.
 * Esc cancels; bare modifiers and unmodified printable keys are ignored
 * (a shortcut that hijacks plain typing would be hostile); everything
 * else is captured.
 */
export function recorderOutcome(e: KeyEventLike): RecorderOutcome {
  if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    return { kind: "cancel" }
  }
  const keybind = eventToKeybind(e)
  if (!keybind) return { kind: "ignore" }
  const hasModifier = !!keybind.mod || !!keybind.alt
  if (!hasModifier && !isNonPrintableKey(keybind.key)) return { kind: "ignore" }
  return { kind: "capture", keybind }
}

/** Command id → recorded Keybind override. */
export type ShortcutOverrides = Record<string, Keybind>

function isKeybind(value: unknown): value is Keybind {
  if (value === null || typeof value !== "object") return false
  const kb = value as Record<string, unknown>
  if (typeof kb.key !== "string" || kb.key.length === 0) return false
  for (const flag of ["mod", "shift", "alt"] as const) {
    const v = kb[flag]
    if (v !== undefined && typeof v !== "boolean") return false
  }
  return true
}

/** Parse stored overrides JSON — malformed/tampered input yields {}. */
export function parseOverrides(raw: string | null | undefined): ShortcutOverrides {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {}
  const out: ShortcutOverrides = {}
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isKeybind(value)) out[id] = value
  }
  return out
}

/** Read overrides from storage (missing storage or quota errors → {}). */
export function readOverrides(storage: StorageLike | null | undefined): ShortcutOverrides {
  if (!storage || typeof storage.getItem !== "function") return {}
  try {
    return parseOverrides(storage.getItem(SHORTCUT_OVERRIDES_KEY))
  } catch {
    return {}
  }
}

/** Persist overrides; storage failures are swallowed (best-effort cache). */
export function writeOverrides(
  storage: StorageLike | null | undefined,
  overrides: ShortcutOverrides,
): void {
  if (!storage || typeof storage.setItem !== "function") return
  try {
    storage.setItem(SHORTCUT_OVERRIDES_KEY, JSON.stringify(overrides))
  } catch {
    // Ignore — private mode / quota exceeded; the UI state stays authoritative.
  }
}
