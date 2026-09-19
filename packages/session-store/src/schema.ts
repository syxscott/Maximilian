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
 */

/** Current schema version. Bump when adding tables/columns. */
export const SCHEMA_VERSION = 2

/**
 * The full schema, applied inside one transaction by `migrate()`.
 * Every statement is idempotent so re-running the migration is a no-op.
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
  created_at TEXT
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
CREATE INDEX IF NOT EXISTS idx_usage_workspace_at ON usage (workspace_id, at);
`
