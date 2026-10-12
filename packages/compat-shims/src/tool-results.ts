// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Orphan tool-result sanitizer (cc-switch borrowings `2b0ec81b` + `9055dd37`).
 *
 * Conversation history can carry tool results with no matching tool call —
 * most famously the create_thread receipt a desktop client injects into a
 * fresh thread (a `function_call_output` whose `call_id` is null). Sent
 * verbatim, those items get the whole request rejected:
 *
 *   - strict Responses upstreams 422 with `missing field call_id`;
 *   - strict Chat upstreams 400 with `role 'tool' must follow a message
 *     with 'tool_calls'`.
 *
 * Both conversion paths below therefore demote unmatched tool outputs to
 * MARKED USER MESSAGES instead of dropping them (the receipt carries the
 * delegated task text) and share a single marker constant so the model
 * reads one wording whichever path an orphan takes:
 *
 *   - `sanitizeResponsesInput` walks OpenAI Responses `input` items, keeps
 *     outputs whose `call_id` pairs with a call seen in the same array,
 *     and rewrites the rest.
 *   - `sanitizeChatMessages` walks OpenAI Chat messages, registers every
 *     assistant `tool_calls[].id`, and demotes `role:"tool"` messages
 *     whose `tool_call_id` is missing, blank, or never seen.
 *
 * Orphans are staged until the current run of tool results ends (the next
 * non-tool-result entry, or the end of input) so a demoted user message
 * never splits a parallel tool-result run into `tool, user, tool` — strict
 * upstreams reject that sequence too. Rewriting preserves text and image
 * parts; paired results convert exactly as before.
 *
 * All functions are pure: inputs are never mutated.
 */

/**
 * Same marker both paths use, so the model reads one wording regardless of
 * which conversion demoted the result (cc-switch keeps one constant for the
 * Responses sanitize layer and the Responses→Chat bridge).
 */
export const ORPHAN_TOOL_OUTPUT_MARKER = "[tool_result without a matching tool_call]"

/** Responses input item types that carry a tool RESULT (not a call). */
const RESPONSES_TOOL_RESULT_TYPES: ReadonlySet<string> = new Set([
  "function_call_output",
  "custom_tool_call_output",
  "tool_search_output",
])

/**
 * Content part types a Responses user `message` accepts verbatim from a
 * tool output. Anything else is serialized to text so the item stays
 * schema-valid.
 */
const RESPONSES_PASSTHROUGH_PART_TYPES: ReadonlySet<string> = new Set([
  "input_text",
  "input_image",
  "input_file",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Normalized call id of a tool result: trimmed, `""` when absent or blank. */
function callIdOf(item: Record<string, unknown>): string {
  const raw = item.call_id
  return typeof raw === "string" ? raw.trim() : ""
}

/** Result of a sanitize pass: the rewritten sequence plus whether anything changed. */
export interface SanitizeResult {
  /** Rewritten sequence (a new array; the input is untouched). */
  readonly items: unknown[]
  /** True when at least one orphan tool result was demoted. */
  readonly changed: boolean
}

/**
 * Sanitize an OpenAI Responses `input` item array (cc-switch `2b0ec81b`).
 *
 * `function_call_output` / `custom_tool_call_output` / `tool_search_output`
 * items with a missing or blank `call_id` are rewritten into user `message`
 * items carrying `ORPHAN_TOOL_OUTPUT_MARKER` plus their original text and
 * image parts. Items WITH a call id are left alone even when their call is
 * not in the array: a `previous_response_id` continuation legitimately
 * pairs them with a call stored server-side.
 */
export function sanitizeResponsesInput(items: readonly unknown[]): SanitizeResult {
  const out: unknown[] = []
  let changed = false
  let staged: Record<string, unknown>[] = []

  const flushStaged = () => {
    for (const orphan of staged) {
      out.push(responsesUserMessageFromOrphan(orphan))
      changed = true
    }
    staged = []
  }

  for (const item of items) {
    if (!isRecord(item) || typeof item.type !== "string") {
      flushStaged()
      out.push(item)
      continue
    }
    if (!RESPONSES_TOOL_RESULT_TYPES.has(item.type)) {
      // Any non-tool-result item is a turn boundary: emit staged orphans
      // first so the result run they belonged to stays contiguous.
      flushStaged()
      out.push(item)
      continue
    }
    if (callIdOf(item) !== "") {
      out.push(item)
      continue
    }
    staged.push(item)
  }
  flushStaged()
  return { items: out, changed }
}

/**
 * Sanitize an OpenAI Chat message array (cc-switch `9055dd37`).
 *
 * Registers every assistant `tool_calls[].id`, then demotes `role:"tool"`
 * messages whose `tool_call_id` is missing, blank, or was never announced
 * by a preceding assistant message into marked user messages. Paired tool
 * messages pass through untouched, and orphans are staged to the end of
 * their tool-message run so strict upstreams never see `tool, user, tool`.
 */
export function sanitizeChatMessages(messages: readonly unknown[]): SanitizeResult {
  const knownToolCallIds = new Set<string>()
  const out: unknown[] = []
  let changed = false
  let staged: Record<string, unknown>[] = []

  const flushStaged = () => {
    for (const orphan of staged) {
      out.push(chatUserMessageFromOrphan(orphan))
      changed = true
    }
    staged = []
  }

  for (const message of messages) {
    if (!isRecord(message) || typeof message.role !== "string") {
      flushStaged()
      out.push(message)
      continue
    }
    if (message.role === "assistant") {
      flushStaged()
      for (const id of chatToolCallIds(message)) knownToolCallIds.add(id)
      out.push(message)
      continue
    }
    if (message.role === "tool") {
      const callId = typeof message.tool_call_id === "string" ? message.tool_call_id.trim() : ""
      if (callId !== "" && knownToolCallIds.has(callId)) {
        out.push(message)
        continue
      }
      staged.push(message)
      continue
    }
    flushStaged()
    out.push(message)
  }
  flushStaged()
  return { items: out, changed }
}

/** Every non-blank `tool_calls[].id` announced by an assistant message. */
function chatToolCallIds(message: Record<string, unknown>): string[] {
  if (!Array.isArray(message.tool_calls)) return []
  const ids: string[] = []
  for (const call of message.tool_calls) {
    if (!isRecord(call)) continue
    const id = typeof call.id === "string" ? call.id.trim() : ""
    if (id !== "") ids.push(id)
  }
  return ids
}

// ── Content builders (marker shared by both paths) ──────────────────────────

function responsesUserMessageFromOrphan(orphan: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "message",
    role: "user",
    content: responsesOrphanContent(orphan.output),
  }
}

function responsesOrphanContent(output: unknown): unknown[] {
  const markerPart = { type: "input_text", text: ORPHAN_TOOL_OUTPUT_MARKER }
  if (typeof output === "string") {
    return [
      {
        type: "input_text",
        text: output === "" ? ORPHAN_TOOL_OUTPUT_MARKER : `${ORPHAN_TOOL_OUTPUT_MARKER}\n${output}`,
      },
    ]
  }
  if (Array.isArray(output)) {
    return [
      markerPart,
      ...output.map((part) =>
        isRecord(part) &&
        typeof part.type === "string" &&
        RESPONSES_PASSTHROUGH_PART_TYPES.has(part.type)
          ? part
          : { type: "input_text", text: JSON.stringify(part) },
      ),
    ]
  }
  if (output === undefined || output === null) return [markerPart]
  return [{ type: "input_text", text: `${ORPHAN_TOOL_OUTPUT_MARKER}\n${JSON.stringify(output)}` }]
}

function chatUserMessageFromOrphan(message: Record<string, unknown>): Record<string, unknown> {
  const callId = typeof message.tool_call_id === "string" ? message.tool_call_id.trim() : ""
  const marker =
    callId === "" ? ORPHAN_TOOL_OUTPUT_MARKER : `${ORPHAN_TOOL_OUTPUT_MARKER} (call_id: ${callId})`
  return { role: "user", content: chatOrphanContent(marker, message.content) }
}

function chatOrphanContent(marker: string, content: unknown): unknown {
  if (typeof content === "string") {
    return content === "" ? marker : `${marker}\n${content}`
  }
  if (Array.isArray(content)) {
    // Media (image_url parts) and text parts survive verbatim; anything
    // else is serialized so the demoted message stays schema-valid.
    const parts = content.map((part) =>
      isRecord(part) &&
      typeof part.type === "string" &&
      (part.type === "text" || part.type === "image_url")
        ? part
        : { type: "text", text: JSON.stringify(part) },
    )
    return [{ type: "text", text: marker }, ...parts]
  }
  if (content === undefined || content === null) return marker
  return `${marker}\n${JSON.stringify(content)}`
}
