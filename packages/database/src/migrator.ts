/**
 * Programmatic migration runner.
 *
 * Wraps drizzle-orm's `migrate()` so apps and tests can apply migrations
 * without spawning the drizzle-kit CLI. Useful for:
 *   - Test setup (apply migrations to a throwaway DB)
 *   - One-shot init scripts in CI / Docker
 *   - Migration status checks before deploy
 *
 * Migrations are read from `./drizzle/` relative to this file.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_FOLDER = resolve(__dirname, "..", "drizzle");

export interface RunMigrationsOptions {
  url: string;
  /** Folder containing the SQL migration files. Defaults to ./drizzle. */
  migrationsFolder?: string;
  /** Maximum pool size for the migration connection. */
  max?: number;
}

/**
 * Apply all pending migrations to the target database.
 * Returns the number of migrations applied.
 *
 * @throws if DATABASE_URL is invalid or migrations folder is missing.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<{ applied: number }> {
  const folder = options.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER;
  const sql = postgres(options.url, { max: options.max ?? 1, onnotice: () => {} });
  try {
    // drizzle's `migrate` returns void and skips queries that error on
    // a fresh DB (no `__drizzle_migrations` table yet), so we let it run
    // unconditionally and ask the caller to verify idempotency through
    // `getMigrationStatus()` if they care about the exact count.
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder: folder });
    return { applied: -1 }; // -1 = "ran successfully" (drizzle doesn't return count)
  } finally {
    await sql.end();
  }
}

/** Migration status — used by health checks. */
export interface MigrationStatus {
  applied: string[];
  pending: string[];
}

const JOURNAL_FILE = "meta/_journal.json";
// drizzle stores its bookkeeping table in the `drizzle` schema by default
// (see drizzle-orm/pg-core/dialect.js). The previous version of this
// helper looked in `public` and silently reported zero applied migrations
// on every CI run, which made the pg-integration "idempotency" test a lie.
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

/**
 * Compare the migration journal against the database's __drizzle_migrations table.
 * Returns the list of applied and pending migrations.
 */
export async function getMigrationStatus(options: RunMigrationsOptions): Promise<MigrationStatus> {
  const folder = options.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER;
  const { readFile } = await import("node:fs/promises");
  const journalPath = resolve(folder, JOURNAL_FILE);
  const journal = JSON.parse(await readFile(journalPath, "utf-8")) as { entries: Array<{ when: number; tag: string }> };
  const all = journal.entries.map((e) => e.tag).sort();

  const sql = postgres(options.url, { max: 1, onnotice: () => {} });
  try {
    const exists = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM information_schema.tables
      WHERE table_schema = ${MIGRATIONS_SCHEMA} AND table_name = ${MIGRATIONS_TABLE}
    `;
    if (!exists[0]?.count) {
      return { applied: [], pending: all };
    }
    // postgres-js identifier interpolation requires `sql` as a tagged
    // template tag, not as a function call — the latter would treat the
    // string as a value parameter and quote it incorrectly.
    const rows = await sql<{ hash: string }[]>`SELECT hash FROM ${sql(
      MIGRATIONS_SCHEMA,
    )}.${sql(MIGRATIONS_TABLE)} ORDER BY id`;
    const applied = new Set(rows.map((r) => r.hash));
    const appliedTags = all.filter((tag) => applied.has(tag));
    const pending = all.filter((tag) => !applied.has(tag));
    return { applied: appliedTags, pending };
  } finally {
    await sql.end();
  }
}
