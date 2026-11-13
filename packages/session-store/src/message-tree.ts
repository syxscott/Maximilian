// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Message-tree normalization (deepseek chat-demo borrowing, port of
 * `src/services/chat/branches.ts`).
 *
 * chat-demo keeps a message TREE per session: every message has a
 * `parentId` and its owner row records which child branch is currently
 * `selectedChildId`, so regeneration/editing fork the history without
 * destroying the old branch. The functions here are a faithful port of
 * normalizeSession / getVisibleMessages / buildMessageVersions adapted
 * from chat-demo's in-memory Session to our SQLite rows, with two
 * storage-driven wrinkles:
 *
 *   1. Legacy segment: chat-demo persists the normalized links on every
 *      message object; we must NOT rewrite stored rows, so rows without
 *      explicit tree columns are linked IN MEMORY — parent = previous
 *      row, selected child = next row in (createdAt, id) order, exactly
 *      what normalizeSession derives for a fresh linear session.
 *   2. The linear era ends at the first tree write: appendBranch records
 *      the last pre-tree row in meta (`tree_boundary:<sessionId>`).
 *      Derivation applies only up to that boundary — later rows without
 *      explicit columns are plain appends / single-message root
 *      branches, and deriving links for them would splice unrelated
 *      branches onto the legacy tail (or leak the legacy chain into a
 *      root branch when the user switches roots).
 *
 * Soft-delete (rewind, hermes state_rewind borrowing) composes with the
 * tree: the selected-path walk STOPS at the first deleted row instead
 * of walking through it. Rewinding hides a suffix of the conversation;
 * surfacing rows beyond a hidden row would defeat the rewind (and would
 * present provider history with holes in the middle).
 */

/**
 * Raw row shape the tree functions need (projection of `messages`).
 */
export interface MessageTreeRow {
  id: string
  /** Explicit `parent_id` column (null = unset). */
  parentId: string | null
  /** Explicit `selected_child_id` column (null = unset). */
  selectedChildId: string | null
  createdAt: string | null
  deleted: boolean
}

/** A tree-normalized message: explicit columns overlaid with derived links. */
export interface NormalizedTreeMessage {
  id: string
  /** Resolved parent: explicit column, or the previous row for legacy chains. */
  parentId: string | null
  /** Resolved selected child: explicit column, or the next row for legacy chains. */
  selectedChildId: string | null
  createdAt: string | null
  deleted: boolean
}

/** A whole session's normalized tree. */
export interface MessageTree {
  /** Walk start of the selected path (null for an empty session). */
  rootId: string | null
  /** False while the session is a pure linear legacy transcript. */
  treeMode: boolean
  /** All messages (every branch), in (createdAt, id) order. */
  messages: NormalizedTreeMessage[]
}

/**
 * meta-table keys carrying per-session tree state (chat-demo's
 * `session.rootMessageId`, which has no natural column home in the
 * messages table):
 *
 *   - `tree_root:<id>` — the selected root branch head. Its EXISTENCE is
 *     also the tree-mode marker: absent = the session never grew a
 *     branch, so it reads as a pure linear transcript.
 *   - `tree_boundary:<id>` — the LAST row of the pre-tree linear era;
 *     absent = the session was empty when it entered tree mode, so every
 *     row is an explicit-tree-era row.
 */
export function treeRootMetaKey(sessionId: string): string {
  return `tree_root:${sessionId}`
}

export function treeBoundaryMetaKey(sessionId: string): string {
  return `tree_boundary:${sessionId}`
}

export interface NormalizeTreeOptions {
  /**
   * Stored root selection (meta `tree_root:<id>`). `undefined` = pure
   * linear mode; a string (or null, for "use the default") = tree mode.
   */
  rootId?: string | null
  /** Stored linear-era boundary (meta `tree_boundary:<id>`); only meaningful in tree mode. */
  boundaryId?: string | null
}

/**
 * Normalize raw rows into a tree. This is the DB twin of chat-demo's
 * normalizeSession: the input rows are never mutated, and links missing
 * from storage are derived in memory.
 */
export function normalizeMessageTree(
  rows: readonly MessageTreeRow[],
  options: NormalizeTreeOptions = {},
): MessageTree {
  const { rootId, boundaryId } = options
  const treeMode = rootId !== undefined
  // chat-demo normalizeSession walks the session's message list order;
  // our stable order is (createdAt, id) — the same ordering listMessages
  // has always used, so the linear derivation is identical to the old
  // linear transcript reads.
  const ordered = [...rows].sort((a, b) => {
    const at = (a.createdAt ?? "").localeCompare(b.createdAt ?? "")
    return at !== 0 ? at : a.id.localeCompare(b.id)
  })

  if (!treeMode) {
    // Pure linear session: every row is a chain link (chat-demo
    // normalizeSession: parentId = previous, selectedChildId = next).
    const messages = ordered.map((row, index) => ({
      id: row.id,
      parentId: ordered[index - 1]?.id ?? null,
      selectedChildId: ordered[index + 1]?.id ?? null,
      createdAt: row.createdAt,
      deleted: row.deleted,
    }))
    return { rootId: ordered[0]?.id ?? null, treeMode: false, messages }
  }

  // Tree mode. Rows up to AND INCLUDING the stored boundary are the
  // pre-tree linear era: their links are derived in memory (explicit
  // columns still win — appendBranch may have pointed the parent row's
  // selected_child_id at a new branch head). Rows after the boundary use
  // their explicit columns verbatim; rows without any explicit column
  // are plain appends / single-message root branches and stay isolated
  // (deriving links for them would splice unrelated branches onto the
  // legacy tail).
  const boundaryIndex = boundaryId != null ? ordered.findIndex((row) => row.id === boundaryId) : -1
  const messages = ordered.map((row, index) => {
    if (index > boundaryIndex) {
      return {
        id: row.id,
        parentId: row.parentId,
        selectedChildId: row.selectedChildId,
        createdAt: row.createdAt,
        deleted: row.deleted,
      }
    }
    const prev = ordered[index - 1]
    const next = ordered[index + 1]
    return {
      id: row.id,
      parentId: index > 0 ? (prev?.id ?? null) : null,
      selectedChildId: row.selectedChildId ?? (index < boundaryIndex ? (next?.id ?? null) : null),
      createdAt: row.createdAt,
      deleted: row.deleted,
    }
  })

  // Root selection: the stored root when it still exists, otherwise the
  // first row in order — the linear-era head when there is one (this is
  // normalizeSession's `rootMessageId = messages[0].id` default).
  const byId = new Map(messages.map((m) => [m.id, m]))
  const storedRoot = rootId != null ? byId.get(rootId) : undefined
  if (storedRoot) {
    return { rootId: storedRoot.id, treeMode: true, messages }
  }
  return { rootId: ordered[0]?.id ?? null, treeMode: true, messages }
}

/**
 * The currently visible conversation: walk the selected path from the
 * root, following selectedChildId. Ported from chat-demo's
 * getVisibleMessages with two adaptations:
 *
 *   - Soft-deleted rows terminate the walk (see module header: rewind
 *     hides a suffix; never surface rows past a hidden one).
 *   - Visited rows are removed from the lookup map as the walk consumes
 *     them (chat-demo does the same via `byId.delete(id)`), which also
 *     guarantees termination if a corrupted selected_child_id cycle ever
 *     made it into storage.
 */
export function getVisibleMessages(tree: MessageTree): NormalizedTreeMessage[] {
  const byId = new Map(tree.messages.map((m) => [m.id, m]))
  const path: NormalizedTreeMessage[] = []
  let id = tree.rootId
  while (id) {
    const message = byId.get(id)
    if (!message) break
    if (message.deleted) break
    path.push(message)
    byId.delete(id)
    id = message.selectedChildId ?? null
  }
  return path
}

/** Per-message sibling-version list: the ids sharing this message's parent, plus its position. */
export type MessageVersions = { ids: string[]; index: number }

/**
 * Collect sibling versions for every message in one pass. Ported from
 * chat-demo's buildMessageVersions, including the stability contract
 * that matters for streaming UIs: version lists are keyed by the FIRST
 * id of each group, and when nothing changed the previously returned
 * objects (and their identity) are reused verbatim. React consumers
 * memoize on object identity, so re-emitting identical-but-fresh objects
 * per keystroke would redraw every historical message on each streamed
 * token — the reuse is what keeps history rendering stable while the
 * current reply streams.
 */
export function buildMessageVersions(
  tree: MessageTree,
  previous: ReadonlyMap<string, MessageVersions>,
): ReadonlyMap<string, MessageVersions> {
  // chat-demo: while a session is linear each message is its own group
  // (nothing can fork yet); once tree mode begins the groups key on the
  // resolved parentId.
  const groups = new Map<string | null, string[]>()
  for (const message of tree.messages) {
    const key = tree.treeMode ? message.parentId : message.id
    const ids = groups.get(key)
    if (ids) {
      ids.push(message.id)
    } else {
      groups.set(key, [message.id])
    }
  }

  const versions = new Map<string, MessageVersions>()
  let unchanged = previous.size === tree.messages.length
  for (const ids of groups.values()) {
    const cachedIds = previous.get(ids[0])?.ids
    const stableIds =
      cachedIds?.length === ids.length && ids.every((id, index) => id === cachedIds[index])
        ? cachedIds
        : ids
    ids.forEach((id, index) => {
      const cached = previous.get(id)
      const version =
        cached?.ids === stableIds && cached.index === index ? cached : { ids: stableIds, index }
      versions.set(id, version)
      if (version !== cached) {
        unchanged = false
      }
    })
  }
  return unchanged ? previous : versions
}
