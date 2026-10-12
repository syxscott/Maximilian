// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Orphan tool-pair sanitizer for history replay (agency-swarm borrowing:
 * `messages/message_filter.py`, commits 1aeb325b + 1bc789a7).
 *
 * Strict provider replay APIs reject a history in which one half of a
 * paired message lost its partner — a tool call without its output, an
 * approval response without its request, a reasoning item whose original
 * adjacent follower was dropped. Rewinding a turn (or trimming a timeline)
 * cuts history at an arbitrary row boundary and happily produces exactly
 * such orphans, so the replay exit must strip them.
 *
 * Three pairing patterns, expressed as an EXTENSIBLE TYPE TABLE: a new
 * message type is supported by adding it to the table — no new code.
 *
 *   1. `call-id`         — call and output types share a link id field
 *                          (`call_id`); only ids present on BOTH sides
 *                          survive (set intersection).
 *   2. `request-response`— a response type references its request's own
 *                          id field (`approval_request_id` -> `id`);
 *                          same intersection discipline.
 *   3. `adjacent-follower`— anchor items (e.g. `reasoning`) must keep the
 *                          item that ORIGINALLY immediately followed
 *                          them; a dropped follower cascades backwards,
 *                          a dropped anchor takes its follower with it.
 *
 * Pure functions only: no I/O, no store access, no mutation of inputs.
 */

/** A loosely-typed provider history item (Responses-style input item). */
export type HistoryItem = { type?: string } & Record<string, unknown>

/**
 * Rule 1: call and output item types linked by a shared id field.
 * Both sides typically use `call_id`; set `linkField` for variants.
 */
export interface CallIdPairingRule {
  kind: "call-id"
  /** Item types representing calls (the "request" half of the pair). */
  callTypes: readonly string[]
  /** Item types representing outputs (the "response" half of the pair). */
  outputTypes: readonly string[]
  /** Field carrying the shared link id. Default `call_id`. */
  linkField?: string
}

/**
 * Rule 2: a response item references its request's own id through a
 * dedicated field (`mcp_approval_request.id` <-> `mcp_approval_response
 * .approval_request_id`). Kept ids are the intersection of the two sets.
 */
export interface RequestResponsePairingRule {
  kind: "request-response"
  requestTypes: readonly string[]
  responseTypes: readonly string[]
  /** Field on the REQUEST item holding its match id. Default `id`. */
  requestIdField?: string
  /** Field on the RESPONSE item referencing the request id. Default `approval_request_id`. */
  responseLinkField?: string
}

/**
 * Rule 3: anchor items (e.g. `reasoning`) must be followed by the item
 * that was originally adjacent to them. Dropping an anchor drops its
 * follower; dropping a follower cascades back through chained anchors.
 */
export interface AdjacentFollowerRule {
  kind: "adjacent-follower"
  /** Item types that REQUIRE their original following item to survive. */
  anchorTypes: readonly string[]
}

/** One entry of the pairing table: a rule plus its type coverage. */
export type PairingRule = CallIdPairingRule | RequestResponsePairingRule | AdjacentFollowerRule

/** The extensible type table. Add a type to a rule — nothing else changes. */
export interface PairingTable {
  /**
   * Rules evaluated in order; an item is governed by the FIRST rule whose
   * type sets mention it (deterministic when tables overlap by mistake).
   */
  rules: readonly PairingRule[]
  /** Item types always stripped before pairing (never valid in a replay). */
  filteredTypes?: readonly string[]
}

/** Default table: the OpenAI/Agents-SDK item inventory of agency-swarm. */
export const DEFAULT_PAIRING_TABLE: PairingTable = {
  filteredTypes: ["mcp_list_tools", "openai_list_tools"],
  rules: [
    {
      kind: "call-id",
      callTypes: [
        "function_call",
        "computer_call",
        "apply_patch_call",
        "custom_tool_call",
        "shell_call",
        "local_shell_call",
        "tool_search_call",
        "program",
        "tool_call_item",
        "handoff_call_item",
        "tool_search_call_item",
      ],
      outputTypes: [
        "function_call_output",
        "computer_call_output",
        "apply_patch_call_output",
        "custom_tool_call_output",
        "shell_call_output",
        "local_shell_call_output",
        "tool_search_output",
        "program_output",
        "tool_call_output_item",
        "handoff_output_item",
        "tool_search_output_item",
      ],
      linkField: "call_id",
    },
    {
      kind: "request-response",
      requestTypes: ["mcp_approval_request", "mcp_approval_request_item"],
      responseTypes: ["mcp_approval_response", "mcp_approval_response_item"],
      requestIdField: "id",
      responseLinkField: "approval_request_id",
    },
    {
      kind: "adjacent-follower",
      anchorTypes: ["reasoning"],
    },
  ],
}

/** What the sanitizer removed, per stage (for logs and tests). */
export interface SanitizeReport {
  /** Items dropped for being of a filtered (never-replayable) type. */
  filtered: number
  /** Items dropped as orphaned halves of a link-id pairing rule. */
  orphanedPairs: number
  /** Items dropped by the adjacent-follower rule (anchors + their followers). */
  orphanedFollowers: number
}

export interface SanitizeResult {
  /** Surviving items, in their original relative order. */
  items: HistoryItem[]
  report: SanitizeReport
}

function fieldType(item: HistoryItem): string | null {
  const t = item.type
  return typeof t === "string" ? t : null
}

/** Read a string link field; empty/absent/non-string counts as missing. */
function linkId(item: HistoryItem, field: string): string | null {
  const v = item[field]
  return typeof v === "string" && v.length > 0 ? v : null
}

/**
 * Compute, for one link-id pairing rule, the set of indices (into
 * `items`, which holds ONLY this rule's own items) that survive: ids
 * matched on both sides (set intersection), mirroring the reference — a
 * paired-type item with a missing or unmatched link id is an orphan and
 * is dropped.
 */
function keepSetForLinkRule(
  items: readonly HistoryItem[],
  callTypes: ReadonlySet<string>,
  outputTypes: ReadonlySet<string>,
  callField: string,
  outputField: string,
): { keep: Set<number>; orphaned: number } {
  const callIds = new Set<string>()
  const outputIds = new Set<string>()
  for (const item of items) {
    const type = fieldType(item)
    if (type === null) continue
    if (callTypes.has(type)) {
      const id = linkId(item, callField)
      if (id !== null) callIds.add(id)
    } else if (outputTypes.has(type)) {
      const id = linkId(item, outputField)
      if (id !== null) outputIds.add(id)
    }
  }
  const matched = new Set<string>()
  for (const id of callIds) if (outputIds.has(id)) matched.add(id)

  const keep = new Set<number>()
  let orphaned = 0
  items.forEach((item, idx) => {
    const type = fieldType(item)
    if (type === null) return
    const isCall = callTypes.has(type)
    const isOutput = outputTypes.has(type)
    if (!isCall && !isOutput) return
    const id = linkId(item, isCall ? callField : outputField)
    if (id !== null && matched.has(id)) {
      keep.add(idx)
    } else {
      orphaned += 1
    }
  })
  return { keep, orphaned }
}

/**
 * Strip orphaned paired fragments per the table. Never throws on odd
 * items (missing `type`, missing ids) — odd items that belong to no rule
 * pass through untouched, the conservative choice for a replay sanitizer.
 */
export function sanitizeHistoryItems(
  items: readonly HistoryItem[],
  table: PairingTable = DEFAULT_PAIRING_TABLE,
): SanitizeResult {
  const report: SanitizeReport = { filtered: 0, orphanedPairs: 0, orphanedFollowers: 0 }
  const filtered = new Set(table.filteredTypes ?? [])

  // Pass 0: drop filtered types, remembering original indices.
  const staged: Array<{ idx: number; item: HistoryItem }> = []
  for (const [idx, item] of items.entries()) {
    const type = fieldType(item)
    if (type !== null && filtered.has(type)) {
      report.filtered += 1
      continue
    }
    staged.push({ idx, item })
  }

  // Pass 1: assign every staged item to its FIRST governing rule (by type
  // membership) so overlapping tables never double-decide an item.
  const ownedByRule: Array<Array<{ idx: number; item: HistoryItem }>> = table.rules.map(() => [])
  for (const entry of staged) {
    const type = fieldType(entry.item)
    if (type === null) continue
    const ruleIdx = table.rules.findIndex((rule) => {
      switch (rule.kind) {
        case "call-id":
          return rule.callTypes.includes(type) || rule.outputTypes.includes(type)
        case "request-response":
          return rule.requestTypes.includes(type) || rule.responseTypes.includes(type)
        case "adjacent-follower":
          return rule.anchorTypes.includes(type)
      }
    })
    if (ruleIdx >= 0) ownedByRule[ruleIdx]!.push(entry)
  }

  // Pass 2: pairing rules decide their own items' survival.
  const governedKeep = new Map<number, boolean>() // original idx -> kept?
  table.rules.forEach((rule, ruleIdx) => {
    const owned = ownedByRule[ruleIdx]!
    if (rule.kind === "adjacent-follower") return // decided later (needs final kept set)
    const ownedItems = owned.map((e) => e.item)
    const callTypes = new Set(rule.kind === "call-id" ? rule.callTypes : rule.requestTypes)
    const outputTypes = new Set(rule.kind === "call-id" ? rule.outputTypes : rule.responseTypes)
    const callField =
      rule.kind === "call-id" ? (rule.linkField ?? "call_id") : (rule.requestIdField ?? "id")
    const outputField =
      rule.kind === "call-id"
        ? (rule.linkField ?? "call_id")
        : (rule.responseLinkField ?? "approval_request_id")
    const { keep, orphaned } = keepSetForLinkRule(
      ownedItems,
      callTypes,
      outputTypes,
      callField,
      outputField,
    )
    report.orphanedPairs += orphaned
    for (const [ownedIdx, entry] of owned.entries()) {
      governedKeep.set(entry.idx, keep.has(ownedIdx))
    }
  })

  // Pass 3: base survival — pairing-governed items per their keep-set,
  // everything else staged from pass 0 survives.
  const kept = new Set<number>()
  for (const { idx } of staged) {
    const governed = governedKeep.get(idx)
    if (governed === undefined || governed) kept.add(idx)
  }

  // Pass 4: adjacent-follower rules, processed RIGHT-TO-LEFT so a removal
  // cascades through chained anchors (dropping a reasoning's follower must
  // drop the reasoning, and then the reasoning before it, and so on).
  const anchors = new Set<string>()
  for (const rule of table.rules) {
    if (rule.kind === "adjacent-follower") for (const t of rule.anchorTypes) anchors.add(t)
  }
  const removedAnchors = new Set<number>()
  if (anchors.size > 0) {
    // Right-to-left: `removedAnchors.has(required)` makes the removal
    // cascade through chained anchors (dropping a reasoning's follower
    // drops the reasoning, and then the reasoning before it, …). An anchor
    // with no original next item fails the `kept.has(required)` check.
    const stagedDesc = [...staged].sort((a, b) => b.idx - a.idx)
    for (const { idx, item } of stagedDesc) {
      const type = fieldType(item)
      if (type === null || !anchors.has(type)) continue
      if (!kept.has(idx + 1) || removedAnchors.has(idx + 1)) {
        removedAnchors.add(idx)
        report.orphanedFollowers += 1
      }
    }
    for (const idx of removedAnchors) kept.delete(idx)
  }

  // Pass 5: assemble survivors, dropping items whose required preceding
  // anchor was removed.
  const out: HistoryItem[] = []
  for (const { idx, item } of staged) {
    if (!kept.has(idx)) continue
    if (idx > 0 && removedAnchors.has(idx - 1)) {
      report.orphanedFollowers += 1
      continue
    }
    out.push(item)
  }
  return { items: out, report }
}

/**
 * The replay-exit contract: history rows whose `content` carries a JSON
 * array of typed provider items are sanitized item-wise; rows that fail to
 * parse (plain text content) pass through untouched — a sanitizer must
 * never make a replay WORSE than the stored truth.
 */
export function sanitizeReplayContent(
  content: string,
  table: PairingTable = DEFAULT_PAIRING_TABLE,
): { content: string; droppedAll: boolean; report: SanitizeReport | null } {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return { content, droppedAll: false, report: null }
  }
  if (!Array.isArray(parsed)) return { content, droppedAll: false, report: null }
  const result = sanitizeHistoryItems(parsed as HistoryItem[], table)
  if (result.items.length === 0) {
    return { content, droppedAll: true, report: result.report }
  }
  return { content: JSON.stringify(result.items), droppedAll: false, report: result.report }
}
