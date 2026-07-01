#!/usr/bin/env node
/**
 * Migration CLI for Maximilian.
 *
 * Wraps `@max/database`'s `runMigrations` so ops, CI, and local dev
 * have a single command for applying schema changes. Idempotent —
 * running twice in a row is safe; drizzle's migrator tracks applied
 * migrations in the `__drizzle_migrations` table.
 *
 * Usage:
 *   node scripts/migrate.mjs                        # migrate DATABASE_URL
 *   DATABASE_URL=postgres://… node scripts/migrate.mjs
 *
 * The script intentionally reads `DATABASE_URL` from env rather than
 * accepting a positional arg — keeps the credential off the command
 * line in shared shells / CI logs.
 */
import { runMigrations } from "../packages/database/dist/migrator.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL is not set — refusing to run with no target.");
  process.exit(2);
}

console.log(`[migrate] applying migrations against ${url.replace(/:[^:@]+@/, ":***@")}`);
const before = Date.now();
try {
  // Drizzle's `migrate()` returns void and tracks applied migrations
  // internally via the __drizzle_migrations table. Running twice in a
  // row is a no-op, so the only way this throws is on a real failure
  // (bad SQL, connection drop, etc.).
  await runMigrations({ url });
  const elapsed = Date.now() - before;
  console.log(`[migrate] done in ${elapsed}ms`);
} catch (err) {
  console.error("[migrate] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
}
