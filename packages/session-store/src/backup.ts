// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Session-history backup/restore (deepseek chat-demo history/ protocol
 * borrowing, port of exportArchive/importArchive/backup.ts).
 *
 * Archive layout (entry order fixed, STORE-compressed ZIP32):
 *
 *   manifest.json            MUST be the first entry — format version gate
 *   sessions/{id}.json       one file per session: session row + treeRootId
 *                            + every message row (tree fields included)
 *   session_index.json       summary of the sessions actually written
 *
 * Deliberate exclusions (declared in the manifest): events, usage,
 * steering_queue, lesson_efficacy and audit are runtime operation data —
 * chat-demo applies the same policy ("归档不保存 API Key 或应用设置，
 * 不能完整恢复本地运行状态").
 *
 * Import protocol (chat-demo history/README.md, adapted):
 *   1. Read the first entry and gate on the format version — a NEWER
 *      version is rejected outright (it would silently misparse), and so
 *      is anything that is not exactly version 1.
 *   2. Parse and fully validate everything into memory: container fields
 *      strictly typed, message ids globally unique (they are the
 *      messages-table primary key), session files ↔ index 1:1, and the
 *      tree invariants — parents must exist, roles must alternate
 *      user/assistant, roots must be questions. chat-demo orders ids
 *      ("父消息 ID 必须小于子消息 ID") which implies acyclicity; our ids
 *      are arbitrary strings, so parent existence + an explicit parent
 *      walk supply the same guarantees.
 *   3. Only when everything validated, replace the store inside ONE
 *      BEGIN IMMEDIATE transaction (chat-demo stages into IndexedDB and
 *      swaps in a single transaction; a synchronous SQLite transaction is
 *      the stronger equivalent — no staging tables needed, and validation
 *      failure never touches the original data). Restored rows carry NULL
 *      hash-chain columns, so verifyHistory treats them as a legacy
 *      segment — the same semantics as rows predating the v3 migration.
 *
 * Export, import and clear all funnel through a single serial queue
 * (chat-demo backup.ts enqueueBackup): a concurrent export must never
 * observe half a replacement, and two replacements must never interleave.
 */

import { unzipSync, zipSync } from "fflate"
import type { SessionStore } from "./index.js"
import { treeBoundaryMetaKey, treeRootMetaKey } from "./message-tree.js"

/** Archive format version. Bumped on incompatible layout changes. */
export const BACKUP_FORMAT_VERSION = 1

const MANIFEST_PATH = "manifest.json"
const INDEX_PATH = "session_index.json"
const SESSIONS_PREFIX = "sessions/"

const sessionPath = (sessionId: string): string => `${SESSIONS_PREFIX}${sessionId}.json`

const parseSessionPath = (entry: string): string | null =>
  /^sessions\/([^/]+)\.json$/.exec(entry)?.[1] ?? null

/** Runtime operation tables that are deliberately NOT archived. */
const EXCLUDED_TABLES = ["events", "usage", "steering_queue", "lesson_efficacy", "audit"] as const

/** Bound for the LIMIT-clamped reads: the side store fits comfortably in memory. */
const EXPORT_ROW_LIMIT = 1_000_000

/** Import/export failure with a machine-readable reason (chat-demo BackupError borrowing). */
export class BackupError extends Error {
  constructor(readonly reason: string) {
    super(`session backup: ${reason}`)
    this.name = "BackupError"
  }
}

// Explicit variable annotation (not just the arrow's return type): TS
// only treats a never-returning call as a control-flow terminator when
// the const carries the `never` signature itself, and the validators
// below lean on that for narrowing.
const fail: (reason: string) => never = (reason) => {
  throw new BackupError(reason)
}

/** manifest.json — the archive's first entry and the version gate. */
export interface BackupManifest {
  export_format_version: typeof BACKUP_FORMAT_VERSION
  exported_at: string
  counts: { sessions: number; messages: number }
  /** Runtime tables deliberately left out of the archive. */
  excluded: readonly string[]
}

/** One entry of session_index.json — summary of a successfully written session. */
export interface SessionIndexEntry {
  id: string
  title: string | null
  workspaceId: string | null
  createdAt: string | null
  updatedAt: string | null
  messageCount: number
}

/**
 * One archived message row. The hash-chain columns (seq/prev_hash/hash)
 * are intentionally NOT part of the format: they certify the chain they
 * were minted in, and an archive travels outside that trust boundary —
 * import re-becomes a legacy segment (see module header).
 */
export interface ArchiveMessage {
  id: string
  sessionId: string
  role: string
  content: string
  createdAt: string | null
  turnOrdinal: number | null
  deletedAt: string | null
  parentId: string | null
  selectedChildId: string | null
}

/** sessions/{id}.json — session row plus its complete message tree. */
export interface SessionBackupFile {
  id: string
  workspaceId: string | null
  title: string | null
  createdAt: string | null
  updatedAt: string | null
  /** Selected root branch (chat-demo session.rootMessageId); null = linear legacy session. */
  treeRootId: string | null
  /** Last pre-tree linear-era row (null = the session was empty when it entered tree mode). */
  treeBoundaryId: string | null
  messages: ArchiveMessage[]
}

/** Result of a successful export. */
export interface BackupArchive {
  bytes: Uint8Array
  filename: string
  manifest: BackupManifest
}

// ---------------------------------------------------------------------------
// Serial queue (chat-demo backup.ts enqueueBackup, ported verbatim)
// ---------------------------------------------------------------------------

let backupQueue: Promise<unknown> = Promise.resolve()

const enqueueBackup = <T>(run: () => T): Promise<T> => {
  const task = backupQueue.then(run)
  backupQueue = task.catch(() => {})
  return task
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const jsonBytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

const toArchiveMessage = (row: {
  id: string
  sessionId: string
  role: string
  content: string
  createdAt: string | null
  turnOrdinal: number | null
  deletedAt: string | null
  parentId: string | null
  selectedChildId: string | null
}): ArchiveMessage => ({
  id: row.id,
  sessionId: row.sessionId,
  role: row.role,
  content: row.content,
  createdAt: row.createdAt,
  turnOrdinal: row.turnOrdinal,
  deletedAt: row.deletedAt,
  parentId: row.parentId,
  selectedChildId: row.selectedChildId,
})

/**
 * Session ids become ZIP entry names — refuse ids that could not be
 * re-imported (nested/colliding entries) instead of emitting an archive
 * we cannot consume ourselves. Runtime ids are UUID-shaped, so this only
 * ever fires on hand-crafted rows.
 */
const assertPathSafeId = (id: string, what: string): void => {
  if (id === "" || id === "." || id === ".." || /[/\\\0]/.test(id)) {
    fail(`${what} is not archive-path safe: ${JSON.stringify(id)}`)
  }
}

const backupFileName = (exportedAt: string): string =>
  `maximilian-sessions-${exportedAt.slice(0, 10)}.zip`

function exportBackupSync(store: SessionStore): BackupArchive {
  const exportedAt = new Date().toISOString()
  // Read phase inside one transaction: the session list, message rows and
  // root markers form one consistent snapshot (chat-demo keeps the same
  // invariant with its export-start memory snapshot).
  const files: SessionBackupFile[] = store.transaction(() =>
    store.listSessions(undefined, EXPORT_ROW_LIMIT).map((session) => ({
      id: session.id,
      workspaceId: session.workspaceId,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      treeRootId: store.getMeta(treeRootMetaKey(session.id)),
      treeBoundaryId: store.getMeta(treeBoundaryMetaKey(session.id)),
      messages: store
        .listMessages(session.id, EXPORT_ROW_LIMIT)
        .map((row) => toArchiveMessage(row)),
    })),
  )
  for (const file of files) assertPathSafeId(file.id, "session id")

  const index: SessionIndexEntry[] = files.map((file) => ({
    id: file.id,
    title: file.title,
    workspaceId: file.workspaceId,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    messageCount: file.messages.length,
  }))
  const manifest: BackupManifest = {
    export_format_version: BACKUP_FORMAT_VERSION,
    exported_at: exportedAt,
    counts: {
      sessions: files.length,
      messages: files.reduce((sum, file) => sum + file.messages.length, 0),
    },
    excluded: EXCLUDED_TABLES,
  }

  // Entry order is the format contract: manifest first, then every
  // session file, then the index (zipSync preserves insertion order and
  // unzipSync visits the central directory in that same order).
  const entries: Record<string, Uint8Array> = {}
  entries[MANIFEST_PATH] = jsonBytes(manifest)
  for (const file of files) {
    entries[sessionPath(file.id)] = jsonBytes(file)
  }
  entries[INDEX_PATH] = jsonBytes(index)

  return {
    bytes: zipSync(entries, { level: 0 }),
    filename: backupFileName(exportedAt),
    manifest,
  }
}

/** Export every session (rows + message trees) as a STORE-compressed ZIP. */
export function exportSessionsBackup(store: SessionStore): Promise<BackupArchive> {
  return enqueueBackup(() => exportBackupSync(store))
}

// ---------------------------------------------------------------------------
// Validation (chat-demo history/schema.ts borrowing — strict container
// fields, unknown member values rejected rather than silently coerced)
// ---------------------------------------------------------------------------

type Read<T> = (value: unknown, what: string) => T

const record: Read<Record<string, unknown>> = (value, what) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(`${what} must be a JSON object`)

const string: Read<string> = (value, what) =>
  typeof value === "string" ? value : fail(`${what} must be a string`)

const nullableString: Read<string | null> = (value, what) =>
  value === null ? null : string(value, what)

const count: Read<number> = (value, what) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail(`${what} must be a non-negative integer`)

const nullableCount: Read<number | null> = (value, what) =>
  value === null ? null : count(value, what)

const list: Read<unknown[]> = (value, what) =>
  Array.isArray(value) ? value : fail(`${what} must be an array`)

const jsonValue = (bytes: Uint8Array, what: string): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return fail(`${what} is not valid JSON`)
  }
}

const readManifest = (
  value: unknown,
): { version: number; exportedAt: string; counts: { sessions: number; messages: number } } => {
  const item = record(value, MANIFEST_PATH)
  const version = item.export_format_version
  // Version gate (chat-demo checkManifest borrowing): a NEWER version is
  // a different protocol — reject before anything else could misparse it.
  // Anything that is not exactly the current version is rejected too.
  if (typeof version === "number" && version > BACKUP_FORMAT_VERSION) {
    fail(
      `archive was written in format version ${version}, newer than the supported ${BACKUP_FORMAT_VERSION}`,
    )
  }
  if (version !== BACKUP_FORMAT_VERSION) {
    fail(`unsupported export_format_version: ${JSON.stringify(version)}`)
  }
  const countsItem = record(item.counts, `${MANIFEST_PATH}.counts`)
  return {
    version: BACKUP_FORMAT_VERSION,
    exportedAt: string(item.exported_at, `${MANIFEST_PATH}.exported_at`),
    counts: {
      sessions: count(countsItem.sessions, `${MANIFEST_PATH}.counts.sessions`),
      messages: count(countsItem.messages, `${MANIFEST_PATH}.counts.messages`),
    },
  }
}

const readMessage = (value: unknown, what: string): ArchiveMessage => {
  const item = record(value, what)
  return {
    id: string(item.id, `${what}.id`),
    sessionId: string(item.sessionId, `${what}.sessionId`),
    role: string(item.role, `${what}.role`),
    content: string(item.content, `${what}.content`),
    createdAt: nullableString(item.createdAt, `${what}.createdAt`),
    turnOrdinal: nullableCount(item.turnOrdinal, `${what}.turnOrdinal`),
    deletedAt: nullableString(item.deletedAt, `${what}.deletedAt`),
    parentId: nullableString(item.parentId, `${what}.parentId`),
    selectedChildId: nullableString(item.selectedChildId, `${what}.selectedChildId`),
  }
}

const readSessionFile = (value: unknown, entryName: string): SessionBackupFile => {
  const item = record(value, entryName)
  const id = string(item.id, `${entryName}.id`)
  if (id !== parseSessionPath(entryName)) {
    fail(`session file ${entryName} declares a different id: ${JSON.stringify(id)}`)
  }
  assertPathSafeId(id, "session id")
  return {
    id,
    workspaceId: nullableString(item.workspaceId, `${entryName}.workspaceId`),
    title: nullableString(item.title, `${entryName}.title`),
    createdAt: nullableString(item.createdAt, `${entryName}.createdAt`),
    updatedAt: nullableString(item.updatedAt, `${entryName}.updatedAt`),
    treeRootId: nullableString(item.treeRootId, `${entryName}.treeRootId`),
    treeBoundaryId: nullableString(item.treeBoundaryId, `${entryName}.treeBoundaryId`),
    messages: list(item.messages, `${entryName}.messages`).map((message, i) =>
      readMessage(message, `${entryName}.messages[${i}]`),
    ),
  }
}

const readIndexEntry = (value: unknown, what: string): SessionIndexEntry => {
  const item = record(value, what)
  const id = string(item.id, `${what}.id`)
  assertPathSafeId(id, "index entry id")
  return {
    id,
    title: nullableString(item.title, `${what}.title`),
    workspaceId: nullableString(item.workspaceId, `${what}.workspaceId`),
    createdAt: nullableString(item.createdAt, `${what}.createdAt`),
    updatedAt: nullableString(item.updatedAt, `${what}.updatedAt`),
    messageCount: count(item.messageCount, `${what}.messageCount`),
  }
}

/** Fully validate one parsed session file (chat-demo "消息树还原" rules). */
function validateSessionFile(file: SessionBackupFile, globalIds: Set<string>): void {
  const byId = new Map<string, ArchiveMessage>()
  for (const message of file.messages) {
    if (globalIds.has(message.id)) {
      fail(`message id ${JSON.stringify(message.id)} appears in more than one session`)
    }
    globalIds.add(message.id)
    byId.set(message.id, message)
    if (message.sessionId !== file.id) {
      fail(
        `message ${JSON.stringify(message.id)} declares session ${JSON.stringify(message.sessionId)} but is archived under ${JSON.stringify(file.id)}`,
      )
    }
  }

  // Referential integrity: parents and selected children must exist in
  // the same session, and a selected child must agree about its parent.
  for (const message of file.messages) {
    if (message.parentId !== null && !byId.has(message.parentId)) {
      fail(
        `message ${JSON.stringify(message.id)} references missing parent ${JSON.stringify(message.parentId)}`,
      )
    }
    if (message.selectedChildId !== null) {
      const child = byId.get(message.selectedChildId)
      if (child === undefined) {
        fail(
          `message ${JSON.stringify(message.id)} selects missing child ${JSON.stringify(message.selectedChildId)}`,
        )
      } else if (child.parentId !== message.id) {
        fail(
          `message ${JSON.stringify(message.id)} selects ${JSON.stringify(child.id)} whose declared parent is ${JSON.stringify(child.parentId)}`,
        )
      }
    }
  }

  // Acyclicity: chat-demo's numeric id ordering implied it; with
  // arbitrary string ids we walk every parent chain explicitly.
  for (const message of file.messages) {
    const seen = new Set<string>([message.id])
    let cursor = message.parentId
    while (cursor !== null) {
      if (seen.has(cursor)) {
        fail(
          `parent cycle detected at message ${JSON.stringify(cursor)} in session ${JSON.stringify(file.id)}`,
        )
      }
      seen.add(cursor)
      cursor = byId.get(cursor)?.parentId ?? null
    }
  }

  if (file.treeRootId !== null && !byId.has(file.treeRootId)) {
    fail(
      `treeRootId ${JSON.stringify(file.treeRootId)} is not a message of session ${JSON.stringify(file.id)}`,
    )
  }
  if (file.treeBoundaryId !== null && !byId.has(file.treeBoundaryId)) {
    fail(
      `treeBoundaryId ${JSON.stringify(file.treeBoundaryId)} is not a message of session ${JSON.stringify(file.id)}`,
    )
  }
  // Writer consistency: tree markers only ever accompany tree mode, and
  // explicit tree links only ever exist in tree-mode sessions.
  const hasExplicitLinks = file.messages.some(
    (m) => m.parentId !== null || m.selectedChildId !== null,
  )
  if (file.treeRootId === null && (file.treeBoundaryId !== null || hasExplicitLinks)) {
    fail(`session ${JSON.stringify(file.id)} carries tree state without a tree root`)
  }

  // Role protocol (chat-demo: 根为提问、角色交替) — enforced for
  // tree-mode sessions only, and only where the tree protocol actually
  // governs: explicit parent edges must alternate, and TREE-ERA root
  // branches must start with a question. Linear-era rows (up to the
  // boundary) predate the protocol — the runtime legitimately wrote
  // consecutive same-role turns and assistant-only sessions there — so
  // re-importing them must not fail. Pure linear sessions (no root
  // marker) are exempt entirely for the same reason.
  if (file.treeRootId !== null) {
    const ordered = [...file.messages].sort((a, b) => {
      const at = (a.createdAt ?? "").localeCompare(b.createdAt ?? "")
      return at !== 0 ? at : a.id.localeCompare(b.id)
    })
    const boundaryIndex =
      file.treeBoundaryId !== null ? ordered.findIndex((m) => m.id === file.treeBoundaryId) : -1
    ordered.forEach((message, index) => {
      if (message.parentId !== null) {
        const parent = byId.get(message.parentId)
        if (parent !== undefined && parent.role === message.role) {
          fail(
            `roles must alternate between ${JSON.stringify(parent.id)} and ${JSON.stringify(message.id)}`,
          )
        }
      } else if (index > boundaryIndex && message.role !== "user") {
        fail(
          `session ${JSON.stringify(file.id)}: root message ${JSON.stringify(message.id)} must be a user message`,
        )
      }
    })
  }
}

interface ParsedArchive {
  manifest: ReturnType<typeof readManifest>
  index: SessionIndexEntry[]
  files: SessionBackupFile[]
}

function parseArchive(data: Uint8Array): ParsedArchive {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(data)
  } catch (error) {
    fail(`unreadable zip archive: ${error instanceof Error ? error.message : String(error)}`)
  }
  // unzipSync inserts entries in central-directory order, which is the
  // write order zipSync produced — so "first entry" is observable here.
  const names = Object.keys(entries)
  if (!names.includes(MANIFEST_PATH)) {
    fail(`${MANIFEST_PATH} missing from archive`)
  }
  if (names[0] !== MANIFEST_PATH) {
    fail(`${MANIFEST_PATH} must be the first archive entry`)
  }
  const manifest = readManifest(jsonValue(entries[MANIFEST_PATH], MANIFEST_PATH))

  const files = new Map<string, SessionBackupFile>()
  let index: SessionIndexEntry[] | undefined
  for (const name of names.slice(1)) {
    if (name === INDEX_PATH) {
      if (index !== undefined) fail(`duplicate ${INDEX_PATH} entry`)
      index = list(jsonValue(entries[name], INDEX_PATH), INDEX_PATH).map((entry, i) =>
        readIndexEntry(entry, `${INDEX_PATH}[${i}]`),
      )
      continue
    }
    const sessionId = parseSessionPath(name)
    if (sessionId === null) fail(`unexpected archive entry: ${JSON.stringify(name)}`)
    if (files.has(sessionId)) fail(`duplicate session entry: ${JSON.stringify(name)}`)
    files.set(sessionId, readSessionFile(jsonValue(entries[name], name), name))
  }
  if (index === undefined) fail(`${INDEX_PATH} missing from archive`)

  // Index ↔ session files correspond 1:1 (chat-demo: the index only
  // lists sessions that were actually written).
  const indexIds = new Set(index.map((entry) => entry.id))
  if (indexIds.size !== index.length) fail(`${INDEX_PATH} contains duplicate ids`)
  if (indexIds.size !== files.size || [...indexIds].some((id) => !files.has(id))) {
    fail(`${INDEX_PATH} does not correspond to the archived session files`)
  }

  const globalIds = new Set<string>()
  let totalMessages = 0
  for (const entry of index) {
    const file = files.get(entry.id)
    if (file === undefined) continue
    if (entry.messageCount !== file.messages.length) {
      fail(
        `${INDEX_PATH} entry ${JSON.stringify(entry.id)} declares ${entry.messageCount} messages but the file carries ${file.messages.length}`,
      )
    }
    validateSessionFile(file, globalIds)
    totalMessages += file.messages.length
  }

  if (manifest.counts.sessions !== files.size || manifest.counts.messages !== totalMessages) {
    fail(
      `${MANIFEST_PATH} counts (${manifest.counts.sessions} sessions / ${manifest.counts.messages} messages) do not match the archive contents`,
    )
  }

  return { manifest, index, files: [...files.values()] }
}

// ---------------------------------------------------------------------------
// Import / clear — the single-transaction replace path
// ---------------------------------------------------------------------------

function replaceWithArchive(store: SessionStore, parsed: ParsedArchive): number {
  const treeMarkers = new Map<string, { rootId?: string; boundaryId?: string }>()
  for (const file of parsed.files) {
    const marker: { rootId?: string; boundaryId?: string } = {}
    if (file.treeRootId !== null) marker.rootId = file.treeRootId
    if (file.treeBoundaryId !== null) marker.boundaryId = file.treeBoundaryId
    if (marker.rootId !== undefined || marker.boundaryId !== undefined) {
      treeMarkers.set(file.id, marker)
    }
  }
  store.replaceSessions(
    parsed.files.map((file) => ({
      id: file.id,
      workspaceId: file.workspaceId,
      title: file.title,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    })),
    parsed.files.flatMap((file) => file.messages.map((message) => ({ ...message }))),
    treeMarkers,
  )
  return parsed.files.length
}

/**
 * Validate `data` fully, then atomically replace ALL sessions/messages
 * with its contents. Returns the number of restored sessions. Throws
 * {@link BackupError} (with the reason) on any validation failure — the
 * original data is untouched in that case, because nothing is written
 * before the single immediate transaction that performs the swap.
 */
export function importSessionsBackup(store: SessionStore, data: Uint8Array): Promise<number> {
  return enqueueBackup(() => replaceWithArchive(store, parseArchive(data)))
}

/** Clear all sessions/messages through the same atomic replace path. */
export function clearSessionsBackup(store: SessionStore): Promise<void> {
  return enqueueBackup(() => {
    store.replaceSessions([], [], new Map())
  })
}
