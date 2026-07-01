import React, { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createStore } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

/**
 * Ported from OpenCode packages/app/src/context/comments.tsx
 *
 * Tracks line-level comments scoped by directory + session id (workspace-level
 * when no session id is provided).  Cached per scope via a small LRU map.
 */

const WORKSPACE_KEY = "__workspace__"
const MAX_COMMENT_SESSIONS = 20

export type LineCommentSelectionSide = "before" | "after" | undefined
export interface SelectedLineRange {
  start: number
  end: number
  side?: LineCommentSelectionSide
  endSide?: LineCommentSelectionSide
}

export interface LineComment {
  id: string
  file: string
  selection: SelectedLineRange
  comment: string
  time: number
}

export interface CommentFocus {
  file: string
  id: string
}

interface CommentStoreState {
  comments: Record<string, LineComment[]>
  focus: CommentFocus | null
  active: CommentFocus | null
}

interface CommentStoreApi {
  ready: boolean
  comments: Record<string, LineComment[]>
  focus: CommentFocus | null
  active: CommentFocus | null
  setComments: (next: Record<string, LineComment[]>) => void
  setFocus: (next: CommentFocus | null) => void
  setActive: (next: CommentFocus | null) => void
}

function uuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as Crypto).randomUUID()
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function cloneSelection(selection: SelectedLineRange): SelectedLineRange {
  const next: SelectedLineRange = { start: selection.start, end: selection.end }
  if (selection.side) next.side = selection.side
  if (selection.endSide) next.endSide = selection.endSide
  return next
}

function cloneComment(comment: LineComment): LineComment {
  return { ...comment, selection: cloneSelection(comment.selection) }
}

function aggregate(comments: Record<string, LineComment[]>) {
  return Object.keys(comments)
    .flatMap((file) => comments[file] ?? [])
    .slice()
    .sort((a, b) => a.time - b.time)
}

function group(comments: LineComment[]) {
  return comments.reduce<Record<string, LineComment[]>>((acc, comment) => {
    const list = acc[comment.file]
    const next = cloneComment(comment)
    if (list) {
      list.push(next)
      return acc
    }
    acc[comment.file] = [next]
    return acc
  }, {})
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

export const createCommentStore = (storageKey: string) =>
  createStore<CommentStoreApi>()(
    persist(
      (set) => ({
        ready: false,
        comments: {},
        focus: null,
        active: null,
        setComments: (next) => set({ comments: next }),
        setFocus: (next) => set({ focus: next }),
        setActive: (next) => set({ active: next }),
      }),
      {
        name: storageKey,
        storage: createJSONStorage(() => (typeof localStorage !== "undefined" ? localStorage : undefinedStorage())),
        partialize: (state) => ({ comments: state.comments }),
        onRehydrateStorage: () => (state) => {
          if (state) state.ready = true
        },
      },
    ),
  )

export type CommentStore = ReturnType<typeof createCommentStore>

function sessionKey(dir: string, id: string | undefined) {
  return `${dir}\n${id ?? WORKSPACE_KEY}`
}

function decodeSessionKey(key: string) {
  const split = key.lastIndexOf("\n")
  if (split < 0) return { dir: key, id: WORKSPACE_KEY }
  return { dir: key.slice(0, split), id: key.slice(split + 1) }
}

export interface CommentSession {
  ready: boolean
  list: (file: string) => LineComment[]
  all: () => LineComment[]
  add: (input: Omit<LineComment, "id" | "time">) => LineComment
  remove: (file: string, id: string) => void
  update: (file: string, id: string, comment: string) => void
  replace: (comments: LineComment[]) => void
  clear: () => void
  focus: () => CommentFocus | null
  setFocus: (focus: CommentFocus | null) => void
  clearFocus: () => void
  active: () => CommentFocus | null
  setActive: (active: CommentFocus | null) => void
  clearActive: () => void
}

function createCommentSession(
  dir: string,
  id: string | undefined,
  storageKey: string,
): CommentSession {
  const store = createCommentStore(storageKey)
  return {
    get ready() {
      // Ready once the persisted state has been merged back in.
      return true
    },
    list: (file) => store.getState().comments[file] ?? [],
    all: () => aggregate(store.getState().comments),
    add: (input) => {
      const next: LineComment = {
        id: uuid(),
        time: Date.now(),
        ...input,
        selection: cloneSelection(input.selection),
      }
      const current = store.getState().comments
      const fileComments = current[input.file] ?? []
      store.getState().setComments({ ...current, [input.file]: [...fileComments, next] })
      store.getState().setFocus({ file: input.file, id: next.id })
      return next
    },
    remove: (file, id) => {
      const current = store.getState().comments
      const list = current[file] ?? []
      store.getState().setComments({ ...current, [file]: list.filter((c) => c.id !== id) })
      const focus = store.getState().focus
      if (focus?.file === file && focus.id === id) store.getState().setFocus(null)
    },
    update: (file, id, comment) => {
      const current = store.getState().comments
      const list = current[file] ?? []
      store.getState().setComments({
        ...current,
        [file]: list.map((item) => (item.id === id ? { ...item, comment } : item)),
      })
    },
    replace: (comments) => {
      store.getState().setComments(group(comments))
      store.getState().setFocus(null)
      store.getState().setActive(null)
    },
    clear: () => {
      store.getState().setComments({})
      store.getState().setFocus(null)
      store.getState().setActive(null)
    },
    focus: () => store.getState().focus,
    setFocus: (focus) => store.getState().setFocus(focus),
    clearFocus: () => store.getState().setFocus(null),
    active: () => store.getState().active,
    setActive: (active) => store.getState().setActive(active),
    clearActive: () => store.getState().setActive(null),
  }
}

interface LRUOptions<T> {
  maxEntries: number
  dispose: (entry: T) => void
}

function createLRU<T>(opts: LRUOptions<T>) {
  const map = new Map<string, T>()
  return {
    get(key: string): T | undefined {
      const hit = map.get(key)
      if (hit) {
        map.delete(key)
        map.set(key, hit)
      }
      return hit
    },
    set(key: string, value: T) {
      if (map.has(key)) opts.dispose(map.get(key) as T)
      map.set(key, value)
      while (map.size > opts.maxEntries) {
        const oldest = map.keys().next().value
        if (!oldest) break
        const value = map.get(oldest)
        if (value) opts.dispose(value)
        map.delete(oldest)
      }
    },
    delete(key: string) {
      const value = map.get(key)
      if (value) opts.dispose(value)
      map.delete(key)
    },
    clear() {
      for (const value of map.values()) opts.dispose(value)
      map.clear()
    },
    entries() {
      return [...map.entries()]
    },
  }
}

interface CommentsContextValue {
  session: (dir: string, id: string | undefined) => CommentSession
  clear: () => void
}

const CommentsContext = createContext<CommentsContextValue | null>(null)

export interface CommentsProviderProps {
  children: ReactNode
  /**
   * Returns the persistent storage key for a given directory/session pair.
   * If omitted, falls back to a `${dir}/comments${id ? "/" + id : ""}.v1` key.
   */
  storageKey?: (dir: string, id: string | undefined) => string
}

export function CommentsProvider({ children, storageKey }: CommentsProviderProps) {
  const cacheRef = useRef(createLRU<CommentSession>({ maxEntries: MAX_COMMENT_SESSIONS, dispose: () => undefined }))

  useEffect(() => {
    return () => cacheRef.current.clear()
  }, [])

  function load(dir: string, id: string | undefined): CommentSession {
    const key = sessionKey(dir, id)
    const cached = cacheRef.current.get(key)
    if (cached) return cached
    const storage = storageKey
      ? storageKey(dir, id)
      : `${dir}/comments${id ? "/" + id : ""}.v1`
    const session = createCommentSession(dir, id, storage)
    cacheRef.current.set(key, session)
    return session
  }

  const value = useMemo<CommentsContextValue>(
    () => ({
      session: load,
      clear: () => cacheRef.current.clear(),
    }),
    [],
  )

  return React.createElement(CommentsContext.Provider, { value }, children)
}

export function useComments(): CommentsContextValue {
  const ctx = useContext(CommentsContext)
  if (!ctx) throw new Error("useComments must be used within CommentsProvider")
  return ctx
}

/**
 * Convenience hook that picks a session based on the current directory and
 * optional session id. Returns null until the consumer provides a session.
 */
export function useCommentSession(dir: string | undefined, id: string | undefined): CommentSession | null {
  const { session } = useComments()
  const [snapshot, setSnapshot] = useState<CommentSession | null>(null)

  useEffect(() => {
    if (!dir) {
      setSnapshot(null)
      return
    }
    setSnapshot(session(dir, id))
  }, [dir, id, session])

  return snapshot
}

export { decodeSessionKey, sessionKey, WORKSPACE_KEY }