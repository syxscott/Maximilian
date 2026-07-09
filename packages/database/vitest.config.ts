import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globals: false,
    // pg-integration.test.ts and provider-config.test.ts both call
    // runMigrations() in beforeAll. Drizzle's migrate() opens with
    // `CREATE SCHEMA IF NOT EXISTS "drizzle"`, which is not atomic in
    // Postgres — two parallel workers race on pg_namespace and the
    // loser trips `pg_namespace_nspname_index` (23505). Running the
    // files serially makes the second call's IF NOT EXISTS a no-op.
    fileParallelism: false,
  },
})
