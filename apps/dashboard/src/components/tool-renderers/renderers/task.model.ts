// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Task tool model layer (subagent spawn). The runtime forwards the model's
 * tool-start `input` verbatim (tool-integration.ts ToolCall.input), so the
 * extractor reads the spawn parameters defensively but keys on the fields
 * the agent loop actually sends: prompt, description, subagent type, model
 * and the background flag. Nothing extractable → empty view model.
 */

import {
  FIELDS,
  asRecord,
  emptyVm,
  oneLine,
  pickArray,
  pickBool,
  pickNum,
  pickStr,
  row,
  vmFrom,
  type RendererRow,
  type ToolViewModel,
} from "./shared.model"

export function extractTask(input: unknown): ToolViewModel {
  const obj = asRecord(input)
  const prompt = pickStr(obj, ["prompt", "instructions", "task", "message"])
  const description = pickStr(obj, ["description", "desc", "summary", "title"])
  const subagent = pickStr(obj, ["subagent_type", "subagentType", "agentType", "agent", "persona"])
  const model = pickStr(obj, ["model", "modelId", "providerModel"])
  const files = pickArray(obj, ["ownedFiles", "owned_files", "files"])
  const background = pickBool(obj, ["run_in_background", "runInBackground", "background"])
  const roundCap = pickNum(obj, ["maxRounds", "max_rounds"])
  if (
    prompt === undefined &&
    description === undefined &&
    subagent === undefined &&
    model === undefined &&
    files === undefined &&
    background === undefined
  ) {
    return emptyVm()
  }
  const rows: Array<RendererRow | undefined> = [
    row(FIELDS.description, description),
    row(FIELDS.subagent, subagent, true),
    row(FIELDS.provider, model, true),
    background === undefined ? undefined : row(FIELDS.mode, background ? "background" : "inline"),
    roundCap === undefined ? undefined : row(FIELDS.limit, roundCap),
    files === undefined
      ? undefined
      : row(FIELDS.file, files.map((f) => String(f)).join(", "), true),
  ]
  return vmFrom(
    rows.filter((r) => r !== undefined),
    oneLine(description ?? prompt ?? ""),
    prompt === undefined ? undefined : { text: prompt, maxLines: 10 },
  )
}
