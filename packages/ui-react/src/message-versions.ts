// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Message sibling-version index (deepseek chat-demo borrowing — port of
 * `services/chat/branches.ts` buildMessageVersions).
 *
 * One pass over the message list groups sibling versions by parent id; each
 * message maps to `{ ids, index }` describing its sibling group and its own
 * position inside it. When the version list is unchanged the previous
 * objects and indexes are reused, so a streaming body update never redraws
 * history messages.
 *
 * Linear-list semantics preserved from chat-demo (rootMessageId undefined):
 * a list where NO row carries a parent link is treated as linear — every
 * row becomes its own singleton group, so no version switcher ever renders
 * for a legacy linear session. Rows with `parentId === null` in an otherwise
 * rooted list are that tree's roots and group together under the null key.
 */

export interface VersionedMessageRow {
  id: string
  /** Parent message id on the message tree; null/undefined = no parent link. */
  parentId?: string | null
  /**
   * Child the server currently selects below this message (wire-contract
   * field, carried for completeness — grouping only needs parentId).
   */
  selectedChildId?: string | null
}

export interface MessageVersions {
  /** Sibling ids sharing this message's parent, in stream order. */
  ids: string[]
  /** This message's index inside `ids`. */
  index: number
}

export const buildMessageVersions = (
  items: readonly VersionedMessageRow[],
  previous?: ReadonlyMap<string, MessageVersions>,
): ReadonlyMap<string, MessageVersions> => {
  // chat-demo's `rootMessageId === undefined ? message.id : message.parentId`
  // branch, derived from the rows themselves: a single parent-linked row
  // makes the whole list a tree; otherwise every row groups by its own id.
  const rooted = items.some((item) => typeof item.parentId === "string" && item.parentId.length > 0)
  const groups = new Map<string | null, string[]>()
  for (const item of items) {
    const key = rooted ? (item.parentId ?? null) : item.id
    const ids = groups.get(key)
    if (ids) {
      ids.push(item.id)
    } else {
      groups.set(key, [item.id])
    }
  }

  const versions = new Map<string, MessageVersions>()
  let unchanged = previous !== undefined && previous.size === items.length
  for (const ids of groups.values()) {
    const cachedIds = previous?.get(ids[0])?.ids
    const stableIds =
      cachedIds?.length === ids.length && ids.every((id, index) => id === cachedIds[index])
        ? cachedIds
        : ids
    ids.forEach((id, index) => {
      const cached = previous?.get(id)
      const version =
        cached?.ids === stableIds && cached.index === index ? cached : { ids: stableIds, index }
      versions.set(id, version)
      if (version !== cached) {
        unchanged = false
      }
    })
  }
  return unchanged && previous ? previous : versions
}
