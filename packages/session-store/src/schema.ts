// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * SQLite schema for the session store — lean history side-store.
 *
 * IMPORTANT CONTRACT: the workspace JSON store (FileWorkspaceStore)
 * remains the AUTHORITATIVE workspace storage. This database is a side
 * store for session/message/event history plus a few small ledgers
 * (usage, steering, lesson efficacy, audit). Nothing here is load-
 * bearing for workspace state; losing the DB file must be survivable.
 *
 * All timestamps are ISO-8601 strings (`new Date().toISOString()`), so
 * lexicographic ordering == chronological ordering and the files stay
 * human-inspectable — the same tradeoff as `apps/api/src/event-log.ts`.
 *
 * Migrations are FORWARD-ONLY and versioned via the `meta` table
 * (`schema_version`). `migrate()` is idempotent: CREATE TABLE IF NOT
 * EXISTS statements are safe to re-run, and a database written by a
 * NEWER schema version refuses to open (no downgrades).
 *
 * Message tree (deepseek chat-demo borrowing, v4): `parent_id` and
 * `selected_child_id` turn the linear transcript into a versioned tree.
 * Rows written before v4 keep both columns NULL — they are the linear
 * legacy segment, linked in memory by (created_at, id) order exactly
 * like the reference implementation's normalizeSession.
 *
 * Full-text search (opencode search-index borrowing, v5): an FTS5
 * external-content virtual table over `messages.content`, maintained by
 * triggers so appends/updates/deletes/replaces need no manual reindex.
 * The index is derived state — it can always be rebuilt from `messages`
 * (`INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')`), which is
 * what the v4 -> v5 migration edge does for pre-existing rows.
 */

/** Current schema version. Bump when adding tables/columns. */
export const SCHEMA_VERSION = 5

/**
 * FTS5 external-content index over `messages.content` plus the triggers
 * that keep it in sync (opencode search-index.ts borrowing, adapted to a
 * single-column message table).
 *
 * `content='messages'` + `content_rowid='rowid'` makes the FTS table a
 * derived index over the real rows: no text is copied into the index, and
 * the `'rebuild'` command can repopulate it from `messages` at any time.
 * The update trigger must issue the external-content `'delete'` command
 * with the OLD text before inserting the new text, or SQLite cannot find
 * the entry to remove.
 *
 * `tokenize='porter unicode61 remove_diacritics 2'` matches the reference
 * tokenizer: Unicode-aware, diacritic-folding, and light English stemming
 * so "fixed" also matches "fix".
 */
export const SEARCH_FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='rowid',
  tokenize='porter unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF content ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
`

/**
 * The full schema, applied inside one transaction by `migrate()`.
 * Every statement is idempotent so re-running the migration is a no-op.
 *
 * NOTE: this reflects the CURRENT (v4) shape of every table, so a fresh
 * database is born with all columns; the migration edges below only
 * patch databases written by older versions.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  title TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  role TEXT,
  content TEXT,
  created_at TEXT,
  deleted_at TEXT,
  turn_ordinal INTEGER,
  seq INTEGER,
  prev_hash TEXT,
  hash TEXT,
  parent_id TEXT,
  selected_child_id TEXT
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  round INTEGER,
  started_at TEXT,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT,
  type TEXT,
  payload TEXT,
  at TEXT
);

CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT,
  role TEXT,
  provider TEXT,
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  at TEXT
);

CREATE TABLE IF NOT EXISTS steering_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT,
  text TEXT,
  source TEXT,
  receipt_id TEXT UNIQUE,
  created_at TEXT,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS lesson_efficacy (
  role TEXT,
  bucket TEXT,
  injected_count INTEGER,
  delta_sum REAL,
  PRIMARY KEY (role, bucket)
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT,
  payload TEXT,
  at TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_workspace_at ON events (workspace_id, at);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_session_parent ON messages (session_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_usage_workspace_at ON usage (workspace_id, at);

${SEARCH_FTS_SQL}
`
