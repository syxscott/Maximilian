import React, { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { createStore, useStore } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

/**
 * Ported from OpenCode packages/app/src/context/settings.tsx
 *
 * SolidJS createStore -> Zustand store
 * SolidJS createMemo -> derived getters
 * SolidJS createEffect -> React useEffect
 * SolidJS createSimpleContext -> React Context + provider hook
 */

export interface NotificationSettings {
  agent: boolean
  permissions: boolean
  errors: boolean
}

export interface SoundSettings {
  agentEnabled: boolean
  agent: string
  permissionsEnabled: boolean
  permissions: string
  errorsEnabled: boolean
  errors: string
}

export interface Settings {
  general: {
    autoSave: boolean
    releaseNotes: boolean
    followup: "queue" | "steer"
    showFileTree: boolean
    showNavigation: boolean
    showSearch: boolean
    showStatus: boolean
    showTerminal: boolean
    showReasoningSummaries: boolean
    shellToolPartsExpanded: boolean
    editToolPartsExpanded: boolean
    showSessionProgressBar: boolean
    showCustomAgents: boolean
    newLayoutDesigns?: boolean
  }
  appearance: {
    fontSize: number
    mono: string
    sans: string
    terminal: string
  }
  keybinds: Record<string, string>
  permissions: {
    autoApprove: boolean
  }
  notifications: NotificationSettings
  sounds: SoundSettings
}

export const monoDefault = "System Mono"
export const sansDefault = "System Sans"
export const terminalDefault = "JetBrainsMono Nerd Font Mono"
export const newLayoutDesignsDefault = process.env.NODE_ENV !== "production"

const monoFallback =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
const sansFallback = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const terminalFallback =
  '"JetBrainsMono Nerd Font Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

const monoBase = monoFallback
const sansBase = sansFallback
const terminalBase = terminalFallback

function input(font: string | undefined) {
  return font ?? ""
}

function family(font: string) {
  if (/^[\w-]+$/.test(font)) return font
  return `"${font.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function stack(font: string | undefined, base: string) {
  const value = font?.trim() ?? ""
  if (!value) return base
  return `${family(value)}, ${base}`
}

export function monoInput(font: string | undefined) {
  return input(font)
}

export function sansInput(font: string | undefined) {
  return input(font)
}

export function monoFontFamily(font: string | undefined) {
  return stack(font, monoBase)
}

export function sansFontFamily(font: string | undefined) {
  return stack(font, sansBase)
}

export function terminalInput(font: string | undefined) {
  return input(font)
}

export function terminalFontFamily(font: string | undefined) {
  return stack(font, terminalBase)
}

export const defaultSettings: Settings = {
  general: {
    autoSave: true,
    releaseNotes: true,
    followup: "steer",
    showFileTree: false,
    showNavigation: false,
    showSearch: false,
    showStatus: false,
    showTerminal: false,
    showReasoningSummaries: false,
    shellToolPartsExpanded: false,
    editToolPartsExpanded: false,
    showSessionProgressBar: true,
    showCustomAgents: false,
  },
  appearance: {
    fontSize: 14,
    mono: "",
    sans: "",
    terminal: "",
  },
  keybinds: {},
  permissions: {
    autoApprove: false,
  },
  notifications: {
    agent: true,
    permissions: true,
    errors: false,
  },
  sounds: {
    agentEnabled: true,
    agent: "staplebops-01",
    permissionsEnabled: true,
    permissions: "staplebops-02",
    errorsEnabled: true,
    errors: "nope-03",
  },
}

interface SettingsState {
  ready: boolean
  settings: Settings
  // general
  setAutoSave: (value: boolean) => void
  setReleaseNotes: (value: boolean) => void
  setFollowup: (value: "queue" | "steer") => void
  setShowFileTree: (value: boolean) => void
  setShowNavigation: (value: boolean) => void
  setShowSearch: (value: boolean) => void
  setShowStatus: (value: boolean) => void
  setShowTerminal: (value: boolean) => void
  setShowReasoningSummaries: (value: boolean) => void
  setShellToolPartsExpanded: (value: boolean) => void
  setEditToolPartsExpanded: (value: boolean) => void
  setShowSessionProgressBar: (value: boolean) => void
  setShowCustomAgents: (value: boolean) => void
  setNewLayoutDesigns: (value: boolean) => void
  // appearance
  setFontSize: (value: number) => void
  setFont: (value: string) => void
  setUIFont: (value: string) => void
  setTerminalFont: (value: string) => void
  // keybinds
  setKeybind: (action: string, keybind: string) => void
  resetKeybind: (action: string) => void
  resetAllKeybinds: () => void
  // permissions
  setAutoApprove: (value: boolean) => void
  // notifications
  setAgentNotification: (value: boolean) => void
  setPermissionsNotification: (value: boolean) => void
  setErrorsNotification: (value: boolean) => void
  // sounds
  setAgentSoundEnabled: (value: boolean) => void
  setAgentSound: (value: string) => void
  setPermissionsSoundEnabled: (value: boolean) => void
  setPermissionsSound: (value: string) => void
  setErrorsSoundEnabled: (value: boolean) => void
  setErrorsSound: (value: string) => void
}

export const createSettingsStore = () =>
  createStore<SettingsState>()(
    persist(
      (set) => ({
        ready: false,
        settings: defaultSettings,
        setAutoSave: (value) =>
          set((state) => ({ settings: { ...state.settings, general: { ...state.settings.general, autoSave: value } } })),
        setReleaseNotes: (value) =>
          set((state) => ({
            settings: { ...state.settings, general: { ...state.settings.general, releaseNotes: value } },
          })),
        setFollowup: (value) =>
          set((state) => ({
            settings: {
              ...state.settings,
              general: { ...state.settings.general, followup: value === "queue" ? "steer" : value },
            },
          })),
        setShowFileTree: (value) =>
          set((state) => ({
            settings: { ...state.settings, general: { ...state.settings.general, showFileTree: value } },
          })),
        setShowNavigation: (value) =>
          set((state) => ({
            settings: { ...state.settings, general: { ...state.settings.general, showNavigation: value } },
          })),
        setShowSearch: (value) =>
          set((state) => ({
            settings: { ...state.settings, general: { ...state.settings.general, showSearch: value } },
          })),
        setShowStatus: (value) =>
          set((state) => ({
            settings: { ...state.settings, general: { ...state.settings.general, showStatus: value } },
          })),
        setShowTerminal: (value) =>
          set((state) => ({
            settings: { ...state.settings, general: { ...state.settings.general, showTerminal: value } },
          })),
        setShowReasoningSummaries: (value) =>
          set((state) => ({
            settings: { ...state.settings, general: { ...state.settings.general, showReasoningSummaries: value } },
          })),
        setShellToolPartsExpanded: (value) =>
          set((state) => ({
            settings: { ...state.settings, general: { ...state.settings.general, shellToolPartsExpanded: value } },
          })),
        setEditToolPartsExpanded: (value) =>
          set((state) => ({
            settings: { ...state.settings, general: { ...state.settings.general, editToolPartsExpanded: value } },
          })),
        setShowSessionProgressBar: (value) =>
          set((state) => ({
            settings: { ...state.settings, general: { ...state.settings.general, showSessionProgressBar: value } },
          })),
        setShowCustomAgents: (value) =>
          set((state) => ({
            settings: { ...state.settings, general: { ...state.settings.general, showCustomAgents: value } },
          })),
        setNewLayoutDesigns: (value) =>
          set((state) => ({
            settings: { ...state.settings, general: { ...state.settings.general, newLayoutDesigns: value } },
          })),
        setFontSize: (value) =>
          set((state) => ({
            settings: { ...state.settings, appearance: { ...state.settings.appearance, fontSize: value } },
          })),
        setFont: (value) =>
          set((state) => ({
            settings: {
              ...state.settings,
              appearance: { ...state.settings.appearance, mono: value.trim() ? value : "" },
            },
          })),
        setUIFont: (value) =>
          set((state) => ({
            settings: {
              ...state.settings,
              appearance: { ...state.settings.appearance, sans: value.trim() ? value : "" },
            },
          })),
        setTerminalFont: (value) =>
          set((state) => ({
            settings: {
              ...state.settings,
              appearance: { ...state.settings.appearance, terminal: value.trim() ? value : "" },
            },
          })),
        setKeybind: (action, keybind) =>
          set((state) => ({ settings: { ...state.settings, keybinds: { ...state.settings.keybinds, [action]: keybind } } })),
        resetKeybind: (action) =>
          set((state) => {
            if (!Object.prototype.hasOwnProperty.call(state.settings.keybinds, action)) return state
            const next = { ...state.settings.keybinds }
            delete next[action]
            return { settings: { ...state.settings, keybinds: next } }
          }),
        resetAllKeybinds: () => set((state) => ({ settings: { ...state.settings, keybinds: {} } })),
        setAutoApprove: (value) =>
          set((state) => ({
            settings: { ...state.settings, permissions: { ...state.settings.permissions, autoApprove: value } },
          })),
        setAgentNotification: (value) =>
          set((state) => ({
            settings: { ...state.settings, notifications: { ...state.settings.notifications, agent: value } },
          })),
        setPermissionsNotification: (value) =>
          set((state) => ({
            settings: { ...state.settings, notifications: { ...state.settings.notifications, permissions: value } },
          })),
        setErrorsNotification: (value) =>
          set((state) => ({
            settings: { ...state.settings, notifications: { ...state.settings.notifications, errors: value } },
          })),
        setAgentSoundEnabled: (value) =>
          set((state) => ({
            settings: { ...state.settings, sounds: { ...state.settings.sounds, agentEnabled: value } },
          })),
        setAgentSound: (value) =>
          set((state) => ({ settings: { ...state.settings, sounds: { ...state.settings.sounds, agent: value } } })),
        setPermissionsSoundEnabled: (value) =>
          set((state) => ({
            settings: { ...state.settings, sounds: { ...state.settings.sounds, permissionsEnabled: value } },
          })),
        setPermissionsSound: (value) =>
          set((state) => ({
            settings: { ...state.settings, sounds: { ...state.settings.sounds, permissions: value } },
          })),
        setErrorsSoundEnabled: (value) =>
          set((state) => ({
            settings: { ...state.settings, sounds: { ...state.settings.sounds, errorsEnabled: value } },
          })),
        setErrorsSound: (value) =>
          set((state) => ({
            settings: { ...state.settings, sounds: { ...state.settings.sounds, errors: value } },
          })),
      }),
      {
        name: "settings.v3",
        storage: createJSONStorage(() => (typeof localStorage !== "undefined" ? localStorage : undefinedStorage())),
        onRehydrateStorage: () => (state) => {
          if (state) state.ready = true
        },
      },
    ),
  )

function undefinedStorage(): Storage {
  // In-memory fallback for SSR / non-browser environments
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

export type SettingsStore = ReturnType<typeof createSettingsStore>

const SettingsContext = createContext<SettingsStore | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createSettingsStore())

  // Mirror SolidJS createEffect: reactively update CSS custom properties for fonts
  const mono = useStore(store, (s) => s.settings.appearance?.mono)
  const sans = useStore(store, (s) => s.settings.appearance?.sans)

  useEffect(() => {
    if (typeof document === "undefined") return
    const root = document.documentElement
    root.style.setProperty("--font-family-mono", monoFontFamily(mono))
    root.style.setProperty("--font-family-sans", sansFontFamily(sans))
  }, [mono, sans])

  return React.createElement(SettingsContext.Provider, { value: store }, children)
}

export function useSettings(): SettingsStore {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider")
  return ctx
}

/**
 * Helper API mirroring the SolidJS fluent interface.
 * Components / hooks can either use the store directly or wrap it through this
 * helper for ergonomic access.
 */
export function buildSettingsFacade(store: SettingsStore) {
  const s = () => store.getState().settings
  return {
    get ready() {
      return store.getState().ready
    },
    get current() {
      return s()
    },
    general: {
      get autoSave() {
        return s().general.autoSave ?? defaultSettings.general.autoSave
      },
      setAutoSave: (v: boolean) => store.getState().setAutoSave(v),
      get releaseNotes() {
        return s().general.releaseNotes ?? defaultSettings.general.releaseNotes
      },
      setReleaseNotes: (v: boolean) => store.getState().setReleaseNotes(v),
      get followup() {
        const v = s().general.followup
        return v === "queue" ? "steer" : v ?? defaultSettings.general.followup
      },
      setFollowup: (v: "queue" | "steer") => store.getState().setFollowup(v),
      get showFileTree() {
        return s().general.showFileTree ?? defaultSettings.general.showFileTree
      },
      setShowFileTree: (v: boolean) => store.getState().setShowFileTree(v),
      get showNavigation() {
        return s().general.showNavigation ?? defaultSettings.general.showNavigation
      },
      setShowNavigation: (v: boolean) => store.getState().setShowNavigation(v),
      get showSearch() {
        return s().general.showSearch ?? defaultSettings.general.showSearch
      },
      setShowSearch: (v: boolean) => store.getState().setShowSearch(v),
      get showStatus() {
        return s().general.showStatus ?? defaultSettings.general.showStatus
      },
      setShowStatus: (v: boolean) => store.getState().setShowStatus(v),
      get showTerminal() {
        return s().general.showTerminal ?? defaultSettings.general.showTerminal
      },
      setShowTerminal: (v: boolean) => store.getState().setShowTerminal(v),
      get showReasoningSummaries() {
        return s().general.showReasoningSummaries ?? defaultSettings.general.showReasoningSummaries
      },
      setShowReasoningSummaries: (v: boolean) => store.getState().setShowReasoningSummaries(v),
      get shellToolPartsExpanded() {
        return s().general.shellToolPartsExpanded ?? defaultSettings.general.shellToolPartsExpanded
      },
      setShellToolPartsExpanded: (v: boolean) => store.getState().setShellToolPartsExpanded(v),
      get editToolPartsExpanded() {
        return s().general.editToolPartsExpanded ?? defaultSettings.general.editToolPartsExpanded
      },
      setEditToolPartsExpanded: (v: boolean) => store.getState().setEditToolPartsExpanded(v),
      get showSessionProgressBar() {
        return s().general.showSessionProgressBar ?? defaultSettings.general.showSessionProgressBar
      },
      setShowSessionProgressBar: (v: boolean) => store.getState().setShowSessionProgressBar(v),
      get showCustomAgents() {
        return s().general.showCustomAgents ?? defaultSettings.general.showCustomAgents
      },
      setShowCustomAgents: (v: boolean) => store.getState().setShowCustomAgents(v),
      get newLayoutDesigns() {
        return s().general.newLayoutDesigns ?? newLayoutDesignsDefault
      },
      setNewLayoutDesigns: (v: boolean) => store.getState().setNewLayoutDesigns(v),
    },
    visibility: {
      get fileTree() {
        return !store.getState().settings.general.newLayoutDesigns || (s().general.showFileTree ?? false)
      },
      get search() {
        return !store.getState().settings.general.newLayoutDesigns || (s().general.showSearch ?? false)
      },
      get status() {
        return !store.getState().settings.general.newLayoutDesigns || (s().general.showStatus ?? false)
      },
      get customAgents() {
        return !store.getState().settings.general.newLayoutDesigns || (s().general.showCustomAgents ?? false)
      },
    },
    appearance: {
      get fontSize() {
        return s().appearance.fontSize ?? defaultSettings.appearance.fontSize
      },
      setFontSize: (v: number) => store.getState().setFontSize(v),
      get font() {
        return s().appearance.mono ?? defaultSettings.appearance.mono
      },
      setFont: (v: string) => store.getState().setFont(v),
      get uiFont() {
        return s().appearance.sans ?? defaultSettings.appearance.sans
      },
      setUIFont: (v: string) => store.getState().setUIFont(v),
      get terminalFont() {
        return s().appearance.terminal ?? defaultSettings.appearance.terminal
      },
      setTerminalFont: (v: string) => store.getState().setTerminalFont(v),
    },
    keybinds: {
      get: (action: string) => s().keybinds[action],
      set: (action: string, keybind: string) => store.getState().setKeybind(action, keybind),
      reset: (action: string) => store.getState().resetKeybind(action),
      resetAll: () => store.getState().resetAllKeybinds(),
    },
    permissions: {
      get autoApprove() {
        return s().permissions.autoApprove ?? defaultSettings.permissions.autoApprove
      },
      setAutoApprove: (v: boolean) => store.getState().setAutoApprove(v),
    },
    notifications: {
      get agent() {
        return s().notifications.agent ?? defaultSettings.notifications.agent
      },
      setAgent: (v: boolean) => store.getState().setAgentNotification(v),
      get permissions() {
        return s().notifications.permissions ?? defaultSettings.notifications.permissions
      },
      setPermissions: (v: boolean) => store.getState().setPermissionsNotification(v),
      get errors() {
        return s().notifications.errors ?? defaultSettings.notifications.errors
      },
      setErrors: (v: boolean) => store.getState().setErrorsNotification(v),
    },
    sounds: {
      get agentEnabled() {
        return s().sounds.agentEnabled ?? defaultSettings.sounds.agentEnabled
      },
      setAgentEnabled: (v: boolean) => store.getState().setAgentSoundEnabled(v),
      get agent() {
        return s().sounds.agent ?? defaultSettings.sounds.agent
      },
      setAgent: (v: string) => store.getState().setAgentSound(v),
      get permissionsEnabled() {
        return s().sounds.permissionsEnabled ?? defaultSettings.sounds.permissionsEnabled
      },
      setPermissionsEnabled: (v: boolean) => store.getState().setPermissionsSoundEnabled(v),
      get permissions() {
        return s().sounds.permissions ?? defaultSettings.sounds.permissions
      },
      setPermissions: (v: string) => store.getState().setPermissionsSound(v),
      get errorsEnabled() {
        return s().sounds.errorsEnabled ?? defaultSettings.sounds.errorsEnabled
      },
      setErrorsEnabled: (v: boolean) => store.getState().setErrorsSoundEnabled(v),
      get errors() {
        return s().sounds.errors ?? defaultSettings.sounds.errors
      },
      setErrors: (v: string) => store.getState().setErrorsSound(v),
    },
  }
}