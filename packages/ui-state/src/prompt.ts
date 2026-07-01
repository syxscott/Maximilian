/**
 * Prompt store — ported from OpenCode `context/prompt.tsx` (SolidJS) to React + Zustand.
 *
 * Tracks a draft prompt (rich content parts), the cursor position, and
 * per-session/context file attachments. A lightweight cache layer (mirroring
 * the SolidJS createRoot approach) keys prompt state by draftID or session.
 */

import { create } from "zustand"

export type FileSelection = {
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}

export type TextPart = {
  type: "text"
  content: string
  start: number
  end: number
}

export type FileAttachmentPart = {
  type: "file"
  content: string
  start: number
  end: number
  path: string
  selection?: FileSelection
}

export type AgentPart = {
  type: "agent"
  content: string
  start: number
  end: number
  name: string
}

export type ImageAttachmentPart = {
  type: "image"
  id: string
  filename: string
  sourcePath?: string
  mime: string
  dataUrl: string
}

export type ContentPart = TextPart | FileAttachmentPart | AgentPart | ImageAttachmentPart
export type Prompt = ContentPart[]

export type FileContextItem = {
  type: "file"
  path: string
  selection?: FileSelection
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
  preview?: string
}

export type ContextItem = FileContextItem

export type ContextItemWithKey = ContextItem & { key: string }

export type PromptStoreState = {
  prompt: Prompt
  cursor?: number
  context: {
    items: ContextItemWithKey[]
  }
}

export const DEFAULT_PROMPT: Prompt = [
  { type: "text", content: "", start: 0, end: 0 },
]

export type PromptStoreActions = {
  setPrompt: (prompt: Prompt, cursorPosition?: number) => void
  resetPrompt: () => void
  addContextItem: (item: ContextItem) => void
  removeContextItem: (key: string) => void
  removeComment: (path: string, commentID: string) => void
  updateComment: (
    path: string,
    commentID: string,
    patch: Partial<FileContextItem> & { comment?: string },
  ) => void
  replaceComments: (items: FileContextItem[]) => void
  reset: () => void
}

export type PromptStore = PromptStoreState & PromptStoreActions

const freshState = (): PromptStoreState => ({
  prompt: clonePrompt(DEFAULT_PROMPT),
  cursor: undefined,
  context: { items: [] },
})

export const usePromptStore = create<PromptStore>()((set) => ({
  ...freshState(),

  setPrompt: (prompt, cursorPosition) =>
    set(() => ({
      prompt: clonePrompt(prompt),
      cursor: cursorPosition,
    })),

  resetPrompt: () =>
    set(() => ({
      prompt: clonePrompt(DEFAULT_PROMPT),
      cursor: 0,
    })),

  addContextItem: (item) =>
    set((state) => {
      const key = contextItemKey(item)
      if (state.context.items.find((x) => x.key === key)) return state
      return {
        context: {
          items: [...state.context.items, { key, ...item }],
        },
      }
    }),

  removeContextItem: (key) =>
    set((state) => ({
      context: {
        items: state.context.items.filter((x) => x.key !== key),
      },
    })),

  removeComment: (path, commentID) =>
    set((state) => ({
      context: {
        items: state.context.items.filter(
          (item) =>
            !(item.type === "file" && item.path === path && item.commentID === commentID),
        ),
      },
    })),

  updateComment: (path, commentID, patch) =>
    set((state) => ({
      context: {
        items: state.context.items.map((item) => {
          if (item.type !== "file" || item.path !== path || item.commentID !== commentID) {
            return item
          }
          const value = { ...item, ...patch }
          return { ...value, key: contextItemKey(value) }
        }),
      },
    })),

  replaceComments: (items) =>
    set((state) => ({
      context: {
        items: [
          ...state.context.items.filter((item) => !isCommentItem(item)),
          ...items.map((item) => ({ ...item, key: contextItemKey(item) })),
        ],
      },
    })),

  reset: () => set(() => freshState()),
}))

// ----------------------------------------------------------------------------
// Pure helpers ported verbatim from OpenCode — used by the store and available
// to React components that need to inspect prompts without subscribing.
// ----------------------------------------------------------------------------

export function isSelectionEqual(a?: FileSelection, b?: FileSelection): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return (
    a.startLine === b.startLine &&
    a.startChar === b.startChar &&
    a.endLine === b.endLine &&
    a.endChar === b.endChar
  )
}

export function isPartEqual(partA: ContentPart, partB: ContentPart): boolean {
  switch (partA.type) {
    case "text":
      return partB.type === "text" && partA.content === partB.content
    case "file":
      return (
        partB.type === "file" &&
        partA.path === partB.path &&
        isSelectionEqual(partA.selection, partB.selection)
      )
    case "agent":
      return partB.type === "agent" && partA.name === partB.name
    case "image":
      return partB.type === "image" && partA.id === partB.id
  }
}

export function isPromptEqual(promptA: Prompt, promptB: Prompt): boolean {
  if (promptA.length !== promptB.length) return false
  for (let i = 0; i < promptA.length; i++) {
    const partA = promptA[i]
    const partB = promptB[i]
    if (!partA || !partB) return false
    if (!isPartEqual(partA, partB)) return false
  }
  return true
}

export function clonePrompt(prompt: Prompt): Prompt {
  return prompt.map(clonePart)
}

function cloneSelection(selection?: FileSelection): FileSelection | undefined {
  if (!selection) return undefined
  return { ...selection }
}

function clonePart(part: ContentPart): ContentPart {
  if (part.type === "text") return { ...part }
  if (part.type === "image") return { ...part }
  if (part.type === "agent") return { ...part }
  return { ...part, selection: cloneSelection(part.selection) }
}

export function contextItemKey(item: ContextItem): string {
  if (item.type !== "file") return item.type
  const start = item.selection?.startLine
  const end = item.selection?.endLine
  const key = `${item.type}:${item.path}:${start}:${end}`

  if (item.commentID) {
    return `${key}:c=${item.commentID}`
  }

  const comment = item.comment?.trim()
  if (!comment) return key
  // checksum(...) returns a hex digest in OpenCode; we degrade to the trimmed
  // comment as a stable fallback for the React port.
  return `${key}:c=${comment}`
}

export function isCommentItem(item: ContextItem | ContextItemWithKey): boolean {
  return item.type === "file" && !!item.comment?.trim()
}

export function isDirty(prompt: Prompt): boolean {
  return !isPromptEqual(prompt, DEFAULT_PROMPT)
}

// ----------------------------------------------------------------------------
// Per-scope cache. In OpenCode this is built on SolidJS createRoot so each
// scope owns a persistent store and is disposed on cleanup. The Zustand port
// keeps the same LRU semantics with a plain Map and exposes the same API.
// ----------------------------------------------------------------------------

export const WORKSPACE_KEY = "__workspace__"
export const MAX_PROMPT_SESSIONS = 20

export type PromptScope = { draftID: string } | { dir: string; id?: string }

export function scopeKey(scope: PromptScope): string {
  if ("draftID" in scope) return `draft:${scope.draftID}`
  return `${scope.dir}:${scope.id ?? WORKSPACE_KEY}`
}

export type PromptCacheEntry = {
  state: PromptStoreState
  dispose: () => void
}

/**
 * Minimal cache helper. Most callers will instantiate the store directly via
 * {@link usePromptStore} and toggle its state when the active scope changes —
 * the LRU layer is provided as an opt-in for cases where multiple scopes must
 * keep independent state in memory simultaneously.
 */
export function createPromptCache(maxEntries: number = MAX_PROMPT_SESSIONS) {
  const cache = new Map<string, PromptCacheEntry>()

  function prune() {
    while (cache.size > maxEntries) {
      const first = cache.keys().next().value
      if (!first) return
      const entry = cache.get(first)
      entry?.dispose()
      cache.delete(first)
    }
  }

  return {
    get(scope: PromptScope): PromptCacheEntry {
      const key = scopeKey(scope)
      const existing = cache.get(key)
      if (existing) {
        cache.delete(key)
        cache.set(key, existing)
        return existing
      }
      const entry: PromptCacheEntry = {
        state: freshState(),
        dispose: () => {
          /* per-scope dispose hook */
        },
      }
      cache.set(key, entry)
      prune()
      return entry
    },
    clear() {
      for (const entry of cache.values()) entry.dispose()
      cache.clear()
    },
    size() {
      return cache.size
    },
  }
}