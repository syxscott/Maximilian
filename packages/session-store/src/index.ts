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
import Database from "better-sqlite3"
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js"

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
}

/** Input for {@link SessionStore.appendEvent}. */
export interface AppendEventInput {
  workspaceId: string
  type: string
  payload?: unknown
  at?: string
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
          this.db.exec(SCHEMA_SQL)
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
      "SELECT id, session_id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at, id LIMIT ?",
    ).all(sessionId, limit) as Array<{
      id: string
      session_id: string
      role: string
      content: string
      created_at: string | null
    }>
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    }))
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
   */
  appendMessage(input: AppendMessageInput): void {
    this.statement(
      "appendMessage",
      `INSERT INTO messages (id, session_id, role, content, created_at, turn_ordinal)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         session_id = excluded.session_id,
         role = excluded.role,
         content = excluded.content,
         created_at = excluded.created_at,
         turn_ordinal = excluded.turn_ordinal`,
    ).run(
      input.id,
      input.sessionId,
      input.role,
      input.content,
      input.createdAt ?? nowIso(),
      input.turnOrdinal ?? 0,
    )
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
export { createSessionRuntimeListener, type SessionRuntimeEvent } from "./runtime-listener.js"
