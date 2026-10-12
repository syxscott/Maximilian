#!/usr/bin/env node
/**
 * One-shot migration of legacy per-workspace JSONL event logs
 * (`apps/api/src/event-log.ts` format) into the SQLite session store.
 *
 * IDEMPOTENCY: for every workspace the high-water `seq` already
 * imported is tracked in the `meta` table (`legacy_seq:<workspaceId>`).
 * Re-running the migration imports only events with a higher seq, so
 * running it twice (or after the legacy log has grown) imports each
 * event exactly once — events already present are skipped, not
 * duplicated. Corrupt JSONL lines are skipped per the legacy reader
 * contract (`readLegacyWorkspaceEvents`).
 *
 * CLI usage:
 *   pnpm --filter @max/session-store migrate-legacy <dbPath> <eventsDir>
 * (or `tsx src/migrate-legacy.ts <dbPath> <eventsDir>`) where
 * `<eventsDir>` is the directory holding `<workspaceId>.jsonl` files.
 */

import path from "node:path"
import { fileURLToPath } from "node:url"
import fs from "node:fs"
import { SessionStore } from "./index.js"
import { readLegacyWorkspaceEvents } from "./legacy.js"

/** Result of one `migrateLegacyEventLogs` run. */
export interface LegacyMigrationSummary {
  /** Number of `*.jsonl` workspace logs considered. */
  workspaces: number
  /** Events newly imported by this run. */
  imported: number
  /** Parsed events skipped because they were already imported. */
  skipped: number
}

/** Options for {@link migrateLegacyEventLogs}. */
export interface MigrateLegacyOptions {
  store: SessionStore
  /** Directory containing per-workspace `<workspaceId>.jsonl` logs. */
  eventsDir: string
  /** Restrict the migration to these workspace ids (default: all logs found). */
  workspaceIds?: string[]
}

/**
 * Import legacy JSONL event logs into the store's `events` table.
 * Idempotent — see the module header. Returns a per-run summary.
 */
export function migrateLegacyEventLogs(options: MigrateLegacyOptions): LegacyMigrationSummary {
  const { store, eventsDir, workspaceIds } = options
  const summary: LegacyMigrationSummary = { workspaces: 0, imported: 0, skipped: 0 }

  let files: string[]
  try {
    files = fs.readdirSync(eventsDir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return summary
    throw err
  }
  const wanted = workspaceIds === undefined ? undefined : new Set(workspaceIds)
  for (const file of files.filter((f) => f.endsWith(".jsonl")).sort()) {
    const workspaceId = file.slice(0, -".jsonl".length)
    if (wanted && !wanted.has(workspaceId)) continue
    summary.workspaces++
    const events = readLegacyWorkspaceEvents(path.join(eventsDir, file))
    const metaKey = `legacy_seq:${workspaceId}`
    const highWater = Number.parseInt(store.getMeta(metaKey) ?? "0", 10) || 0
    const pending = events.filter((event) => event.seq > highWater).sort((a, b) => a.seq - b.seq)
    summary.skipped += events.length - pending.length
    if (pending.length === 0) continue
    store.transaction(() => {
      for (const event of pending) {
        store.appendEvent({
          workspaceId,
          type: event.type,
          payload: event.payload,
          at: event.ts,
        })
      }
      store.setMeta(metaKey, String(pending[pending.length - 1]?.seq ?? highWater))
    })
    summary.imported += pending.length
  }
  return summary
}

/** CLI entry point: `<dbPath> <eventsDir>`. */
function main(argv: string[]): void {
  const [dbPath, eventsDir] = argv
  if (!dbPath || !eventsDir) {
    console.error("usage: max-migrate-legacy <dbPath> <eventsDir>")
    process.exitCode = 1
    return
  }
  const store = new SessionStore({ path: dbPath })
  try {
    store.migrate()
    const summary = migrateLegacyEventLogs({ store, eventsDir })
    console.log(JSON.stringify(summary, null, 2))
  } finally {
    store.close()
  }
}

// Only run the CLI body when this file is the entry point — importing
// the module (e.g. from tests) must stay side-effect free.
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main(process.argv.slice(2))
