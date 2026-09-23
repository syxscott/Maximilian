// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Aggregates every feature-domain dictionary and applies it to the i18n
 * registry. Called once from main.tsx after initLocale() and before render.
 */
import zhCN from "./zh-CN.json"
import enUS from "./en-US.json"
import { mergeAndRegister } from "@/lib/i18n-merge"

const zh = zhCN as Record<string, string>
const en = enUS as Record<string, string>

let applied = false

export function applyDashboardDictionaries(
  zhCore: Record<string, string> | undefined,
  enCore: Record<string, string> | undefined,
): void {
  if (applied) return
  applied = true
  mergeAndRegister("zh-CN", zhCore, zh, "中文 (简体)")
  mergeAndRegister("en-US", enCore, en, "English")
}
