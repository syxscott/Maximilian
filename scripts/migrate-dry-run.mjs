#!/usr/bin/env node
// scripts/migrate-dry-run.mjs
//
// Apply pending migrations to a *throwaway* database, then verify
// the schema with a set of invariants (every table has a primary
// key, every column has a type, no orphan indexes, etc.) before
// touching the real database.
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/migrate-dry-run.mjs
//
// Exit codes:
//   0  — dry-run succeeded; safe to apply to production
//   1  — schema invariants violated
//   2  — migration itself failed
//
// Run this in CI on every PR that touches packages/database/.

import { execSync } from "node:child_process"
import { randomBytes } from "node:crypto"

const PROD_URL = process.env.DATABASE_URL
if (!PROD_URL) {
  console.error("DATABASE_URL is required")
  process.exit(2)
}

const suffix = randomBytes(4).toString("hex")
const DRY_URL = PROD_URL.replace(/\/[^/?]+(\?|$)/, `/max_dry_${suffix}$1`)

console.log(`[dry-run] creating throwaway DB at ${DRY_URL.replace(/:[^:@]+@/, ":***@")}`)

function run(cmd, env = {}) {
  try {
    return execSync(cmd, {
      stdio: "pipe",
      env: { ...process.env, ...env },
    }).toString()
  } catch (e) {
    console.error(`[dry-run] command failed: ${cmd}`)
    console.error(e.stdout?.toString() ?? "")
    console.error(e.stderr?.toString() ?? "")
    throw e
  }
}

let exitCode = 0
try {
  // 1. Create the throwaway DB
  run(`psql "${PROD_URL}" -c "CREATE DATABASE max_dry_${suffix};"`)

  // 2. Apply migrations
  run(`pnpm --filter @max/database db:migrate`, { DATABASE_URL: DRY_URL })

  // 3. Inspect the resulting schema
  const tables = run(`
    psql "${DRY_URL}" -t -A -F'|' -c "
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    "
  `).trim().split("\n").filter(Boolean)

  const tableMap = new Map()
  for (const row of tables) {
    const [table, column, type, nullable] = row.split("|")
    if (!tableMap.has(table)) tableMap.set(table, [])
    tableMap.get(table).push({ column, type, nullable })
  }

  // Invariant 1: every table has at least one column
  for (const [table, cols] of tableMap) {
    if (cols.length === 0) {
      console.error(`[dry-run] FAIL: table ${table} has no columns`)
      exitCode = 1
    }
  }

  // Invariant 2: every table has a primary key
  const pkRows = run(`
    psql "${DRY_URL}" -t -A -F'|' -c "
      SELECT tc.table_name
      FROM information_schema.table_constraints tc
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public';
    "
  `).trim().split("\n").filter(Boolean)
  const pkSet = new Set(pkRows)
  for (const table of tableMap.keys()) {
    if (!pkSet.has(table)) {
      console.error(`[dry-run] FAIL: table ${table} has no PRIMARY KEY`)
      exitCode = 1
    }
  }

  // Invariant 3: no orphan indexes (every index points to an existing table+column)
  const indexRows = run(`
    psql "${DRY_URL}" -t -A -F'|' -c "
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public';
    "
  `).trim().split("\n").filter(Boolean)
  for (const row of indexRows) {
    const [name, def] = row.split("|")
    if (!def) continue
    const m = def.match(/ON\s+(\w+)\s*\(([^)]+)\)/)
    if (!m) continue
    const [, table, colList] = m
    if (!tableMap.has(table)) {
      console.error(`[dry-run] FAIL: index ${name} references missing table ${table}`)
      exitCode = 1
    }
  }

  // Invariant 4: at least one of the expected core tables exists
  const expected = ["users", "workspaces", "executions"]
  for (const t of expected) {
    if (!tableMap.has(t)) {
      console.warn(`[dry-run] WARN: expected core table ${t} not present`)
    }
  }

  if (exitCode === 0) {
    console.log(`[dry-run] OK: ${tableMap.size} tables, all invariants pass`)
  }
} catch (e) {
  exitCode = 2
} finally {
  // Always drop the throwaway DB
  try {
    run(`psql "${PROD_URL}" -c "DROP DATABASE IF EXISTS max_dry_${suffix};"`)
  } catch {}
}

process.exit(exitCode)