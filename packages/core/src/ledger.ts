/**
 * Magentic-One Ledger — append-only structured log of orchestrator steps.
 *
 * Inspired by autogen's `Magentic-One` orchestrator: every decision the
 * runtime makes is appended as a typed `LedgerEntry`. Downstream
 * consumers (the evolution engine, telemetry, dashboard) can replay the
 * ledger without parsing free-form text.
 *
 * Entry shape is a discriminated union on `kind`:
 *   - plan       The orchestrator's chosen plan for a round.
 *   - action     A concrete step issued to an agent.
 *   - observation The result of executing the step.
 *   - fact       A piece of ground-truth learned mid-execution.
 *   - answer     The final answer delivered to the user.
 *
 * Use `appendLedger` to add entries; `renderLedger` to project them to a
 * short text preview (e.g. for prompts or UI tooltips).
 */

export type LedgerEntry =
  | { kind: "plan"; round: number; summary: string; selectedAgent?: string; at: string }
  | { kind: "action"; round: number; agent: string; tool?: string; input?: unknown; at: string }
  | {
      kind: "observation"
      round: number
      agent: string
      ok: boolean
      output?: unknown
      error?: string
      at: string
    }
  | { kind: "fact"; round: number; subject: string; content: string; at: string }
  | { kind: "answer"; round: number; content: string; at: string }

export type Ledger = {
  workspaceId: string
  entries: LedgerEntry[]
}

/**
 * Append an entry to the ledger. Returns a new ledger object — never
 * mutates the input. Entries are appended in arrival order; no
 * deduplication is performed.
 */
export function appendLedger(ledger: Ledger, entry: LedgerEntry): Ledger {
  return { workspaceId: ledger.workspaceId, entries: [...ledger.entries, entry] }
}

/**
 * Append many entries atomically.
 */
export function extendLedger(ledger: Ledger, entries: ReadonlyArray<LedgerEntry>): Ledger {
  if (entries.length === 0) return ledger
  return { workspaceId: ledger.workspaceId, entries: [...ledger.entries, ...entries] }
}

/**
 * Filter entries by kind. Useful when projecting a single type for
 * the UI ("show me all observations") or for evolution consumers that
 * only care about facts/answers.
 */
export function filterLedger<K extends LedgerEntry["kind"]>(
  ledger: Ledger,
  kind: K,
): Array<Extract<LedgerEntry, { kind: K }>> {
  return ledger.entries.filter((e): e is Extract<LedgerEntry, { kind: K }> => e.kind === kind)
}

/**
 * Render the ledger to a compact human-readable string. Used to inject
 * the orchestrator's recent context into an LLM prompt.
 */
export function renderLedger(ledger: Ledger, maxEntries = 20): string {
  const tail = ledger.entries.slice(-maxEntries)
  const lines = tail.map((e) => {
    switch (e.kind) {
      case "plan":
        return `[plan r${e.round}] ${e.summary}${e.selectedAgent ? ` → ${e.selectedAgent}` : ""}`
      case "action":
        return `[action r${e.round}] ${e.agent}${e.tool ? ` :: ${e.tool}` : ""}`
      case "observation":
        return `[obs r${e.round}] ${e.agent} ${e.ok ? "ok" : `failed: ${e.error ?? "?"}`}`
      case "fact":
        return `[fact] ${e.subject}: ${e.content}`
      case "answer":
        return `[answer r${e.round}] ${e.content.slice(0, 200)}`
    }
  })
  return lines.join("\n")
}

/**
 * Build an initial empty ledger for a workspace.
 */
export function freshLedger(workspaceId: string): Ledger {
  return { workspaceId, entries: [] }
}