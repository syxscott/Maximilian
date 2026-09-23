// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Dashboard i18n merge — feature-domain dictionaries.
 *
 * Core dictionaries live in @max/i18n. Feature domains keep their strings
 * in `src/locales/<domain>.<locale>.json` (aggregated by locales/index.ts)
 * and this module merges them over the core dictionaries, re-registering
 * the result BEFORE first render (main.tsx).
 */

import { registerLocale, type Locale } from "@max/i18n"

type Json = Record<string, unknown>

function isPlainObject(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function deepMerge(base: Json, override: Json): Json {
  const out: Json = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key]
    out[key] =
      isPlainObject(value) && isPlainObject(existing) ? deepMerge(existing, value) : value
  }
  return out
}

/** Merge `overrides` over `core` and re-register the locale. */
export function mergeAndRegister(
  locale: Locale,
  core: Json | undefined,
  overrides: Json,
  displayName?: string,
): void {
  registerLocale(
    locale,
    deepMerge(core ?? {}, overrides) as unknown as Record<string, string>,
    displayName,
  )
}
