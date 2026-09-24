// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Feature-domain i18n aggregation — fully automatic.
 *
 * Every file matching `<domain>.<locale>.json` in this directory is
 * flattened to dotted keys and merged over the core dictionaries at
 * boot. Adding strings for a feature = drop/extend a domain JSON pair.
 * No central registration, no merge conflicts between feature owners.
 */
import { mergeAndRegister } from "@/lib/i18n-merge"

const modules = import.meta.glob("./**/*.json", { eager: true }) as Record<
  string,
  Record<string, unknown>
>

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

function collect(locale: string): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const [file, module_] of Object.entries(modules)) {
    // ./tool-renderers.zh-CN.json → locale tag "zh-CN"
    const match = /\.([a-z]{2}-[A-Za-z]{2,4})\.json$/.exec(file)
    if (!match || match[1] !== locale) continue
    // vite eager-glob wraps JSON as the module's default export
    const tree =
      isPlainObject(module_) && isPlainObject(module_.default) ? module_.default : module_
    Object.assign(merged, flattenTree(tree as Json))
  }
  return merged
}

function isPlainObject(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

let applied = false

export function applyDashboardDictionaries(
  zhCore: Record<string, string> | undefined,
  enCore: Record<string, string> | undefined,
): void {
  if (applied) return
  applied = true
  mergeAndRegister("zh-CN", zhCore, collect("zh-CN"), "中文 (简体)")
  mergeAndRegister("en-US", enCore, collect("en-US"), "English")
}
