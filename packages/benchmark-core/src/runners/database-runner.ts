/**
 * Phase 9 — Database Benchmark Runner.
 *
 * Executes SQL against an in-memory SQLite sandbox. Each execution is
 * fully isolated: a fresh DB is created, initialized with the task's DDL,
 * and destroyed after the query runs. No mocks, no shortcuts.
 */

import Database from "better-sqlite3";

export interface SqlExecutionResult {
  rows: Record<string, unknown>[];
  columns: string[];
  error?: string;
}

export class DatabaseRunner {
  /**
   * Execute SQL in an isolated in-memory SQLite database.
   *
   * @param sql - The agent-generated SQL to execute.
   * @param context - Must contain `ddl` (CREATE TABLE + INSERT statements).
   * @returns The query result rows, column names, or an error message.
   */
  executeSql(sql: string, context: Record<string, unknown>): SqlExecutionResult {
    const ddl = context.ddl;
    if (typeof ddl !== "string" || ddl.length === 0) {
      return { rows: [], columns: [], error: "context.ddl is missing or empty" };
    }

    const db = new Database(":memory:");
    try {
      // 1. Initialize sandbox with task DDL.
      db.exec(ddl);

      // Set a busy timeout so pathological queries don't block forever.
      // better-sqlite3 is synchronous, so we use PRAGMA to bound the
      // worst case. 5 seconds is generous for a sandbox query.
      db.pragma("busy_timeout = 5000");

      // 2. Execute agent-generated SQL.
      const stmt = db.prepare(sql);
      const rawRows = stmt.all();

      // 3. Extract column names from the statement info.
      const columns = stmt.columns().map((c) => c.name);

      // 4. Normalize rows to Record<string, unknown>.
      const rows = rawRows.map((row) => {
        if (typeof row === "object" && row !== null && !Array.isArray(row)) {
          return row as Record<string, unknown>;
        }
        // If better-sqlite3 returns a primitive (e.g. SELECT 1), wrap it.
        return { value: row } as Record<string, unknown>;
      });

      return { rows, columns };
    } catch (err) {
      return {
        rows: [],
        columns: [],
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      db.close();
    }
  }

  /**
   * Execute the gold-standard query and return its result for comparison.
   */
  executeGold(goldQuery: string, context: Record<string, unknown>): SqlExecutionResult {
    return this.executeSql(goldQuery, context);
  }

  /**
   * Compare agent output against gold-standard result.
   * Returns a quality score: 1.0 = exact match, 0.5 = column match only, 0.0 = mismatch.
   */
  compareResults(
    agentResult: SqlExecutionResult,
    goldResult: Record<string, unknown>[]
  ): { quality: number; reason: string } {
    if (agentResult.error) {
      return { quality: 0, reason: `SQL error: ${agentResult.error}` };
    }

    if (agentResult.rows.length === 0 && goldResult.length === 0) {
      return { quality: 1, reason: "both empty — match" };
    }

    if (agentResult.rows.length === 0) {
      return { quality: 0, reason: "agent returned 0 rows, expected " + goldResult.length };
    }

    if (agentResult.rows.length !== goldResult.length) {
      // Partial credit if column count matches.
      const agentCols = Object.keys(agentResult.rows[0]!).length;
      const goldCols = Object.keys(goldResult[0]!).length;
      if (agentCols === goldCols) {
        return { quality: 0.5, reason: `row count mismatch (${agentResult.rows.length} vs ${goldResult.length}), columns match` };
      }
      return { quality: 0, reason: `row count mismatch (${agentResult.rows.length} vs ${goldResult.length})` };
    }

    // Deep comparison of rows (order-sensitive).
    const agentJson = JSON.stringify(normalizeRows(agentResult.rows));
    const goldJson = JSON.stringify(normalizeRows(goldResult));

    if (agentJson === goldJson) {
      return { quality: 1, reason: "exact match" };
    }

    // Partial credit: same row count, check column overlap.
    const agentCols = Object.keys(agentResult.rows[0]!).sort();
    const goldCols = Object.keys(goldResult[0]!).sort();
    if (JSON.stringify(agentCols) === JSON.stringify(goldCols)) {
      return { quality: 0.5, reason: "columns match but row data differs" };
    }

    return { quality: 0, reason: "result mismatch" };
  }
}

/**
 * Normalize rows for comparison:
 * - Sort keys alphabetically (column order independence)
 * - Sort comma-separated string values (GROUP_CONCAT order independence)
 */
function normalizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(row).sort()) {
      const val = row[key];
      if (typeof val === "string" && val.includes(",")) {
        // Sort comma-separated values for GROUP_CONCAT equivalence.
        sorted[key] = val.split(",").map((s) => s.trim()).sort().join(",");
      } else {
        sorted[key] = val;
      }
    }
    return sorted;
  });
}
