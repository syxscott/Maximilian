// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Raw-provider-response extraction helpers (borrowing MiniMax-Provider-
 * Verifier verify.py: where results carry the full OpenAI-shaped
 * `response` object, benchmark-core sees `Provider.chat()` responses whose
 * protocol detail — reasoning channel, tool calls — lives in `raw`).
 *
 * These helpers are deliberately defensive: `raw` is `unknown` and every
 * provider shape difference must degrade to "channel absent", never throw.
 */

import type { ObservedToolCall, ToolDefinition, ValidatorMessageSlice } from "./types.js"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** The first choice of an OpenAI-shaped raw response, or undefined. */
function firstChoice(raw: unknown): Record<string, unknown> | undefined {
  if (!isRecord(raw)) return undefined
  const choices = raw["choices"]
  if (!Array.isArray(choices) || choices.length === 0) return undefined
  const first = choices[0]
  return isRecord(first) ? first : undefined
}

/**
 * Extract the OpenAI-shaped message slice from a raw provider response.
 * Handles `choices[0].message.{content,reasoning_content,reasoning,tool_calls}`
 * and the flat `{content,reasoning_content,reasoning,tool_calls}` shape.
 * Returns undefined when no recognizable message exists.
 */
export function extractMessageFromRaw(raw: unknown): ValidatorMessageSlice | undefined {
  const choice = firstChoice(raw)
  const message =
    choice && isRecord(choice["message"]) ? choice["message"] : isRecord(raw) ? raw : undefined
  if (!message) return undefined

  const reasoningRaw = message["reasoning_content"] ?? message["reasoning"]
  const reasoning =
    typeof reasoningRaw === "string" && reasoningRaw.length > 0 ? reasoningRaw : null

  const contentRaw = message["content"]
  const content = typeof contentRaw === "string" ? contentRaw : null

  const toolCallsRaw = message["tool_calls"]
  const toolCalls = Array.isArray(toolCallsRaw)
    ? toolCallsRaw.filter(isRecord).map(parseObservedToolCall)
    : null

  return { content, reasoningContent: reasoning, toolCalls }
}

function parseObservedToolCall(value: Record<string, unknown>): ObservedToolCall {
  const fn = isRecord(value["function"]) ? value["function"] : {}
  const args = fn["arguments"]
  return {
    id: typeof value["id"] === "string" ? value["id"] : undefined,
    type: typeof value["type"] === "string" ? value["type"] : undefined,
    function: {
      name: typeof fn["name"] === "string" ? fn["name"] : "",
      arguments: typeof args === "string" ? args : isRecord(args) ? args : undefined,
    },
  }
}

/**
 * Extract tool definitions from a raw request-ish object
 * (`tools: [{ type: "function", function: { name, parameters } }]`).
 * Returns undefined when the shape does not match — validators then
 * degrade per-case instead of throwing.
 */
export function extractToolsFromRaw(raw: unknown): ToolDefinition[] | undefined {
  if (!isRecord(raw)) return undefined
  const tools = raw["tools"]
  if (!Array.isArray(tools)) return undefined
  const parsed: ToolDefinition[] = []
  for (const t of tools) {
    if (!isRecord(t) || !isRecord(t["function"])) continue
    const fn = t["function"]
    if (typeof fn["name"] !== "string") continue
    parsed.push({
      type: typeof t["type"] === "string" ? t["type"] : undefined,
      function: {
        name: fn["name"],
        description: typeof fn["description"] === "string" ? fn["description"] : undefined,
        parameters: isRecord(fn["parameters"])
          ? (fn["parameters"] as ToolDefinition["function"]["parameters"])
          : undefined,
      },
    })
  }
  return parsed.length > 0 ? parsed : undefined
}
