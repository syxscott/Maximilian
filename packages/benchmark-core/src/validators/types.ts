// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Per-case validator protocol (borrowing MiniMax-Provider-Verifier
 * `validator/base.py:7-41` + `verify.py:33-39,397-415`).
 *
 * A validator is the TS counterpart of the Python `BaseValidator` ABC:
 * three methods — `name` (registry key), `validate` (one request/response
 * pair → fields merged into that case's result) and `computeSummary`
 * (all per-case runs → aggregate statistics). The registry dispatches on
 * the case's `checkType` array; unregistered check types warn and degrade
 * to the registry's default validators (verify.py logs and skips; we
 * degrade so a typo'd check type never silently drops its measurement).
 */

/**
 * JSON-schema subset used by tool parameter schemas in this repository.
 * Deliberately structural: only the keywords our tool definitions declare
 * (`type`, `properties`, `required`, `items`, `enum`, `additionalProperties`).
 */
export interface JsonSchemaObject {
  type?: string
  properties?: Record<string, JsonSchemaObject>
  required?: readonly string[]
  items?: JsonSchemaObject
  enum?: ReadonlyArray<string | number | boolean | null>
  additionalProperties?: boolean
  [key: string]: unknown
}

/** A tool definition in OpenAI function format (verifier request `tools[]`). */
export interface ToolDefinition {
  type?: string
  function: {
    name: string
    description?: string
    parameters?: JsonSchemaObject
  }
}

/** One tool call observed in a response message. */
export interface ObservedToolCall {
  id?: string
  type?: string
  function: {
    name: string
    /** Provider-dependent: a JSON string (OpenAI) or a parsed object. */
    arguments?: string | Record<string, unknown>
  }
}

/**
 * The response-message slice validators may inspect. Provider-shape
 * tolerant: everything except `output` is optional and `null` means
 * "provider did not surface this channel" (None-compatibility per
 * verify.py `_is_error_only_reasoning_response`).
 */
export interface ValidatorMessageSlice {
  content?: string | null
  /** Reasoning channel text (`reasoning_content` / `reasoning`). */
  reasoningContent?: string | null
  toolCalls?: readonly ObservedToolCall[] | null
}

/** One case presented to validators (verify.py `process_request` inputs). */
export interface ValidatorCaseContext {
  taskId: string
  /** Request outcome: "success" = a response came back at all. */
  status: "success" | "failed"
  /** Visible reply text (message.content). */
  output: string
  /** Protocol finish_reason; null/undefined when the provider hid it. */
  finishReason?: string | null
  /** External ground-truth label: this case SHOULD trigger tool calls. */
  expectedToolCall?: boolean
  /** Tool definitions sent with the request. */
  tools?: readonly ToolDefinition[]
  /** Parsed message slice (reasoning / tool calls), when available. */
  message?: ValidatorMessageSlice
}

/** Fields one validator produced for one case (verify.py result.update(...)). */
export type ValidatorFields = Record<string, unknown>

/** A per-case run handed back to `computeSummary`. */
export interface ValidatorCaseRun {
  readonly ctx: ValidatorCaseContext
  readonly fields: ValidatorFields
}

/** The validator protocol (validator/base.py:7-41 borrowing). */
export interface CaseValidator {
  /** Registry key — matches one entry of a case's `checkType` array. */
  readonly name: string
  /** Validate a single request-response pair; return fields to merge. */
  validate(ctx: ValidatorCaseContext): ValidatorFields
  /** Aggregate over all per-case runs of this validator. */
  computeSummary(runs: readonly ValidatorCaseRun[]): ValidatorFields
}
