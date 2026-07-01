import React, { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createStore, useStore } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

/**
 * Ported from OpenCode packages/app/src/context/command.tsx
 *
 * Command palette + keybind registration. Pure-React conversion: store of
 * registrations, suspense-aware re-registration on every render, and an
 * effects-based keybind listener attached to `document`.
 */

const IS_MAC = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

const PALETTE_ID = "command.palette"
const DEFAULT_PALETTE_KEYBIND = "mod+shift+p"
const SUGGESTED_PREFIX = "suggested."
const EDITABLE_KEYBIND_IDS = new Set(["terminal.toggle", "terminal.new", "file.attach"])

type KeyLabel =
  | "common.key.ctrl"
  | "common.key.alt"
  | "common.key.shift"
  | "common.key.meta"
  | "common.key.space"
  | "common.key.backspace"
  | "common.key.enter"
  | "common.key.tab"
  | "common.key.delete"
  | "common.key.home"
  | "common.key.end"
  | "common.key.pageUp"
  | "common.key.pageDown"
  | "common.key.insert"
  | "common.key.esc"

export type Translator = (key: KeyLabel) => string

const FALLBACK_LABELS: Record<KeyLabel, string> = {
  "common.key.ctrl": "Ctrl",
  "common.key.alt": "Alt",
  "common.key.shift": "Shift",
  "common.key.meta": "Meta",
  "common.key.space": "Space",
  "common.key.backspace": "Backspace",
  "common.key.enter": "Enter",
  "common.key.tab": "Tab",
  "common.key.delete": "Delete",
  "common.key.home": "Home",
  "common.key.end": "End",
  "common.key.pageUp": "PageUp",
  "common.key.pageDown": "PageDown",
  "common.key.insert": "Insert",
  "common.key.esc": "Esc",
}

function keyText(key: KeyLabel, t?: Translator) {
  return t ? t(key) : FALLBACK_LABELS[key]
}

export function actionId(id: string) {
  if (!id.startsWith(SUGGESTED_PREFIX)) return id
  return id.slice(SUGGESTED_PREFIX.length)
}

function normalizeKey(key: string) {
  if (key === ",") return "comma"
  if (key === "+") return "plus"
  if (key === " ") return "space"
  return key.toLowerCase()
}

function signature(key: string, ctrl: boolean, meta: boolean, shift: boolean, alt: boolean) {
  const mask = (ctrl ? 1 : 0) | (meta ? 2 : 0) | (shift ? 4 : 0) | (alt ? 8 : 0)
  return `${key}:${mask}`
}

function signatureFromEvent(event: KeyboardEvent) {
  return signature(
    normalizeKey(event.key),
    event.ctrlKey,
    event.metaKey,
    event.shiftKey,
    event.altKey,
  )
}

function isAllowedEditableKeybind(id: string | undefined) {
  if (!id) return false
  return EDITABLE_KEYBIND_IDS.has(actionId(id))
}

export type KeybindConfig = string

export interface Keybind {
  key: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

export interface CommandOption {
  id: string
  title: string
  description?: string
  category?: string
  keybind?: KeybindConfig
  slash?: string
  suggested?: boolean
  disabled?: boolean
  hidden?: boolean
  onSelect?: (source?: "palette" | "keybind" | "slash") => void
  onHighlight?: () => (() => void) | void
}

export type CommandSource = "palette" | "keybind" | "slash"

export interface CommandCatalogItem {
  title: string
  description?: string
  category?: string
  keybind?: KeybindConfig
  slash?: string
  hidden?: boolean
}

export interface CommandRegistration {
  key?: string
  options: CommandOption[]
}

export function upsertCommandRegistration(registrations: CommandRegistration[], entry: CommandRegistration) {
  if (entry.key === undefined) return [entry, ...registrations]
  return [entry, ...registrations.filter((x) => x.key !== entry.key)]
}

export function parseKeybind(config: string): Keybind[] {
  if (!config || config === "none") return []

  return config.split(",").map((combo) => {
    const parts = combo.trim().toLowerCase().split("+")
    const keybind: Keybind = {
      key: "",
      ctrl: false,
      meta: false,
      shift: false,
      alt: false,
    }

    for (const part of parts) {
      switch (part) {
        case "ctrl":
        case "control":
          keybind.ctrl = true
          break
        case "meta":
        case "cmd":
        case "command":
          keybind.meta = true
          break
        case "mod":
          if (IS_MAC) keybind.meta = true
          else keybind.ctrl = true
          break
        case "alt":
        case "option":
          keybind.alt = true
          break
        case "shift":
          keybind.shift = true
          break
        default:
          keybind.key = part
          break
      }
    }

    return keybind
  })
}

export function matchKeybind(keybinds: Keybind[], event: KeyboardEvent): boolean {
  const eventKey = normalizeKey(event.key)

  for (const kb of keybinds) {
    const keyMatch = kb.key === eventKey
    const ctrlMatch = kb.ctrl === (event.ctrlKey || false)
    const metaMatch = kb.meta === (event.metaKey || false)
    const shiftMatch = kb.shift === (event.shiftKey || false)
    const altMatch = kb.alt === (event.altKey || false)

    if (keyMatch && ctrlMatch && metaMatch && shiftMatch && altMatch) {
      return true
    }
  }

  return false
}

function displayKeybindParts(kb: Keybind, t?: Translator) {
  const parts: string[] = []

  if (kb.ctrl) parts.push(IS_MAC ? "⌃" : keyText("common.key.ctrl", t))
  if (kb.alt) parts.push(IS_MAC ? "⌥" : keyText("common.key.alt", t))
  if (kb.shift) parts.push(IS_MAC ? "⇧" : keyText("common.key.shift", t))
  if (kb.meta) parts.push(IS_MAC ? "⌘" : keyText("common.key.meta", t))

  if (!kb.key) return parts

  const keys: Record<string, string> = {
    arrowup: "↑",
    arrowdown: "↓",
    arrowleft: "←",
    arrowright: "→",
    comma: ",",
    plus: "+",
  }
  const named: Record<string, KeyLabel> = {
    backspace: "common.key.backspace",
    delete: "common.key.delete",
    end: "common.key.end",
    enter: "common.key.enter",
    esc: "common.key.esc",
    escape: "common.key.esc",
    home: "common.key.home",
    insert: "common.key.insert",
    pagedown: "common.key.pageDown",
    pageup: "common.key.pageUp",
    space: "common.key.space",
    tab: "common.key.tab",
  }
  const key = kb.key.toLowerCase()
  const displayKey =
    keys[key] ??
    (named[key]
      ? keyText(named[key], t)
      : key.length === 1
        ? key.toUpperCase()
        : key.charAt(0).toUpperCase() + key.slice(1))
  parts.push(displayKey)

  return parts
}

export function formatKeybindParts(config: string, t?: Translator): string[] {
  if (!config || config === "none") return []
  const keybind = parseKeybind(config)[0]
  return keybind ? displayKeybindParts(keybind, t) : []
}

export function formatKeybind(config: string, t?: Translator): string {
  const parts = formatKeybindParts(config, t)
  if (parts.length === 0) return ""
  return IS_MAC ? parts.join("") : parts.join("+")
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.closest("[contenteditable='true']")) return true
  if (target.closest("input, textarea, select")) return true
  return false
}

interface CommandState {
  ready: boolean
  registrations: CommandRegistration[]
  suspendCount: number
  catalog: Record<string, CommandCatalogItem>
  setCatalog: (next: Record<string, CommandCatalogItem>) => void
  upsertRegistration: (entry: CommandRegistration) => void
  removeRegistration: (entry: CommandRegistration) => void
  setSuspended: (suspended: boolean) => void
}

function undefinedStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size
    },
  }
}

export const createCommandStore = () => {
  return createStore<CommandState>()(
    persist(
      (set, get) => ({
        ready: false,
        registrations: [],
        suspendCount: 0,
        catalog: {},
        setCatalog: (next) => set({ catalog: next }),
        upsertRegistration: (entry) => {
          const list = get().registrations
          set({ registrations: upsertCommandRegistration(list, entry) })
        },
        removeRegistration: (entry) => {
          set({ registrations: get().registrations.filter((x) => x !== entry) })
        },
        setSuspended: (suspended) =>
          set((s) => ({ suspendCount: Math.max(0, s.suspendCount + (suspended ? 1 : -1)) })),
      }),
      {
        name: "command.catalog.v1",
        storage: createJSONStorage(() => (typeof localStorage !== "undefined" ? localStorage : undefinedStorage())),
        onRehydrateStorage: () => (state) => {
          if (state) state.ready = true
        },
      },
    ),
  )
}

export type CommandStore = ReturnType<typeof createCommandStore>

interface CommandContextValue {
  store: CommandStore
  /**
   * Resolve keybind for a command (returns custom if overridden by settings,
   * otherwise the registered keybind).
   */
  resolveKeybind: (id: string) => string | undefined
  /** Currently visible command options (deduplicated). */
  options: () => CommandOption[]
  /** Catalog as recorded for persistence. */
  catalog: () => Record<string, CommandCatalogItem>
}

const CommandContext = createContext<CommandContextValue | null>(null)

export interface CommandProviderProps {
  children: ReactNode
  /**
   * Returns the user-customised keybind for an action id, if any.  The Maximilian
   * port leaves keybind storage inside `useSettings`; this bridge keeps the
   * dependency direction clean.
   */
  getCustomKeybind?: (actionId: string) => string | undefined
  /** Optional translator; falls back to English labels. */
  t?: Translator
  /** Optional label for the "suggested" category when listing options. */
  suggestedCategoryLabel?: string
  /** Called when the palette hotkey is pressed. */
  onShowPalette?: () => void
  /** Returns true if a modal dialog is currently active (suppresses hotkeys). */
  dialogActive?: () => boolean
}

export function CommandProvider(props: CommandProviderProps) {
  const { children, getCustomKeybind, t, suggestedCategoryLabel, onShowPalette, dialogActive } = props
  const [store] = useState(() => createCommandStore())
  const warnedDuplicates = useRef<Set<string>>(new Set())

  // Persist catalog whenever registrations change (post ready).
  const ready = useStore(store, (s) => s.ready)
  const registrations = useStore(store, (s) => s.registrations)

  const registered = useMemo<CommandOption[]>(() => {
    const seen = new Set<string>()
    const all: CommandOption[] = []
    for (const reg of registrations) {
      for (const opt of reg.options) {
        if (seen.has(opt.id)) {
          if (process.env.NODE_ENV !== "production" && !warnedDuplicates.current.has(opt.id)) {
            warnedDuplicates.current.add(opt.id)
            console.warn(`[command] duplicate command id "${opt.id}" registered; keeping first entry`)
          }
          continue
        }
        seen.add(opt.id)
        all.push(opt)
      }
    }
    return all
  }, [registrations])

  useEffect(() => {
    if (!ready) return
    const catalog: Record<string, CommandCatalogItem> = {}
    for (const opt of registered) {
      const id = actionId(opt.id)
      if (opt.title) {
        catalog[id] = {
          title: opt.title,
          description: opt.description,
          category: opt.category,
          keybind: opt.keybind,
          slash: opt.slash,
        }
      }
    }
    store.getState().setCatalog(catalog)
  }, [ready, registered, store])

  const bind = (id: string, def: KeybindConfig | undefined) => {
    const custom = getCustomKeybind?.(actionId(id))
    const config = custom ?? def
    if (!config || config === "none") return
    return config
  }

  const options = useMemo<CommandOption[]>(() => {
    const resolved = registered.map((opt) => ({
      ...opt,
      keybind: bind(opt.id, opt.keybind),
    }))

    const suggested = resolved.filter((x) => x.suggested && !x.disabled)
    return [
      ...suggested.map((x) => ({
        ...x,
        id: SUGGESTED_PREFIX + x.id,
        category: suggestedCategoryLabel ?? "Suggested",
      })),
      ...resolved,
    ]
  }, [registered, getCustomKeybind, suggestedCategoryLabel])

  const suspended = () => store.getState().suspendCount > 0

  const palette = useMemo(() => {
    const config = getCustomKeybind?.(PALETTE_ID) ?? DEFAULT_PALETTE_KEYBIND
    const keybinds = parseKeybind(config)
    return new Set(keybinds.map((kb) => signature(kb.key, kb.ctrl, kb.meta, kb.shift, kb.alt)))
  }, [getCustomKeybind])

  const keymap = useMemo(() => {
    const map = new Map<string, CommandOption>()
    for (const option of options) {
      if (option.id.startsWith(SUGGESTED_PREFIX)) continue
      if (option.disabled) continue
      if (!option.keybind) continue

      const parsed = parseKeybind(option.keybind)
      for (const kb of parsed) {
        if (!kb.key) continue
        const sig = signature(kb.key, kb.ctrl, kb.meta, kb.shift, kb.alt)
        if (map.has(sig)) continue
        map.set(sig, option)
      }
    }
    return map
  }, [options])

  const optionMap = useMemo(() => {
    const map = new Map<string, CommandOption>()
    for (const option of options) {
      map.set(option.id, option)
      map.set(actionId(option.id), option)
    }
    return map
  }, [options])

  function run(id: string, source?: CommandSource) {
    const option = optionMap.get(id)
    option?.onSelect?.(source)
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (suspended()) return
    if (dialogActive?.()) return

    const sig = signatureFromEvent(event)
    const isPalette = palette.has(sig)
    const option = keymap.get(sig)
    const modified = event.ctrlKey || event.metaKey || event.altKey
    const isTab = event.key === "Tab"

    if (
      isEditableTarget(event.target) &&
      !isPalette &&
      !isAllowedEditableKeybind(option?.id) &&
      !modified &&
      !isTab
    )
      return

    if (isPalette) {
      event.preventDefault()
      onShowPalette?.()
      return
    }

    if (!option) return
    event.preventDefault()
    option.onSelect?.("keybind")
  }

  useEffect(() => {
    if (typeof document === "undefined") return
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  })

  const value = useMemo<CommandContextValue>(
    () => ({
      store,
      resolveKeybind: (id) => {
        const base = actionId(id)
        const opt = options.find((x) => actionId(x.id) === base)
        return bind(base, opt?.keybind)
      },
      options: () => options,
      catalog: () => store.getState().catalog,
    }),
    [store, options],
  )

  return React.createElement(CommandContext.Provider, { value }, children)
}

export function useCommand(): CommandContextValue {
  const ctx = useContext(CommandContext)
  if (!ctx) throw new Error("useCommand must be used within CommandProvider")
  return ctx
}