/**
 * SQLite-backed session store — the history side-store for Maximilian.
 *
 * MIGRATION PATTERN (minimax-code): dual-write + legacy-compatible-read.
 * The workspace JSON store (`FileWorkspaceStore`) REMAINS authoritative
 * for workspace state; this package adds a durable SQLite side store for
 * session/message/event history and a few small ledgers (usage, steering
 * queue, lesson efficacy, audit). Nothing in the runtime depends on it
 * yet — wiring happens in a later milestone once the store is proven.
 *
 * Design notes
 *   - Plain `better-sqlite3` API (no ORM) to keep the package small and
 *     synchronous-friendly; every hot path uses prepared statements.
 *   - All timestamps are ISO-8601 strings, so string ordering is
 *     chronological ordering (same convention as the JSONL event log).
 *   - `migrate()` is idempotent and FORWARD-ONLY: the schema version is
 *     tracked in a `meta` table; a database written by a newer version
 *     of this code refuses to open rather than being silently degraded.
 */

import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import Database from "better-sqlite3"
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js"
import { GENESIS_HASH, messageChainHash } from "./hash-chain.js"
import {
  DEFAULT_PAIRING_TABLE,
  sanitizeReplayContent,
  type HistoryItem,
  type PairingTable,
  type SanitizeReport,
} from "./message-sanitizer.js"
import { readWithHydrationRetry, HydrationInvalidatedError } from "./hydration-retry.js"
import {
  getVisibleMessages,
  normalizeMessageTree,
  treeBoundaryMetaKey,
  treeRootMetaKey,
  type MessageTreeRow,
} from "./message-tree.js"

/** Options for constructing a {@link SessionStore}. */
export interface SessionStoreOptions {
  /**
   * Path to the SQLite database file. Parent directories are created
   * automatically. The special value `":memory:"` opens an in-memory
   * database (useful for tests).
   */
  path: string
}

/** A persisted session row (camelCase mirror of the `sessions` table). */
export interface SessionRow {
  id: string
  workspaceId: string | null
  title: string | null
  createdAt: string | null
  updatedAt: string | null
}

/** A persisted message row (camelCase mirror of the `messages` table). */
export interface MessageRow {
  id: string
  sessionId: string
  role: string
  content: string
  createdAt: string | null
  /** Position in the session's hash chain (null for pre-chain legacy rows). */
  seq: number | null
  /** Hash of this entry's chain input (null for legacy rows). */
  hash: string | null
  /** Hash of the previous chain entry (null for legacy rows). */
  prevHash: string | null
  /**
   * Explicit tree parent (deepseek chat-demo borrowing, v4). NULL on
   * rows of sessions that never grew a branch — those read as a linear
   * legacy segment linked in memory by (created_at, id) order.
   */
  parentId: string | null
  /** Explicitly selected child branch tip (null = unset / linear row). */
  selectedChildId: string | null
  /** User-turn ordinal (rewind input; null never occurs for appended rows). */
  turnOrdinal: number | null
  /** Soft-delete timestamp set by rewindFromTurn (null = visible row). */
  deletedAt: string | null
}

/** Result of {@link SessionStore.verifyHistory}. */
export interface HistoryVerification {
  ok: boolean
  /**
   * Message id of the first row that fails the chain walk (present only
   * when `ok` is false). Legacy rows never break the chain; they are
   * skipped, and verification effectively starts at the first chained row.
   */
  brokenAt?: string
  /** Machine-readable failure cause (present only when `ok` is false). */
  reason?: string
}

/** One cross-session search hit: a message row plus its session's workspace context. */
export interface MessageSearchHit {
  sessionId: string
  workspaceId: string | null
  role: string
  content: string
  createdAt: string | null
}

/** A persisted event row (camelCase mirror of the `events` table). */
export interface EventRow {
  id: number
  workspaceId: string | null
  type: string | null
  /** Decoded payload (null when the row stored no payload). */
  payload: unknown
  at: string | null
}

/** Input for {@link SessionStore.appendSession}. */
export interface AppendSessionInput {
  id: string
  workspaceId: string
  title?: string
  createdAt?: string
  updatedAt?: string
}

/** Input for {@link SessionStore.appendMessage}. */
export interface AppendMessageInput {
  id: string
  sessionId: string
  role: string
  content: string
  createdAt?: string
  /** User-turn ordinal — rewind operates on this (hermes state_rewind). */
  turnOrdinal?: number
  /**
   * Explicit tree parent (deepseek chat-demo borrowing). Omitted/NULL
   * keeps the row in the linear legacy segment; a re-append that omits
   * the field preserves the stored value instead of clearing it.
   */
  parentId?: string | null
  /** Explicitly selected child branch tip. Omitted re-appends preserve the stored value. */
  selectedChildId?: string | null
}

/** One message to attach under a parent branch via {@link SessionStore.appendBranch}. */
export interface AppendBranchMessage {
  role: string
  content: string
  /** User-turn ordinal for rewind support; defaults to 0 like appendMessage. */
  turnOrdinal?: number
}

/** Input for {@link SessionStore.appendEvent}. */
export interface AppendEventInput {
  workspaceId: string
  type: string
  payload?: unknown
  at?: string
}

/** Verbatim session row for {@link SessionStore.replaceSessions} (backup restore path). */
export interface ReplaceSessionRow {
  id: string
  workspaceId: string | null
  title: string | null
  createdAt: string | null
  updatedAt: string | null
}

/** Verbatim message row for {@link SessionStore.replaceSessions} (backup restore path). */
export interface ReplaceMessageRow {
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

/** Per-session tree meta restored with {@link SessionStore.replaceSessions}. */
export interface ReplaceTreeMarker {
  /** Selected root branch head (written when non-null). */
  rootId?: string | null
  /** Last pre-tree linear-era row (written when non-null). */
  boundaryId?: string | null
}

/** Input for {@link SessionStore.recordUsage}. */
export interface RecordUsageInput {
  workspaceId?: string
  role?: string
  provider?: string
  model?: string
  tokensIn?: number
  tokensOut?: number
  at?: string
}

/** Input for {@link SessionStore.enqueueSteering}. */
export interface EnqueueSteeringInput {
  workspaceId?: string
  text: string
  source?: string
  /** Unique receipt id — repeated enqueues with the same id are no-ops. */
  receiptId: string
  createdAt?: string
}

/** One aggregated lesson-efficacy row. */
export interface LessonEfficacyRow {
  role: string
  bucket: string
  injectedCount: number
  deltaSum: number
}

function toNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Raw snake_case/aliased projection of one `messages` row. */
interface RawMessageRow {
  id: string
  session_id: string
  role: string
  content: string
  created_at: string | null
  seq: number | null
  prevHash: string | null
  hash: string | null
  parentId: string | null
  selectedChildId: string | null
  turnOrdinal: number | null
  deletedAt: string | null
}

/** Shared row mapper so every read path returns the exact same MessageRow shape. */
function toMessageRow(row: RawMessageRow): MessageRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    seq: row.seq,
    hash: row.hash,
    prevHash: row.prevHash,
    parentId: row.parentId,
    selectedChildId: row.selectedChildId,
    turnOrdinal: row.turnOrdinal,
    deletedAt: row.deletedAt,
  }
}

/** SELECT projection matching {@link RawMessageRow} for the row mapper. */
const MESSAGE_ROW_SELECT =
  "id, session_id, role, content, created_at, seq, prev_hash AS prevHash, hash, " +
  "parent_id AS parentId, selected_child_id AS selectedChildId, " +
  "turn_ordinal AS turnOrdinal, deleted_at AS deletedAt"

/**
 * Serialize a payload column value. `undefined` becomes NULL; anything
 * else is JSON-encoded. Throws on non-serializable payloads (cycles),
 * which is a caller programming error, not a storage condition.
 */
function encodePayload(payload: unknown): string | null {
  if (payload === undefined) return null
  return JSON.stringify(payload)
}

/**
 * The SQLite session store. Construct, then either call `migrate()`
 * explicitly or rely on the lazy auto-migrate on first use.
 */
export class SessionStore {
  readonly path: string
  private readonly db: Database.Database
  private migrated = false
  private readonly statements = new Map<string, Database.Statement>()

  constructor(options: SessionStoreOptions) {
    this.path = options.path
    if (options.path !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(options.path)), { recursive: true })
    }
    this.db = new Database(options.path)
    // WAL + NORMAL sync: durable enough for a history side-store, much
    // friendlier to concurrent readers than the default rollback journal.
    this.db.pragma("journal_mode = WAL")
    this.db.pragma("synchronous = NORMAL")
    this.db.pragma("busy_timeout = 5000")
  }

  /**
   * Apply the schema. Idempotent and forward-only:
   *   - Missing tables are created (`CREATE TABLE IF NOT EXISTS`).
   *   - The version in `meta` only ever moves forward.
   *   - A database written by a NEWER schema version throws instead of
   *     being silently downgraded.
   * Safe to call multiple times (and after every process start).
   */
  migrate(): this {
    // Probe sqlite_master first: the meta table may not exist yet on a
    // fresh database, and SELECTing from a missing table would throw.
    const metaExists = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
      .get()
    const existing = metaExists
      ? (
          this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
            { value: string | null } | undefined
        )?.value
      : undefined
    const current = existing !== undefined && existing !== null ? Number.parseInt(existing, 10) : 0
    if (Number.isFinite(current) && current > SCHEMA_VERSION) {
      throw new Error(
        `session-store: database ${this.path} has schema_version ${current}, ` +
          `but this code understands at most ${SCHEMA_VERSION} (forward-only migrations)`,
      )
    }

    // Adjacent-edge migration chain (deepseek session-format V2->V3
    // borrowing): recovery from ANY old version walks the edges one at a
    // time; every edge runs inside its own transaction. Edge 0 doubles as
    // the initial bootstrap (v0 -> v1: CREATE TABLE IF NOT EXISTS *).
    const edges: Array<{ to: number; up: () => void }> = [
      {
        to: 1,
        up: () => {
          // SCHEMA_SQL is the authoritative CURRENT-shape schema (v4,
          // including the (session_id, parent_id) index). It must only run
          // when the store is actually empty: an OLD database already has
          // the v1-shaped tables, and re-executing would trip the parent
          // index before the v4 edge adds the column. The previous
          // always-exec behavior double-served as a "repair missing
          // tables" pass, but a v1 stamp is only ever written in the same
          // transaction as that exec, so the repair scenario cannot occur
          // for databases this code produced.
          const messagesExists = this.db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages'")
            .get()
          if (!messagesExists) {
            this.db.exec(SCHEMA_SQL)
          }
          this.setMetaRaw("schema_version", "1")
        },
      },
      {
        // v1 -> v2 (rewind borrowing): soft-delete + turn-ordinal columns on
        // messages so a user-turn rewind can hide rows without destroying
        // the durable transcript.
        to: 2,
        up: () => {
          const cols = this.db.prepare("PRAGMA table_info(messages)").all() as Array<{
            name: string
          }>
          if (!cols.some((c) => c.name === "deleted_at")) {
            this.db.exec("ALTER TABLE messages ADD COLUMN deleted_at TEXT")
          }
          if (!cols.some((c) => c.name === "turn_ordinal")) {
            this.db.exec("ALTER TABLE messages ADD COLUMN turn_ordinal INTEGER")
          }
          this.setMetaRaw("schema_version", "2")
        },
      },
      {
        // v2 -> v3 (minimax-code incremental SHA-256 borrowing): hash-chain
        // columns on messages. Existing rows keep all three NULL — they are
        // the "legacy segment" that verifyHistory skips; chaining starts at
        // the first append after migration.
        to: 3,
        up: () => {
          const cols = this.db.prepare("PRAGMA table_info(messages)").all() as Array<{
            name: string
          }>
          if (!cols.some((c) => c.name === "seq")) {
            this.db.exec("ALTER TABLE messages ADD COLUMN seq INTEGER")
          }
          if (!cols.some((c) => c.name === "prev_hash")) {
            this.db.exec("ALTER TABLE messages ADD COLUMN prev_hash TEXT")
          }
          if (!cols.some((c) => c.name === "hash")) {
            this.db.exec("ALTER TABLE messages ADD COLUMN hash TEXT")
          }
          this.setMetaRaw("schema_version", "3")
        },
      },
      {
        // v3 -> v4 (deepseek chat-demo message-tree borrowing): parent_id +
        // selected_child_id on messages turn the linear transcript into a
        // versioned tree. Existing rows keep both NULL — they are the
        // linear legacy segment, linked in memory by (created_at, id)
        // order (see message-tree.ts) instead of being rewritten in
        // place. The parent lookup index is created by SCHEMA_SQL on
        // fresh databases and patched here for databases that predate
        // the column.
        to: 4,
        up: () => {
          const cols = this.db.prepare("PRAGMA table_info(messages)").all() as Array<{
            name: string
          }>
          if (!cols.some((c) => c.name === "parent_id")) {
            this.db.exec("ALTER TABLE messages ADD COLUMN parent_id TEXT")
          }
          if (!cols.some((c) => c.name === "selected_child_id")) {
            this.db.exec("ALTER TABLE messages ADD COLUMN selected_child_id TEXT")
          }
          this.db.exec(
            "CREATE INDEX IF NOT EXISTS idx_messages_session_parent ON messages (session_id, parent_id)",
          )
          this.setMetaRaw("schema_version", "4")
        },
      },
    ]

    for (const edge of edges) {
      if (current >= edge.to) continue
      this.db.transaction(() => {
        edge.up()
      })()
    }
    return this
  }

  /** Raw meta write used by migration edges (bypasses the statement cache). */
  private setMetaRaw(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value)
  }

  /**
   * Version of the underlying database as seen from THIS connection
   * (SQLite `data_version`: bumps when ANOTHER connection commits — our
   * own writes do not move it). The probe behind {@link readConsistent}'s
   * hydration-invalidation detection; exposed for tests and operators.
   */
  get dataVersion(): number {
    return toNumber(this.db.pragma("data_version", { simple: true }) as number)
  }

  /**
   * Read a projection under hydration-invalidation detection (openclaw
   * session-actor borrowing): `fn` may hydrate from several underlying
   * rows; if another connection commits BETWEEN them, the whole read is
   * retried ONCE from scratch (so every dependent is revalidated), and a
   * second invalidation throws {@link HydrationInvalidatedError} instead
   * of returning a Frankenstein snapshot. Writes from this same
   * connection never count as invalidation (data_version semantics).
   */
  readConsistent<T>(fn: () => T): T {
    return readWithHydrationRetry(() => this.dataVersion, fn)
  }

  /**
   * Rewind a user turn (hermes state_rewind borrowing): soft-delete the
   * messages of turn `turnOrdinal` and everything AFTER it, WITHOUT
   * destroying the durable rows. Returns the number of hidden messages.
   */
  rewindFromTurn(sessionId: string, turnOrdinal: number): number {
    const info = this.db
      .prepare(
        "UPDATE messages SET deleted_at = ? WHERE session_id = ? AND deleted_at IS NULL AND COALESCE(turn_ordinal, 0) >= ?",
      )
      .run(new Date().toISOString(), sessionId, turnOrdinal)
    return info.changes
  }

  /**
   * Raw tree input rows for one session — every row (soft-deleted ones
   * included, the walk needs to see them to stop), in the stable
   * (created_at, id) order the tree derivation relies on.
   */
  private loadTreeRows(sessionId: string): MessageTreeRow[] {
    const rows = this.statement(
      "loadTreeRows",
      `SELECT id, parent_id AS parentId, selected_child_id AS selectedChildId, created_at AS createdAt, deleted_at AS deletedAt
       FROM messages WHERE session_id = ?`,
    ).all(sessionId) as Array<{
      id: string
      parentId: string | null
      selectedChildId: string | null
      createdAt: string | null
      deletedAt: string | null
    }>
    return rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      selectedChildId: row.selectedChildId,
      createdAt: row.createdAt,
      deleted: row.deletedAt !== null,
    }))
  }

  /** Stored tree state for a session (see {@link treeRootMetaKey}). */
  private getTreeRoot(sessionId: string): string | undefined {
    const value = this.getMeta(treeRootMetaKey(sessionId))
    return value === null ? undefined : value
  }

  private getTreeBoundary(sessionId: string): string | undefined {
    const value = this.getMeta(treeBoundaryMetaKey(sessionId))
    return value === null ? undefined : value
  }

  /**
   * Append a new branch under `parentId` (deepseek chat-demo
   * appendBranch borrowing). The first message of `messages` becomes the
   * parent's selected child; the rest chain among themselves, so the
   * previous branch below the parent stays intact and switchable via
   * {@link selectMessageVersion}. `parentId = null` starts a new
   * top-level branch and selects it (chat-demo:
   * `rootMessageId = first.id`).
   *
   * Linear legacy sessions are normalized IN MEMORY
   * (normalizeMessageTree) and only the NEW rows are written tree-shaped
   * — stored rows are never rewritten, except the single
   * `selected_child_id` pointer on the parent row, which is the branch
   * selection itself. New rows go through {@link appendMessage}, so the
   * hash-chain columns follow the exact same rules as any other append.
   *
   * Throws when `parentId` is set but not part of the session, or points
   * at a soft-deleted row: both would write a subtree that no walk can
   * ever reach (the visible-path walk stops at deleted rows), which is a
   * caller bug, not a storage condition.
   */
  appendBranch(
    sessionId: string,
    parentId: string | null,
    messages: AppendBranchMessage[],
  ): MessageRow[] {
    if (messages.length === 0) return []
    return this.transaction(() => {
      const storedRoot = this.getTreeRoot(sessionId)
      const rows = this.loadTreeRows(sessionId)
      const tree = normalizeMessageTree(rows, {
        rootId: storedRoot,
        boundaryId: this.getTreeBoundary(sessionId),
      })
      const parent = parentId !== null ? tree.messages.find((m) => m.id === parentId) : undefined
      if (parentId !== null && (parent === undefined || parent.deleted)) {
        throw new Error(
          `session-store: cannot append a branch under ${parent === undefined ? "unknown" : "soft-deleted"} message ${parentId} in session ${sessionId}`,
        )
      }

      const ids = messages.map(() => randomUUID())
      if (parentId !== null) {
        // The branch selection pointer (chat-demo: the parent message's
        // selectedChildId is rewritten to the new head; its old subtree
        // remains reachable by switching versions back).
        this.statement(
          "appendBranchSelectHead",
          "UPDATE messages SET selected_child_id = ? WHERE id = ?",
        ).run(ids[0], parentId)
      }

      // (createdAt, id) is the tree's stable order, so the branch rows get
      // strictly increasing stamps placed strictly AFTER everything the
      // session already contains: equal millisecond stamps (fast loops,
      // tests) would fall back to id ordering, and UUIDs do not sort after
      // runtime ids — the chain order would scramble.
      const stamps = rows.map((row) => (row.createdAt ? Date.parse(row.createdAt) : Number.NaN))
      const base = Math.max(Date.now(), ...stamps.filter((ms) => Number.isFinite(ms)))

      for (const [index, message] of messages.entries()) {
        this.appendMessage({
          id: ids[index],
          sessionId,
          role: message.role,
          content: message.content,
          createdAt: new Date(base + 1 + index).toISOString(),
          turnOrdinal: message.turnOrdinal,
          parentId: index === 0 ? parentId : ids[index - 1],
          selectedChildId: ids[index + 1] ?? null,
        })
      }

      if (storedRoot === undefined) {
        // First tree write for this session: freeze the pre-tree linear
        // era (normalizeSession derives its links once and persists them;
        // we persist the BOUNDARY instead and keep deriving in memory —
        // stored rows stay untouched).
        if (tree.messages.length > 0) {
          this.setMeta(treeBoundaryMetaKey(sessionId), tree.messages[tree.messages.length - 1].id)
        }
      }

      // Root selection (chat-demo session.rootMessageId): a null parent
      // switches the root to the new branch head; otherwise the root
      // stays at the session's legacy head (normalizeSession default) or
      // wherever it was already parked.
      const rootId = parentId === null ? ids[0] : (tree.rootId ?? ids[0])
      this.setMeta(treeRootMetaKey(sessionId), rootId)

      return ids.map((id) => this.getMessageRow(id))
    })
  }

  /**
   * Switch the selected sibling version at `messageId`'s position
   * (deepseek chat-demo selectVersion borrowing). Only allowed when
   * `messageId` is a sibling of — or itself on — the CURRENT visible
   * path: the user can only change direction from where they are
   * looking, never silently re-root the conversation to an unreachable
   * branch. Switching updates exactly one pointer (the parent row's
   * selected_child_id, or the stored root marker for top-level
   * branches); the switched-to node keeps its own selected_child_id, so
   * going back restores the whole subtree as it was. Returns false for
   * linear sessions (nothing to switch), unknown messages, and
   * unreachable targets — never throws for those. Soft-deleted rows are
   * not resurrected: the walk in {@link getVisibleMessages} stops at
   * them regardless of any pointer change.
   */
  selectMessageVersion(sessionId: string, messageId: string): boolean {
    const storedRoot = this.getTreeRoot(sessionId)
    if (storedRoot === undefined) return false
    return this.transaction(() => {
      const tree = normalizeMessageTree(this.loadTreeRows(sessionId), {
        rootId: storedRoot,
        boundaryId: this.getTreeBoundary(sessionId),
      })
      const target = tree.messages.find((m) => m.id === messageId)
      if (!target) return false
      const path = getVisibleMessages(tree)
      if (!path.some((p) => p.parentId === target.parentId)) return false
      if (target.parentId === null) {
        this.setMeta(treeRootMetaKey(sessionId), target.id)
      } else {
        this.statement(
          "selectMessageVersion",
          "UPDATE messages SET selected_child_id = ? WHERE id = ?",
        ).run(target.id, target.parentId)
      }
      return true
    })
  }

  /** Fetch one message row by id (throws when absent — internal read-back helper). */
  private getMessageRow(id: string): MessageRow {
    const row = this.statement(
      "getMessageRow",
      `SELECT ${MESSAGE_ROW_SELECT} FROM messages WHERE id = ?`,
    ).get(id) as RawMessageRow | undefined
    if (!row) {
      throw new Error(`session-store: message ${id} disappeared during write`)
    }
    return toMessageRow(row)
  }

  /** Bounded timeline index (hermes state_timeline borrowing), oldest last, soft-deleted rows flagged. */
  timeline(
    sessionId: string,
    limit = 200,
  ): Array<{
    id: string
    role: string
    turnOrdinal: number | null
    createdAt: string
    deleted: boolean
  }> {
    const rows = this.statement(
      "timeline",
      "SELECT id, role, turn_ordinal AS turnOrdinal, created_at AS createdAt, deleted_at AS deletedAt " +
        "FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?",
    ).all(sessionId, limit) as Array<{
      id: string
      role: string
      turnOrdinal: number | null
      createdAt: string
      deletedAt: string | null
    }>
    return rows.reverse().map((row) => ({
      id: row.id,
      role: row.role,
      turnOrdinal: row.turnOrdinal,
      createdAt: row.createdAt,
      deleted: row.deletedAt !== null,
    }))
  }

  /** Current schema_version recorded in the `meta` table (0 if unset or not yet migrated). */
  get schemaVersion(): number {
    // Pure read: probing sqlite_master directly so this getter never
    // triggers the lazy auto-migrate (reading the version of a fresh
    // database must report 0, not migrate it as a side effect).
    const metaExists = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
      .get()
    if (!metaExists) return 0
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
      { value: string | null } | undefined
    const version = row?.value == null ? Number.NaN : Number.parseInt(row.value, 10)
    return Number.isFinite(version) ? version : 0
  }

  /** Read a `meta` value (null when absent). */
  getMeta(key: string): string | null {
    const row = this.statement("getMeta", "SELECT value FROM meta WHERE key = ?").get(key) as
      { value: string | null } | undefined
    return row?.value ?? null
  }

  /** Write a `meta` value (upsert). Used by the legacy migration bookkeeping. */
  setMeta(key: string, value: string): void {
    this.statement(
      "setMeta",
      "INSERT INTO meta (key, value) VALUES (?, ?) " +
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    ).run(key, value)
  }

  /**
   * Insert or update a session. Re-appending an existing session id
   * updates title/updatedAt while preserving the original created_at.
   */
  appendSession(input: AppendSessionInput): SessionRow {
    const createdAt = input.createdAt ?? nowIso()
    const updatedAt = input.updatedAt ?? createdAt
    this.statement(
      "appendSession",
      `INSERT INTO sessions (id, workspace_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         workspace_id = excluded.workspace_id,
         title = excluded.title,
         updated_at = excluded.updated_at`,
    ).run(input.id, input.workspaceId, input.title ?? null, createdAt, updatedAt)
    return this.getSession(input.id) as SessionRow
  }

  /** Fetch one session by id (null when absent). */
  getSession(id: string): SessionRow | null {
    const row = this.statement(
      "getSession",
      "SELECT id, workspace_id, title, created_at, updated_at FROM sessions WHERE id = ?",
    ).get(id) as
      | {
          id: string
          workspace_id: string | null
          title: string | null
          created_at: string | null
          updated_at: string | null
        }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  /** All messages of a session, oldest first. */
  listMessages(sessionId: string, limit = 1000): MessageRow[] {
    const rows = this.statement(
      "listMessages",
      `SELECT ${MESSAGE_ROW_SELECT} FROM messages WHERE session_id = ? ORDER BY created_at, id LIMIT ?`,
    ).all(sessionId, limit) as RawMessageRow[]
    return rows.map(toMessageRow)
  }

  /**
   * Search messages across sessions (case-insensitive substring). Joins
   * the sessions table so results carry workspace context. The query is
   * treated as LITERAL text: `%` and `_` are escaped, so "100%" finds
   * the literal percent sign instead of matching every row. Soft-deleted
   * (rewound) messages are excluded.
   */
  searchMessages(
    query: string,
    opts?: { limit?: number; workspaceId?: string },
  ): MessageSearchHit[] {
    const limit = opts?.limit ?? 50
    // Escape the LIKE metacharacters (backslash first — it is the ESCAPE
    // character itself — then the two wildcards), then wrap in %...%.
    const pattern = `%${query.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
    const withWorkspace = opts?.workspaceId !== undefined
    const rows = (
      withWorkspace
        ? this.statement(
            "searchMessagesWorkspace",
            `SELECT m.session_id AS sessionId, s.workspace_id AS workspaceId, m.role AS role, m.content AS content, m.created_at AS createdAt
             FROM messages m JOIN sessions s ON s.id = m.session_id
             WHERE m.deleted_at IS NULL AND s.workspace_id = ? AND m.content LIKE ? ESCAPE '\\'
             ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
          ).all(opts?.workspaceId, pattern, limit)
        : this.statement(
            "searchMessagesAll",
            `SELECT m.session_id AS sessionId, s.workspace_id AS workspaceId, m.role AS role, m.content AS content, m.created_at AS createdAt
             FROM messages m JOIN sessions s ON s.id = m.session_id
             WHERE m.deleted_at IS NULL AND m.content LIKE ? ESCAPE '\\'
             ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
          ).all(pattern, limit)
    ) as Array<{
      sessionId: string
      workspaceId: string | null
      role: string
      content: string
      createdAt: string | null
    }>
    return rows
  }

  /**
   * Recent workspace events, newest first. Pass `type` to filter. This
   * is the read side the legacy JSONL replay migrates into.
   */
  listEvents(workspaceId: string, options?: { type?: string; limit?: number }): EventRow[] {
    const limit = options?.limit ?? 100
    const withType = options?.type !== undefined
    const rows = (
      withType
        ? this.statement(
            "listEventsTyped",
            "SELECT id, workspace_id, type, payload, at FROM events WHERE workspace_id = ? AND type = ? ORDER BY id DESC LIMIT ?",
          ).all(workspaceId, options?.type, limit)
        : this.statement(
            "listEventsAll",
            "SELECT id, workspace_id, type, payload, at FROM events WHERE workspace_id = ? ORDER BY id DESC LIMIT ?",
          ).all(workspaceId, limit)
    ) as Array<{
      id: number
      workspace_id: string | null
      type: string | null
      payload: string | null
      at: string | null
    }>
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      type: row.type,
      payload: row.payload === null ? null : (JSON.parse(row.payload) as unknown),
      at: row.at,
    }))
  }

  /**
   * Append a message. Re-appending an existing message id (e.g. a
   * dual-write retry) updates it in place rather than duplicating.
   *
   * Hash chain (minimax-code borrowing): every append extends the
   * session's chain — `seq` is the next position, `prev_hash` is the
   * current tail's hash (GENESIS_HASH when the session has no chained
   * rows yet), and `hash` commits to seq+session+role+content+prev.
   * A re-append of an already-chained id keeps its seq/prev_hash and
   * rehashes with the new content: an identical retry is a no-op for the
   * chain, while a content mutation intentionally breaks every link after
   * it (that is the tamper evidence verifyHistory reports).
   *
   * Tree columns (deepseek chat-demo borrowing): `parentId` /
   * `selectedChildId` are written when provided and PRESERVED on a
   * re-append that omits them (COALESCE with the stored value) — the
   * runtime's dual-write retries must not be able to silently detach
   * branch links that appendBranch established.
   */
  appendMessage(input: AppendMessageInput): void {
    this.transaction(() => {
      const existing = this.statement(
        "getMessageChainState",
        "SELECT seq, prev_hash FROM messages WHERE id = ?",
      ).get(input.id) as { seq: number | null; prev_hash: string | null } | undefined

      let seq: number
      let prevHash: string
      if (existing && existing.seq !== null) {
        // Already chained: keep its chain position stable.
        seq = existing.seq
        prevHash = existing.prev_hash ?? GENESIS_HASH
      } else {
        const tail = this.statement(
          "getChainTail",
          "SELECT hash FROM messages WHERE session_id = ? AND hash IS NOT NULL ORDER BY seq DESC LIMIT 1",
        ).get(input.sessionId) as { hash: string } | undefined
        const next = this.statement(
          "getNextSeq",
          "SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM messages WHERE session_id = ?",
        ).get(input.sessionId) as { seq: number }
        seq = next.seq
        prevHash = tail?.hash ?? GENESIS_HASH
      }

      const hash = messageChainHash({
        seq,
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        prevHash,
      })

      this.statement(
        "appendMessage",
        `INSERT INTO messages (id, session_id, role, content, created_at, turn_ordinal, seq, prev_hash, hash, parent_id, selected_child_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           session_id = excluded.session_id,
           role = excluded.role,
           content = excluded.content,
           created_at = excluded.created_at,
           turn_ordinal = excluded.turn_ordinal,
           seq = excluded.seq,
           prev_hash = excluded.prev_hash,
           hash = excluded.hash,
           parent_id = COALESCE(excluded.parent_id, messages.parent_id),
           selected_child_id = COALESCE(excluded.selected_child_id, messages.selected_child_id)`,
      ).run(
        input.id,
        input.sessionId,
        input.role,
        input.content,
        input.createdAt ?? nowIso(),
        input.turnOrdinal ?? 0,
        seq,
        prevHash,
        hash,
        input.parentId ?? null,
        input.selectedChildId ?? null,
      )
    })
  }

  /**
   * The history REPLAY EXIT (agency-swarm orphan-pair borrowing). Returns
   * the messages that are safe to send back to a strict provider after a
   * rewind: soft-deleted rows excluded, and every row whose content is a
   * JSON array of typed provider items passed through the orphan-pair
   * sanitizer (a call stripped of its output, or an output stripped of its
   * call, would make the whole replay request fail). Rows whose items are
   * ALL orphaned fragments are dropped entirely; rows with plain-text (or
   * non-JSON) content pass through untouched. Pass `fromTurnOrdinal` to
   * consume exactly the surviving history after `rewindFromTurn`; timeline
   * consumers get the same view with `fromTurnOrdinal` omitted.
   */
  replayMessages(
    sessionId: string,
    opts: { fromTurnOrdinal?: number; limit?: number; table?: PairingTable } = {},
  ): Array<MessageRow & { sanitizeReport: SanitizeReport | null }> {
    const from = opts.fromTurnOrdinal ?? 0
    const limit = opts.limit ?? 1000
    const table = opts.table ?? DEFAULT_PAIRING_TABLE
    const rows = this.statement(
      "replayMessages",
      `SELECT ${MESSAGE_ROW_SELECT}
       FROM messages
       WHERE session_id = ? AND deleted_at IS NULL AND COALESCE(turn_ordinal, 0) >= ?
       ORDER BY created_at, id LIMIT ?`,
    ).all(sessionId, from, limit) as RawMessageRow[]
    const out: Array<MessageRow & { sanitizeReport: SanitizeReport | null }> = []
    for (const row of rows) {
      const sanitized = sanitizeReplayContent(row.content, table)
      if (sanitized.droppedAll) continue
      out.push({
        ...toMessageRow(row),
        content: sanitized.content,
        sanitizeReport: sanitized.report,
      })
    }
    return out
  }

  /**
   * Walk the session's hash chain and report the first inconsistency
   * (minimax-code history-integrity borrowing). Rows written before the
   * chain existed (all chain columns NULL) are a legacy segment: they are
   * skipped without error and verification starts at the first chained
   * row, whose prev_hash must equal GENESIS_HASH. Soft-deleted (rewound)
   * rows stay in the chain and are verified like any other row — rewinding
   * hides rows from reads, it does not rewrite history.
   */
  verifyHistory(sessionId: string): HistoryVerification {
    const rows = this.statement(
      "verifyHistory",
      "SELECT id, seq, role, content, prev_hash AS prevHash, hash FROM messages WHERE session_id = ? ORDER BY rowid",
    ).all(sessionId) as Array<{
      id: string
      seq: number | null
      role: string
      content: string
      prevHash: string | null
      hash: string | null
    }>

    let prevHash: string | null = null
    for (const row of rows) {
      if (row.hash === null) {
        // Legacy row. A half-chained row (prev without hash) is itself
        // corruption, not a legacy marker.
        if (row.prevHash !== null) {
          return {
            ok: false,
            brokenAt: row.id,
            reason: "legacy row carries prev_hash but no hash",
          }
        }
        continue
      }
      const expectedPrev = prevHash ?? GENESIS_HASH
      if (row.prevHash !== expectedPrev) {
        return { ok: false, brokenAt: row.id, reason: "prev_hash does not match chain tail" }
      }
      if (row.seq === null) {
        return { ok: false, brokenAt: row.id, reason: "chained row is missing its seq" }
      }
      const expected = messageChainHash({
        seq: row.seq,
        sessionId,
        role: row.role,
        content: row.content,
        prevHash: row.prevHash,
      })
      if (expected !== row.hash) {
        return { ok: false, brokenAt: row.id, reason: "hash mismatch (content mutated?)" }
      }
      prevHash = row.hash
    }
    return { ok: true }
  }

  /** Append a workspace event; returns the autoincrement row id. */
  appendEvent(input: AppendEventInput): number {
    const result = this.statement(
      "appendEvent",
      "INSERT INTO events (workspace_id, type, payload, at) VALUES (?, ?, ?, ?)",
    ).run(input.workspaceId, input.type, encodePayload(input.payload), input.at ?? nowIso())
    return toNumber(result.lastInsertRowid)
  }

  /** Record one token-usage observation; returns the row id. */
  recordUsage(input: RecordUsageInput): number {
    const result = this.statement(
      "recordUsage",
      `INSERT INTO usage (workspace_id, role, provider, model, tokens_in, tokens_out, at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.workspaceId ?? null,
      input.role ?? null,
      input.provider ?? null,
      input.model ?? null,
      input.tokensIn ?? null,
      input.tokensOut ?? null,
      input.at ?? nowIso(),
    )
    return toNumber(result.lastInsertRowid)
  }

  /**
   * Enqueue a steering message. Idempotent by `receiptId`: a duplicate
   * enqueue is silently ignored and returns false.
   */
  enqueueSteering(input: EnqueueSteeringInput): boolean {
    const result = this.statement(
      "enqueueSteering",
      `INSERT OR IGNORE INTO steering_queue (workspace_id, text, source, receipt_id, created_at, consumed_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    ).run(
      input.workspaceId ?? null,
      input.text,
      input.source ?? null,
      input.receiptId,
      input.createdAt ?? nowIso(),
    )
    return toNumber(result.changes) > 0
  }

  /**
   * Mark the steering message with `receiptId` as consumed.
   * Returns true when a pending row was consumed, false when the id is
   * unknown or already consumed (consume-once semantics).
   */
  consumeSteering(receiptId: string, consumedAt?: string): boolean {
    const result = this.statement(
      "consumeSteering",
      "UPDATE steering_queue SET consumed_at = ? WHERE receipt_id = ? AND consumed_at IS NULL",
    ).run(consumedAt ?? nowIso(), receiptId)
    return toNumber(result.changes) > 0
  }

  /**
   * Mark pending steering rows whose text matches one of `texts` as
   * consumed (used by the runtime-event loop: a `steering-applied` event
   * carries the drained message contents, which is how the persistence
   * side learns the receipt was honored without the runtime having to
   * thread receipt ids through its in-memory queue).
   * Returns the number of rows newly consumed.
   */
  consumeSteeringTexts(workspaceId: string, texts: string[], consumedAt?: string): number {
    if (texts.length === 0) return 0
    const placeholders = texts.map(() => "?").join(", ")
    const result = this.statement(
      "consumeSteeringTexts",
      `UPDATE steering_queue SET consumed_at = ?
       WHERE workspace_id = ? AND consumed_at IS NULL AND text IN (${placeholders})`,
    ).run(consumedAt ?? nowIso(), workspaceId, ...texts)
    return toNumber(result.changes)
  }

  /** Pending (unconsumed) steering rows for a workspace, oldest first. */
  pendingSteering(
    workspaceId: string,
  ): Array<{ receiptId: string; text: string; source: string | null; createdAt: string | null }> {
    return (
      this.statement(
        "pendingSteering",
        `SELECT receipt_id, text, source, created_at FROM steering_queue
         WHERE workspace_id = ? AND consumed_at IS NULL ORDER BY id`,
      ).all(workspaceId) as Array<{
        receipt_id: string
        text: string
        source: string | null
        created_at: string | null
      }>
    ).map((r) => ({
      receiptId: r.receipt_id,
      text: r.text,
      source: r.source,
      createdAt: r.created_at,
    }))
  }

  /** Usage rows for a workspace, oldest first. */
  listUsage(
    workspaceId: string,
    limit = 100,
  ): Array<{
    tokensIn: number | null
    tokensOut: number | null
    model: string | null
    at: string | null
  }> {
    return (
      this.statement(
        "listUsage",
        `SELECT tokens_in, tokens_out, model, at FROM usage
         WHERE workspace_id = ? ORDER BY id LIMIT ?`,
      ).all(workspaceId, limit) as Array<{
        tokens_in: number | null
        tokens_out: number | null
        model: string | null
        at: string | null
      }>
    ).map((r) => ({ tokensIn: r.tokens_in, tokensOut: r.tokens_out, model: r.model, at: r.at }))
  }

  /**
   * Accumulate lesson efficacy for a (role, bucket) pair: repeated
   * upserts ADD to injected_count and delta_sum, which is the aggregate
   * the efficacy ledger tracks across many injections.
   */
  upsertLessonEfficacy(
    role: string,
    bucket: string,
    injectedCount: number,
    deltaSum: number,
  ): void {
    this.statement(
      "upsertLessonEfficacy",
      `INSERT INTO lesson_efficacy (role, bucket, injected_count, delta_sum)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (role, bucket) DO UPDATE SET
         injected_count = injected_count + excluded.injected_count,
         delta_sum = delta_sum + excluded.delta_sum`,
    ).run(role, bucket, injectedCount, deltaSum)
  }

  /** All efficacy rows for a role, ordered by bucket. */
  getLessonEfficacy(role: string): LessonEfficacyRow[] {
    const rows = this.statement(
      "getLessonEfficacy",
      "SELECT role, bucket, injected_count, delta_sum FROM lesson_efficacy WHERE role = ? ORDER BY bucket",
    ).all(role) as Array<{
      role: string
      bucket: string
      injected_count: number
      delta_sum: number
    }>
    return rows.map((row) => ({
      role: row.role,
      bucket: row.bucket,
      injectedCount: row.injected_count,
      deltaSum: row.delta_sum,
    }))
  }

  /**
   * List sessions, newest first. Pass `workspaceId` to scope to one
   * workspace.
   */
  listSessions(workspaceId?: string, limit = 100): SessionRow[] {
    const rows = (
      workspaceId === undefined
        ? this.statement(
            "listSessionsAll",
            "SELECT id, workspace_id, title, created_at, updated_at FROM sessions ORDER BY created_at DESC, id DESC LIMIT ?",
          ).all(limit)
        : this.statement(
            "listSessionsWorkspace",
            "SELECT id, workspace_id, title, created_at, updated_at FROM sessions WHERE workspace_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
          ).all(workspaceId, limit)
    ) as Array<{
      id: string
      workspace_id: string | null
      title: string | null
      created_at: string | null
      updated_at: string | null
    }>
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  /** Append an audit record; returns the row id. */
  appendAudit(kind: string, payload?: unknown, at?: string): number {
    const result = this.statement(
      "appendAudit",
      "INSERT INTO audit (kind, payload, at) VALUES (?, ?, ?)",
    ).run(kind, encodePayload(payload), at ?? nowIso())
    return toNumber(result.lastInsertRowid)
  }

  /**
   * Run `fn` inside a single SQLite transaction: either every write in
   * `fn` lands or none does. Used by callers that must import a batch
   * of rows atomically (e.g. the legacy JSONL migration).
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  /**
   * BEGIN IMMEDIATE variant of {@link transaction} for whole-store
   * replacements (backup restore / clear, chat-demo "replace in one
   * transaction" borrowing): the write lock is taken up front so the
   * delete-everything + reinsert pass can never interleave with a
   * concurrent writer between the DELETEs and the INSERTs.
   */
  transactionImmediate<T>(fn: () => T): T {
    if (!this.migrated) this.migrate()
    return this.db.transaction(fn).immediate()
  }

  /**
   * Replace the ENTIRE sessions/messages content atomically (chat-demo
   * replaceHistory borrowing — validate fully first, then swap; used by
   * the backup module for restore AND for "clear all" via empty input).
   * Rows are inserted VERBATIM with all three hash-chain columns NULL:
   * restored rows become a legacy segment for {@link verifyHistory},
   * exactly like rows that predate the v3 migration — the archive
   * deliberately does not carry chain hashes, so trust must be
   * re-established from the restored content onward. Per-session tree
   * markers (selected root / linear-era boundary) are reset from
   * `treeMarkers`; markers of sessions not in the replacement are
   * dropped, while unrelated meta rows (e.g. the legacy_seq event-
   * migration bookkeeping) survive.
   */
  replaceSessions(
    sessions: ReplaceSessionRow[],
    messages: ReplaceMessageRow[],
    treeMarkers: ReadonlyMap<string, ReplaceTreeMarker>,
  ): void {
    this.transactionImmediate(() => {
      // Tree markers of every session about to be replaced must go first;
      // the imported files re-establish their own below.
      const setTreeMeta = this.statement(
        "replaceSessionsSetMeta",
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      )
      for (const prefix of [treeRootMetaKey(""), treeBoundaryMetaKey("")]) {
        const escaped = prefix.replace(/[\\%_]/g, (ch) => `\\${ch}`)
        this.statement(
          "replaceSessionsDropTreeMeta",
          "DELETE FROM meta WHERE key LIKE ? ESCAPE '\\'",
        ).run(`${escaped}%`)
      }
      this.statement("replaceSessionsDropMessages", "DELETE FROM messages").run()
      this.statement("replaceSessionsDropSessions", "DELETE FROM sessions").run()

      const insertSession = this.statement(
        "replaceSessionsInsertSession",
        "INSERT INTO sessions (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      for (const session of sessions) {
        insertSession.run(
          session.id,
          session.workspaceId,
          session.title,
          session.createdAt,
          session.updatedAt,
        )
      }

      const insertMessage = this.statement(
        "replaceSessionsInsertMessage",
        `INSERT INTO messages (id, session_id, role, content, created_at, turn_ordinal, deleted_at, parent_id, selected_child_id, seq, prev_hash, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      )
      for (const message of messages) {
        insertMessage.run(
          message.id,
          message.sessionId,
          message.role,
          message.content,
          message.createdAt,
          message.turnOrdinal,
          message.deletedAt,
          message.parentId,
          message.selectedChildId,
        )
      }

      for (const [sessionId, marker] of treeMarkers) {
        if (marker.rootId != null) setTreeMeta.run(treeRootMetaKey(sessionId), marker.rootId)
        if (marker.boundaryId != null) {
          setTreeMeta.run(treeBoundaryMetaKey(sessionId), marker.boundaryId)
        }
      }
    })
  }

  /** Close the database. Idempotent; the store is unusable afterwards. */
  close(): void {
    this.db.close()
  }

  /**
   * Prepared-statement cache. Statements reference real tables, so they
   * can only be prepared after the schema exists — this helper lazily
   * migrates on first use and then caches one statement per SQL string.
   */
  private statement(name: string, sql: string): Database.Statement {
    if (!this.migrated) this.migrate()
    let stmt = this.statements.get(name)
    if (!stmt) {
      stmt = this.db.prepare(sql)
      this.statements.set(name, stmt)
    }
    return stmt
  }
}

export { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js"
export {
  buildMessageVersions,
  getVisibleMessages,
  normalizeMessageTree,
  treeBoundaryMetaKey,
  treeRootMetaKey,
  type MessageTree,
  type MessageTreeRow,
  type MessageVersions,
  type NormalizedTreeMessage,
  type NormalizeTreeOptions,
} from "./message-tree.js"
export {
  clearSessionsBackup,
  exportSessionsBackup,
  importSessionsBackup,
  BackupError,
  BACKUP_FORMAT_VERSION,
  type BackupArchive,
  type BackupManifest,
  type ArchiveMessage,
  type SessionBackupFile,
  type SessionIndexEntry,
} from "./backup.js"
export {
  GENESIS_HASH,
  messageChainHash,
  serializeChainEntry,
  type MessageChainEntry,
} from "./hash-chain.js"
export { createSessionRuntimeListener, type SessionRuntimeEvent } from "./runtime-listener.js"
export {
  DEFAULT_PAIRING_TABLE,
  sanitizeHistoryItems,
  sanitizeReplayContent,
  type AdjacentFollowerRule,
  type CallIdPairingRule,
  type HistoryItem,
  type PairingRule,
  type PairingTable,
  type RequestResponsePairingRule,
  type SanitizeReport,
  type SanitizeResult,
} from "./message-sanitizer.js"
export {
  HydrationInvalidatedError,
  readWithHydrationRetry,
  readWithHydrationRetryAsync,
} from "./hydration-retry.js"
export {
  DEFAULT_RETENTION_MS,
  RetentionCache,
  normalizeRetentionMs,
  setDefaultRetentionMs,
  type RetentionCacheOptions,
  type RetentionCacheStats,
} from "./retention-cache.js"
export {
  SYSTEM_KIND_PREFIX,
  admitSubmission,
  affectsModelContext,
  hasQueuedReset,
  isDisplayOnlySubmission,
  type Admission,
  type AdmissionDecision,
  type DisplayPayload,
  type QueuedSubmission,
  type QueueState,
  type SubmissionDraft,
  type SubmissionType,
} from "./submission-admission.js"
