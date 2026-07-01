/**
 * File store — ported from OpenCode `context/file.tsx` (SolidJS) to React + Zustand.
 *
 * Tracks per-file editor state (loading/loaded/error/content) keyed by path,
 * and exposes view-related selectors (scroll position, selected lines) that
 * were previously managed through a separate view cache.
 */

import { create } from "zustand"

export type FileSelection = {
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}

export type SelectedLineRange = {
  startLine: number
  endLine: number
}

export type FileViewState = {
  scrollTop?: number
  scrollLeft?: number
  selectedLines?: SelectedLineRange | null
}

export type FileContent = string

export type FileState = {
  path: string
  name?: string
  loaded?: boolean
  loading?: boolean
  error?: string
  content?: FileContent
}

export type FileStoreState = {
  /** Keyed by normalized file path. */
  file: Record<string, FileState>
  /** Per-session view cache: directory + session id -> path -> view state. */
  view: Record<string, Record<string, FileViewState>>
}

export type FileStoreActions = {
  ensure: (file: string, name?: string) => void
  setLoading: (file: string) => void
  setLoaded: (file: string, content: FileContent | undefined) => void
  setError: (file: string, message: string) => void
  reset: () => void
  // View cache actions
  setScrollTop: (key: string, file: string, top: number) => void
  setScrollLeft: (key: string, file: string, left: number) => void
  setSelectedLines: (
    key: string,
    file: string,
    range: SelectedLineRange | null,
  ) => void
  resetViewKey: (key: string) => void
}

export type FileStore = FileStoreState & FileStoreActions

const initialState: FileStoreState = {
  file: {},
  view: {},
}

export const useFileStore = create<FileStore>()((set) => ({
  ...initialState,

  ensure: (file, name) =>
    set((state) => {
      if (state.file[file]) return state
      return {
        file: {
          ...state.file,
          [file]: { path: file, name },
        },
      }
    }),

  setLoading: (file) =>
    set((state) => {
      const current = state.file[file] ?? { path: file }
      return {
        file: {
          ...state.file,
          [file]: {
            ...current,
            loading: true,
            error: undefined,
          },
        },
      }
    }),

  setLoaded: (file, content) =>
    set((state) => {
      const current = state.file[file] ?? { path: file }
      return {
        file: {
          ...state.file,
          [file]: {
            ...current,
            loaded: true,
            loading: false,
            content,
          },
        },
      }
    }),

  setError: (file, message) =>
    set((state) => {
      const current = state.file[file] ?? { path: file }
      return {
        file: {
          ...state.file,
          [file]: {
            ...current,
            loading: false,
            error: message,
          },
        },
      }
    }),

  reset: () => set(() => ({ ...initialState })),

  setScrollTop: (key, file, top) =>
    set((state) => {
      const scope = state.view[key] ?? {}
      const current = scope[file] ?? {}
      return {
        view: {
          ...state.view,
          [key]: {
            ...scope,
            [file]: { ...current, scrollTop: top },
          },
        },
      }
    }),

  setScrollLeft: (key, file, left) =>
    set((state) => {
      const scope = state.view[key] ?? {}
      const current = scope[file] ?? {}
      return {
        view: {
          ...state.view,
          [key]: {
            ...scope,
            [file]: { ...current, scrollLeft: left },
          },
        },
      }
    }),

  setSelectedLines: (key, file, range) =>
    set((state) => {
      const scope = state.view[key] ?? {}
      const current = scope[file] ?? {}
      return {
        view: {
          ...state.view,
          [key]: {
            ...scope,
            [file]: { ...current, selectedLines: range },
          },
        },
      }
    }),

  resetViewKey: (key) =>
    set((state) => {
      const next = { ...state.view }
      delete next[key]
      return { view: next }
    }),
}))

// ----------------------------------------------------------------------------
// Pure helpers ported from OpenCode — used by selectors and components that
// interact with view state without subscribing to the entire file map.
// ----------------------------------------------------------------------------

export function selectionFromLines(
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number,
): FileSelection {
  return { startLine, startChar, endLine, endChar }
}

export function getFile(state: FileStoreState, file: string): FileState | undefined {
  return state.file[file]
}

export function getFileContent(
  state: FileStoreState,
  file: string,
): { state: FileState | undefined; hasContent: boolean } {
  const fileState = state.file[file]
  return {
    state: fileState,
    hasContent: fileState?.content !== undefined,
  }
}

export function scrollTop(
  state: FileStoreState,
  key: string,
  file: string,
): number | undefined {
  return state.view[key]?.[file]?.scrollTop
}

export function scrollLeft(
  state: FileStoreState,
  key: string,
  file: string,
): number | undefined {
  return state.view[key]?.[file]?.scrollLeft
}

export function selectedLines(
  state: FileStoreState,
  key: string,
  file: string,
): SelectedLineRange | null | undefined {
  return state.view[key]?.[file]?.selectedLines
}

export type FileNodeKind = "file" | "directory"

export type FileTreeNode = {
  name: string
  path: string
  kind: FileNodeKind
  children?: FileTreeNode[]
  expanded?: boolean
  loading?: boolean
}

export function emptyFileTree(): FileTreeNode {
  return { name: "", path: "", kind: "directory", children: [] }
}

export function toggleNode(node: FileTreeNode): FileTreeNode {
  return { ...node, expanded: !node.expanded }
}

export function findNode(nodes: FileTreeNode[], path: string): FileTreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node
    if (node.children) {
      const found = findNode(node.children, path)
      if (found) return found
    }
  }
  return undefined
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return fallback
}