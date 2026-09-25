// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Core-tool payload builders for the tool-renderer tests — one pure
 * function per packages/tools/src input schema, so every fixture in
 * test/tool-renderers.test.tsx is checked against the REAL field names
 * at compile time (a misspelled `timeouts`/`includes` key fails tsc, not
 * just the assertion):
 *
 *   bash  → packages/tools/src/bash.ts + bash-stream.ts
 *           { command, workdir?, timeout?, description? }
 *   read  → packages/tools/src/read.ts   { path, offset?, limit? }
 *   edit  → packages/tools/src/edit.ts   { path, oldString, newString, replaceAll? }
 *   write → packages/tools/src/write.ts  { path, content }
 *   glob  → packages/tools/src/glob.ts   { pattern, path?, limit? }
 *   grep  → packages/tools/src/grep.ts   { pattern, path?, include?, limit? }
 *
 * Builders emit plain passthrough-JSON records (the shape the runtime
 * forwards verbatim) and strip undefined keys, so an "absent" variant
 * truly lacks the field — matching what a real model emits. Deliberately
 * NOT keyed here: glob has no `include` (that filter is grep.ts's), and
 * historical alias spellings (file_path, replace_all) are exercised with
 * raw literals to pin the defensive tier.
 */

/** packages/tools/src/bash.ts — BashInput. */
export interface BashInputPayload {
  command: string
  workdir?: string
  timeout?: number
  description?: string
}

/** packages/tools/src/read.ts — ReadInput. */
export interface ReadInputPayload {
  path: string
  offset?: number
  limit?: number
}

/** packages/tools/src/edit.ts — EditInput. */
export interface EditInputPayload {
  path: string
  oldString: string
  newString: string
  replaceAll?: boolean
}

/** packages/tools/src/write.ts — WriteInput. */
export interface WriteInputPayload {
  path: string
  content: string
}

/** packages/tools/src/glob.ts — GlobInput. */
export interface GlobInputPayload {
  pattern: string
  path?: string
  limit?: number
}

/** packages/tools/src/grep.ts — GrepInput. */
export interface GrepInputPayload {
  pattern: string
  path?: string
  include?: string
  limit?: number
}

/** Drop undefined entries so an omitted field is really absent. */
function payloadOf(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
}

/** bashPayload — real-shape `bash` tool input (both bash.ts and bash-stream.ts). */
export function bashPayload(input: BashInputPayload): Record<string, unknown> {
  return payloadOf({ ...input })
}

/** readPayload — real-shape `read` tool input. */
export function readPayload(input: ReadInputPayload): Record<string, unknown> {
  return payloadOf({ ...input })
}

/** editPayload — real-shape `edit` tool input. */
export function editPayload(input: EditInputPayload): Record<string, unknown> {
  return payloadOf({ ...input })
}

/** writePayload — real-shape `write` tool input. */
export function writePayload(input: WriteInputPayload): Record<string, unknown> {
  return payloadOf({ ...input })
}

/** globPayload — real-shape `glob` tool input. */
export function globPayload(input: GlobInputPayload): Record<string, unknown> {
  return payloadOf({ ...input })
}

/** grepPayload — real-shape `grep` tool input. */
export function grepPayload(input: GrepInputPayload): Record<string, unknown> {
  return payloadOf({ ...input })
}
