// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Aggregates every feature-domain dictionary and applies it to the i18n
 * registry. Called once from main.tsx after initLocale() and before render.
 *
 * Domain JSONs may be flat ("toolRenderers.bash.title") or nested
 * ({ toolRenderers: { bash: { title } } }) — flattenTree normalizes
 * everything to the flat dotted keys t() looks up.
 */
import toolRenderersZh from "./tool-renderers.zh-CN.json"
import toolRenderersEn from "./tool-renderers.en-US.json"
import aiElementsZh from "./ai-elements.zh-CN.json"
import aiElementsEn from "./ai-elements.en-US.json"
import storesZh from "./stores.zh-CN.json"
import storesEn from "./stores.en-US.json"
import promptEditorZh from "./prompt-editor.zh-CN.json"
import promptEditorEn from "./prompt-editor.en-US.json"
import mentionsZh from "./mentions.zh-CN.json"
import mentionsEn from "./mentions.en-US.json"
import quickpickZh from "./quickpick.zh-CN.json"
import quickpickEn from "./quickpick.en-US.json"
import shortcutsZh from "./shortcuts.zh-CN.json"
import shortcutsEn from "./shortcuts.en-US.json"
import settingsDeepZh from "./settings-deep.zh-CN.json"
import settingsDeepEn from "./settings-deep.en-US.json"
import sessionQueryZh from "./session-query.zh-CN.json"
import sessionQueryEn from "./session-query.en-US.json"
import { mergeAndRegister } from "@/lib/i18n-merge"

type Json = Record<string, unknown>

function flattenTree(
  tree: Json,
  prefix = "",
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const dotted = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      flattenTree(value as Json, dotted, out)
    } else {
      out[dotted] = String(value)
    }
  }
  return out
}

const ZH: Record<string, string> = {
  ...flattenTree(toolRenderersZh as Json),
  ...flattenTree(aiElementsZh as Json),
  ...flattenTree(storesZh as Json),
  ...flattenTree(promptEditorZh as Json),
  ...flattenTree(mentionsZh as Json),
  ...flattenTree(quickpickZh as Json),
  ...flattenTree(shortcutsZh as Json),
  ...flattenTree(settingsDeepZh as Json),
  ...flattenTree(sessionQueryZh as Json),
}

const EN: Record<string, string> = {
  ...flattenTree(toolRenderersEn as Json),
  ...flattenTree(aiElementsEn as Json),
  ...flattenTree(storesEn as Json),
  ...flattenTree(promptEditorEn as Json),
  ...flattenTree(mentionsEn as Json),
  ...flattenTree(quickpickEn as Json),
  ...flattenTree(shortcutsEn as Json),
  ...flattenTree(settingsDeepEn as Json),
  ...flattenTree(sessionQueryEn as Json),
}

let applied = false

export function applyDashboardDictionaries(
  zhCore: Record<string, string> | undefined,
  enCore: Record<string, string> | undefined,
): void {
  if (applied) return
  applied = true
  mergeAndRegister("zh-CN", zhCore, ZH, "中文 (简体)")
  mergeAndRegister("en-US", enCore, EN, "English")
}
