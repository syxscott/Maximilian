import React, { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createStore, useStore } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

/**
 * Ported from OpenCode packages/app/src/context/highlights.tsx
 *
 * Fetches the desktop changelog, parses release highlights, and shows a dialog
 * the first time the user launches a new version.  The port preserves the
 * version-marker behaviour and exposes a "from"/"to" range so consumers can
 * render the diff.
 */

const CHANGELOG_URL = "https://opencode.ai/changelog.json"

export interface HighlightMedia {
  type: "image" | "video"
  src: string
  alt: string
}

export interface Highlight {
  title: string
  description: string
  media?: HighlightMedia
}

interface ParsedRelease {
  tag?: string
  highlights: Highlight[]
}

interface HighlightsState {
  ready: boolean
  version?: string
  from?: string
  to?: string
  setVersion: (v: string | undefined) => void
  setRange: (from: string | undefined, to: string | undefined) => void
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

export const createHighlightsStore = (storageKey = "highlights.v1") =>
  createStore<HighlightsState>()(
    persist(
      (set) => ({
        ready: false,
        version: undefined,
        from: undefined,
        to: undefined,
        setVersion: (version) => set({ version }),
        setRange: (from, to) => set({ from, to }),
      }),
      {
        name: storageKey,
        storage: createJSONStorage(() => (typeof localStorage !== "undefined" ? localStorage : undefinedStorage())),
        onRehydrateStorage: () => (state) => {
          if (state) state.ready = true
        },
      },
    ),
  )

export type HighlightsStore = ReturnType<typeof createHighlightsStore>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const text = value.trim()
    return text.length > 0 ? text : undefined
  }
  if (typeof value === "number") return String(value)
  return
}

function normalizeVersion(value: string | undefined) {
  const text = value?.trim()
  if (!text) return
  return text.startsWith("v") || text.startsWith("V") ? text.slice(1) : text
}

function parseMedia(value: unknown, alt: string): HighlightMedia | undefined {
  if (!isRecord(value)) return
  const type = getText(value.type)?.toLowerCase()
  const src = getText(value.src) ?? getText(value.url)
  if (!src) return
  if (type !== "image" && type !== "video") return
  return { type, src, alt }
}

function parseHighlight(value: unknown): Highlight | undefined {
  if (!isRecord(value)) return
  const title = getText(value.title)
  if (!title) return
  const description = getText(value.description) ?? getText(value.shortDescription)
  if (!description) return
  const media = parseMedia(value.media, title)
  return { title, description, media }
}

function parseRelease(value: unknown): ParsedRelease | undefined {
  if (!isRecord(value)) return
  const tag = getText(value.tag) ?? getText(value.tag_name) ?? getText(value.name)

  if (!Array.isArray(value.highlights)) return { tag, highlights: [] }

  const highlights = value.highlights.flatMap((group) => {
    if (!isRecord(group)) return []
    const source = getText(group.source)
    if (!source) return []
    if (!source.toLowerCase().includes("desktop")) return []

    if (Array.isArray(group.items)) {
      return group.items
        .map((item) => parseHighlight(item))
        .filter((item): item is Highlight => item !== undefined)
    }
    const item = parseHighlight(group)
    return item ? [item] : []
  })

  return { tag, highlights }
}

function parseChangelog(value: unknown): ParsedRelease[] | undefined {
  if (Array.isArray(value)) {
    return value.map(parseRelease).filter((release): release is ParsedRelease => release !== undefined)
  }
  if (!isRecord(value)) return
  if (!Array.isArray(value.releases)) return
  return value.releases
    .map(parseRelease)
    .filter((release): release is ParsedRelease => release !== undefined)
}

function dedupeKey(highlight: Highlight) {
  return [highlight.title, highlight.description, highlight.media?.type ?? "", highlight.media?.src ?? ""].join("\n")
}

function sliceHighlights(input: { releases: ParsedRelease[]; current?: string; previous?: string }) {
  const current = normalizeVersion(input.current)
  const previous = normalizeVersion(input.previous)
  const releases = input.releases

  const start = (() => {
    if (!current) return 0
    const index = releases.findIndex((release) => normalizeVersion(release.tag) === current)
    return index === -1 ? 0 : index
  })()

  const end = (() => {
    if (!previous) return releases.length
    const index = releases.findIndex(
      (release, i) => i >= start && normalizeVersion(release.tag) === previous,
    )
    return index === -1 ? releases.length : index
  })()

  const highlights = releases.slice(start, end).flatMap((release) => release.highlights)
  const seen = new Set<string>()
  const unique = highlights.filter((highlight) => {
    const key = dedupeKey(highlight)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return unique.slice(0, 5)
}

export function loadReleaseHighlights(value: unknown, current?: string, previous?: string) {
  const releases = parseChangelog(value)
  if (!releases?.length) return []
  return sliceHighlights({ releases, current, previous })
}

interface HighlightsContextValue {
  store: HighlightsStore
  from: () => string | undefined
  to: () => string | undefined
  last: () => string | undefined
  markSeen: (version?: string) => void
}

const HighlightsContext = createContext<HighlightsContextValue | null>(null)

export interface HighlightsProviderProps {
  children: ReactNode
  /** Current platform version (e.g. from app metadata). */
  platformVersion?: string
  /** Whether to fetch and show release notes.  Defaults to true. */
  enabled?: boolean
  /** Replaceable fetch implementation (useful for tests/SSR). */
  fetcher?: typeof fetch
  /** Called with the parsed highlights when a new version is detected. */
  onHighlights?: (highlights: Highlight[]) => void
  /** Override the changelog URL (useful for self-hosted distribution). */
  changelogUrl?: string
}

export function HighlightsProvider({
  children,
  platformVersion,
  enabled = true,
  fetcher,
  onHighlights,
  changelogUrl = CHANGELOG_URL,
}: HighlightsProviderProps) {
  const [store] = useState(() => createHighlightsStore())
  const startedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const controllerRef = useRef<AbortController | null>(null)

  const ready = useStore(store, (s) => s.ready)
  const lastVersion = useStore(store, (s) => s.version)

  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  function markSeen(v?: string) {
    const target = v ?? platformVersion
    if (!target) return
    store.getState().setVersion(target)
  }

  useEffect(() => {
    if (!enabled) {
      markSeen(platformVersion)
      return
    }
    if (startedRef.current) return
    if (!ready) return
    if (!platformVersion) return
    startedRef.current = true

    const previous = lastVersion
    if (!previous) {
      markSeen(platformVersion)
      return
    }
    if (previous === platformVersion) return

    store.getState().setRange(previous, platformVersion)

    const fetchImpl = fetcher ?? (typeof fetch !== "undefined" ? fetch : undefined)
    if (!fetchImpl) return

    const controller = new AbortController()
    controllerRef.current = controller
    fetchImpl(changelogUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then((response) => (response.ok ? (response.json() as Promise<unknown>) : undefined))
      .then((json) => {
        if (!json) return
        const highlights = loadReleaseHighlights(json, platformVersion, previous)
        if (controller.signal.aborted) return
        if (highlights.length === 0) {
          markSeen(platformVersion)
          return
        }
        timerRef.current = setTimeout(() => {
          timerRef.current = undefined
          markSeen(platformVersion)
          onHighlights?.(highlights)
        }, 500)
      })
      .catch(() => undefined)
  }, [enabled, ready, platformVersion, lastVersion, fetcher, changelogUrl, store, onHighlights])

  const value = useMemo<HighlightsContextValue>(
    () => ({
      store,
      from: () => store.getState().from,
      to: () => store.getState().to,
      last: () => store.getState().version,
      markSeen,
    }),
    [store, platformVersion],
  )

  return React.createElement(HighlightsContext.Provider, { value }, children)
}

export function useHighlights(): HighlightsContextValue {
  const ctx = useContext(HighlightsContext)
  if (!ctx) throw new Error("useHighlights must be used within HighlightsProvider")
  return ctx
}