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
    // Snapshot the applied-migration count *before* running drizzle's migrate
    // so we can return a real count instead of the prior `-1` placeholder.
    // The pg-integration test re-runs migrations on an already-applied schema
    // and asserts `applied === 0`; the placeholder would have falsely failed.
    const before = await countAppliedMigrations(sql);
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder: folder });
    const after = await countAppliedMigrations(sql);
    return { applied: after - before };
  } finally {
    await sql.end();
  }
}

async function countAppliedMigrations(sql: ReturnType<typeof postgres>): Promise<number> {
  // The `__drizzle_migrations` table is created lazily by `migrate()` itself,
  // so on a brand-new DB the first probe returns 0 (table absent is fine).
  const rows = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = '__drizzle_migrations'
  `;
  if (!rows[0]?.count) return 0;
  const applied = await sql<{ id: number }[]>`SELECT id FROM "__drizzle_migrations"`;
  return applied.length;
}

/** Migration status — used by health checks. */
export interface MigrationStatus {
  applied: string[];
  pending: string[];
}

const JOURNAL_FILE = "meta/_journal.json";

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
    // Check if the migrations table exists
    const exists = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '__drizzle_migrations'
    `;
    if (!exists[0]?.count) {
      return { applied: [], pending: all };
    }
    const rows = await sql<{ hash: string }[]>`
      SELECT hash FROM "__drizzle_migrations" ORDER BY id
    `;
    // drizzle stores the migration filename in `hash` column
    const applied = new Set(rows.map((r) => r.hash));
    const appliedTags = all.filter((tag) => applied.has(tag));
    const pending = all.filter((tag) => !applied.has(tag));
    return { applied: appliedTags, pending };
  } finally {
    await sql.end();
  }
}
