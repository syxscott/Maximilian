/**
 * Legacy-compatible read for the per-workspace JSONL event logs that
 * `apps/api/src/event-log.ts` writes (`<rootDir>/events/{id}.jsonl`).
 *
 * Each line is one JSON object: `{ seq, type, payload, ts }` where
 * `seq` is a monotonic per-workspace counter and `ts` an ISO timestamp.
 * The format copes with crashes by treating a half-written line as
 * invalid JSON that readers skip — this parser mirrors that contract
 * exactly (same field validation as the API's `deserialize`), so a
 * reconnecting consumer can switch between the JSONL file and the
 * SQLite side store without noticing a format change.
 */

import fs from "node:fs"

/** One parsed legacy event — wire-compatible with `LoggedEvent`. */
export interface ParsedEvent {
  /** Monotonic per-workspace sequence number. */
  seq: number
  /** Event type, e.g. "task-start", "workspace", etc. */
  type: string
  /** Arbitrary JSON payload. */
  payload: unknown
  /** ISO-8601 timestamp (a missing/invalid `ts` is defaulted, as the API writer does). */
  ts: string
}

/**
 * Parse one JSONL line. Returns null on malformed lines — blank lines,
 * truncated writes, non-JSON, or objects missing a numeric `seq` /
 * string `type` — so callers can skip them without aborting.
 */
function parseLine(line: string): ParsedEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const obj = JSON.parse(trimmed) as Partial<ParsedEvent>
    if (typeof obj.seq !== "number" || typeof obj.type !== "string") return null
    return {
      seq: obj.seq,
      type: obj.type,
      payload: obj.payload,
      ts: typeof obj.ts === "string" ? obj.ts : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

/**
 * Read a legacy per-workspace JSONL event log synchronously and return
 * the parsed events in file order (ascending seq — writers append in
 * order). Corrupt lines are skipped, never fatal. A missing file reads
 * as an empty log so callers can probe paths optimistically; any other
 * I/O error propagates.
 */
export function readLegacyWorkspaceEvents(jsonlPath: string): ParsedEvent[] {
  let raw: string
  try {
    raw = fs.readFileSync(jsonlPath, "utf-8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
    throw err
  }
  const events: ParsedEvent[] = []
  for (const line of raw.split("\n")) {
    const event = parseLine(line)
    if (event) events.push(event)
  }
  return events
}
