// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Feature-domain i18n aggregation — on-demand per locale.
 *
 * Every file matching `<domain>.<locale>.json` in this directory is
 * flattened to dotted keys and merged over the core dictionaries. Adding
 * strings for a feature = drop/extend a domain JSON pair. No central
 * registration, no merge conflicts between feature owners.
 *
 * Loading follows the cc-switch mechanism (borrowing):
 *   - a non-eager `import.meta.glob` keeps only a loader map in the main
 *     bundle instead of inlining every domain×locale JSON (cc-switch
 *     src/i18n/index.ts:5);
 *   - `ensureLocaleLoaded()` fetches one locale's chunks at a time, with an
 *     in-flight map that dedupes concurrent requests and a loaded-locale
 *     cache that makes repeat calls free (cc-switch src/i18n/index.ts:19,41).
 * Only the active locale is fetched at boot; switching pulls the new locale
 * once. The flatten/merge structure itself is unchanged — laziness only moves
 * *when* a domain file is read, never how its keys are registered.
 */
import { getDictionary, getLocale, subscribe, type Locale } from "@max/i18n"
import { mergeAndRegister } from "@/lib/i18n-merge"

type Json = Record<string, unknown>

/** Non-eager glob: file id → lazy loader (borrowing cc-switch LOCALE_LOADERS). */
const modules = import.meta.glob("./**/*.json", {
  eager: false,
}) as Record<string, () => Promise<unknown>>

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

function isPlainObject(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** `./tool-renderers.zh-CN.json` → locale tag "zh-CN". */
function localeOf(file: string): Locale | undefined {
  return /\.([a-z]{2}-[A-Za-z]{2,4})\.json$/.exec(file)?.[1]
}

type LocaleLoader = () => Promise<Json>

/** Loaders grouped by locale tag so one locale switch fetches only its files. */
const loadersByLocale = new Map<Locale, LocaleLoader[]>()
for (const [file, load] of Object.entries(modules)) {
  const locale = localeOf(file)
  if (!locale) continue
  const list = loadersByLocale.get(locale) ?? []
  list.push(async () => {
    const module_ = await load()
    // Vite wraps JSON as the module's default export.
    return isPlainObject(module_) && isPlainObject(module_.default)
      ? module_.default
      : (module_ as Json)
  })
  loadersByLocale.set(locale, list)
}

/**
 * Core dictionaries handed to `applyDashboardDictionaries()`. Kept aside so
 * a locale can be merged even before its package dictionary is registered;
 * normally they are the same objects `getDictionary()` returns.
 */
const pendingCores = new Map<Locale, Record<string, string>>()

/** Locales whose domain chunks have been fetched and merged. */
const loadedLocales = new Set<Locale>()
/** Per-locale fetch promises — concurrent callers share one request. */
const inFlightLoads = new Map<Locale, Promise<void>>()
/** Guards the one-shot locale-change subscription installed at bootstrap. */
let switchSubscriptionInstalled = false

async function fetchLocale(locale: Locale): Promise<void> {
  const loaders = loadersByLocale.get(locale)
  if (!loaders || loaders.length === 0) {
    // No dashboard domains for this locale — nothing to fetch, and the core
    // dictionary stays exactly as registered.
    loadedLocales.add(locale)
    return
  }

  const settled = await Promise.allSettled(loaders.map((load) => load()))
  const failed = settled.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )
  if (failed.length > 0) {
    // Leave the previously registered (core-only) dictionary untouched so a
    // transient chunk failure degrades to raw keys, then allow a retry.
    for (const result of failed) {
      console.warn(`[i18n] failed to load ${locale} domain dictionaries`, result.reason)
    }
    return
  }

  const overrides: Record<string, string> = {}
  for (const result of settled) {
    if (result.status === "fulfilled") {
      Object.assign(overrides, flattenTree(result.value))
    }
  }
  mergeAndRegister(locale, pendingCores.get(locale) ?? getDictionary(locale), overrides)
  loadedLocales.add(locale)
}

/**
 * Fetch and merge the dashboard domain dictionaries for `locale` (borrowing
 * cc-switch `ensureLocaleLoaded`): resolves immediately when already cached,
 * dedupes concurrent calls through `inFlightLoads`, and retries after a
 * failed fetch because only successful locales enter `loadedLocales`.
 */
export function ensureLocaleLoaded(locale: Locale): Promise<void> {
  if (loadedLocales.has(locale)) return Promise.resolve()
  const pending = inFlightLoads.get(locale)
  if (pending) return pending
  const promise = fetchLocale(locale).finally(() => {
    inFlightLoads.delete(locale)
  })
  inFlightLoads.set(locale, promise)
  return promise
}

/**
 * Bootstrap hook called by `main.tsx` before the first render. Records the
 * host-provided core dictionaries and starts loading the active locale's
 * domain chunks; the other locale loads on first switch.
 */
export function applyDashboardDictionaries(
  zhCore: Record<string, string> | undefined,
  enCore: Record<string, string> | undefined,
): void {
  pendingCores.set("zh-CN", zhCore ?? {})
  pendingCores.set("en-US", enCore ?? {})
  void ensureLocaleLoaded(getLocale())
  // Locale switches (header toggle, settings buttons, "follow system") only
  // call setLocale(); nothing else pulls the incoming locale's domain chunks.
  // Without this subscription a switch renders raw feature keys until reload.
  if (!switchSubscriptionInstalled) {
    switchSubscriptionInstalled = true
    subscribe(() => {
      void ensureLocaleLoaded(getLocale())
    })
  }
}
