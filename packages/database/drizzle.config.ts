import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration for the Maximilian database.
 *
 * Run from packages/database:
 *   pnpm db:generate   # diff schema → SQL migration file
 *   pnpm db:migrate    # apply pending migrations
 *   pnpm db:push       # push schema directly (dev only)
 *   pnpm db:studio     # open Drizzle Studio
 *
 * DATABASE_URL must be set in .env or the environment.
 */
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/maximilian",
  },
  verbose: true,
  strict: true,
});
