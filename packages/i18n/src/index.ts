/**
 * @max/i18n — lightweight translation for Maximilian UIs.
 *
 * Design choices (vs. react-i18next):
 *   - One tiny core (~120 lines) + React hook adapter. No providers, no
 *     async loaders.
 *   - Data-driven locale registry: add a new language by dropping a JSON
 *     file under `./locales/<bcp47>.json` and calling `registerLocale()`.
 *     No type union, no source change for new languages.
 *   - Missing keys fall back to the key itself and console.warn, so a
 *     typo never breaks the UI — you just see the raw key until you
 *     fix it.
 *
 * Persistence:
 *   - Dashboard: localStorage["maximilian.locale"]
 *   - TUI: read MAXIMILIAN_LOCALE env var, or pass an explicit
 *     loadFrom / saveTo to initLocale() for file-based persistence.
 */
import { useEffect, useReducer } from "react";
import dictEn from "./locales/en-US.json" with { type: "json" };
import dictZh from "./locales/zh-CN.json" with { type: "json" };

/** BCP-47 locale tag. We accept any string so adding a new language only
 *  requires `registerLocale("ja-JP", jaJson)` from a bootstrap module. */
export type Locale = string;

export const DEFAULT_LOCALE = "zh-CN";

const STORAGE_KEY = "maximilian.locale";

type Dict = Record<string, string>;
const dictionaries = new Map<Locale, Dict>([
  ["zh-CN", dictZh as Dict],
  ["en-US", dictEn as Dict],
]);

const displayNames = new Map<Locale, string>([
  ["zh-CN", "中文 (简体)"],
  ["en-US", "English"],
]);

let currentLocale: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();
// Optional persisters installed by initLocale() for non-browser runtimes.
// `save` is called whenever the locale changes (via setLocale) so file-based
// persistence stays in sync without callers having to wire it themselves.
// `remove` is called by resetLocaleToSystem so the TUI's "Follow system"
// button can also clear the on-disk locale file.
let savePersister: ((locale: Locale) => void) | undefined;
let removePersister: (() => void) | undefined;

/** Read the active locale. Pure read; no subscription. */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Register a new locale at runtime. Idempotent — re-registering the same
 * tag overwrites the dictionary (useful for hot-reload during dev).
 * Call from a side-effecting import or before `initLocale()` to make
 * the locale selectable.
 */
export function registerLocale(locale: Locale, dict: Dict, displayName?: string): void {
  dictionaries.set(locale, dict);
  if (displayName) displayNames.set(locale, displayName);
}

/** List every locale currently registered, in registration order. */
export function listLocales(): Locale[] {
  return Array.from(dictionaries.keys());
}

/** Display name for a locale, in its own language. Used in the language picker. */
export function localeDisplayName(locale: Locale): string {
  return displayNames.get(locale) ?? locale;
}

/** Set the active locale and notify subscribers. Persists to localStorage,
 *  and to the optional persisters installed by initLocale() (TUI file). */
export function setLocale(locale: Locale): void {
  if (!dictionaries.has(locale)) {
    console.warn(`[i18n] unknown locale "${locale}", ignoring`);
    return;
  }
  currentLocale = locale;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, locale);
    }
  } catch {
    // localStorage can throw in private mode or sandboxed iframes — safe to ignore.
  }
  if (savePersister) {
    try { savePersister(locale); } catch { /* ignore */ }
  }
  for (const listener of listeners) listener();
}

/** Clear any persisted locale and re-resolve from the environment.
 *  Used by the dashboard "Follow system" reset button. */
export function resetLocaleToSystem(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  if (removePersister) {
    try { removePersister(); } catch { /* ignore */ }
  }
  // Re-run detection. The caller (TUI) may have a more specific source;
  // we re-invoke the same fallback chain here.
  if (typeof navigator !== "undefined" && navigator.language) {
    const next = navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
    if (dictionaries.has(next)) currentLocale = next;
  } else if (typeof process !== "undefined" && process.env?.LANG) {
    const lang = process.env.LANG.toLowerCase();
    const tag = lang.split(".")[0]?.replace(/_/g, "-") ?? "";
    if (dictionaries.has(tag)) {
      currentLocale = tag;
    } else if (lang.startsWith("zh")) {
      currentLocale = "zh-CN";
    } else {
      currentLocale = "en-US";
    }
  } else {
    currentLocale = DEFAULT_LOCALE;
  }
  for (const listener of listeners) listener();
}

/**
 * Initialize the locale from a hierarchy of sources. The first source
 * that yields a registered locale wins. Order:
 *   1. loadFrom() (TUI passes a function that reads MAXIMILIAN_LOCALE or
 *      a config file; the dashboard passes undefined and falls through)
 *   2. localStorage["maximilian.locale"]
 *   3. navigator.language (browser) or process.env.LANG (node)
 *   4. DEFAULT_LOCALE
 *
 * Returns the resolved locale so the caller can log it.
 */
export function initLocale(opts?: {
  loadFrom?: () => string | undefined;
  saveTo?: (locale: Locale) => void;
  removeOnReset?: () => void;
}): Locale {
  const loadFrom = opts?.loadFrom;
  const saveTo = opts?.saveTo;
  const removeOnReset = opts?.removeOnReset;

  // Install file-based persisters so setLocale() and resetLocaleToSystem()
  // keep the on-disk state in sync without callers re-wiring each time.
  savePersister = saveTo;
  removePersister = removeOnReset;

  if (loadFrom) {
    try {
      const v = loadFrom();
      if (v && dictionaries.has(v)) {
        currentLocale = v;
        return currentLocale;
      }
    } catch {
      // ignore
    }
  }
  if (typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && dictionaries.has(stored)) {
        currentLocale = stored;
        return currentLocale;
      }
    } catch {
      // ignore
    }
  }
  // Detect from environment.
  if (typeof navigator !== "undefined" && navigator.language) {
    const detected = navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
    if (dictionaries.has(detected)) currentLocale = detected;
  } else if (typeof process !== "undefined" && process.env?.LANG) {
    const lang = process.env.LANG.toLowerCase();
    const tag = lang.split(".")[0]?.replace(/_/g, "-") ?? "";
    if (dictionaries.has(tag)) {
      currentLocale = tag;
    } else if (lang.startsWith("zh")) {
      currentLocale = "zh-CN";
    } else {
      currentLocale = "en-US";
    }
  } else {
    currentLocale = DEFAULT_LOCALE;
  }
  // Persist the resolved locale for the TUI case where localStorage isn't
  // available, so subsequent boots pick up the user's choice without an env var.
  if (saveTo) {
    try { saveTo(currentLocale); } catch { /* ignore */ }
  }
  return currentLocale;
}

/**
 * Translate a key.
 *
 *   t("nav.workspace")                          // → "工作区"
 *   t("chat.send")                              // → "发送"
 *   t("custom.key", "fallback text")            // → uses fallback if key missing
 *   t("usage.metric.tokensCached", { cached })  // → "{cached} cached" with substitution
 *
 * Substitution is `{name}` placeholder replacement — intentionally minimal,
 * not ICU MessageFormat. For plural / select / ordinal, see `tn()` and
 * `ts()`. Missing keys log a single console.warn per key (not per call)
 * so dev noise stays low when iterating on dictionaries.
 */
const warnedKeys = new Set<string>();
export function t(key: string, paramsOrFallback?: string | Record<string, string | number>, fallback?: string): string {
  const dict = dictionaries.get(currentLocale);
  let raw = dict?.[key];
  let usedFallback: string | undefined;
  if (raw === undefined) {
    if (typeof paramsOrFallback === "string") {
      raw = paramsOrFallback;
      usedFallback = paramsOrFallback;
    } else if (fallback !== undefined) {
      raw = fallback;
      usedFallback = fallback;
    } else {
      if (!warnedKeys.has(key)) {
        // eslint-disable-next-line no-console
        console.warn(`[i18n] missing key "${key}" for locale "${currentLocale}"`);
        warnedKeys.add(key);
      }
      raw = key;
    }
  }
  if (raw && typeof paramsOrFallback === "object" && paramsOrFallback !== null) {
    for (const [name, value] of Object.entries(paramsOrFallback)) {
      raw = raw.replace(new RegExp(`\\{${name}\\}`, "g"), String(value));
    }
  }
  void usedFallback;
  return raw;
}

/**
 * ICU-style plural form. Looks up `key.one` / `key.other` (and `.zero`,
 * `.two`, `.few`, `.many` when present) based on the active locale's
 * plural rules via `Intl.PluralRules`.
 *
 *   tn("usage.taskCount", { count: 1 })   // → "1 task"
 *   tn("usage.taskCount", { count: 5 })   // → "5 tasks"
 *
 * If the key chain is missing, falls back to `t(key, params)` so
 * missing translations degrade gracefully.
 */
export function tn(
  key: string,
  params: Record<string, string | number> & { count: number },
  options?: { offset?: number; ordinal?: boolean },
): string {
  const dict = dictionaries.get(currentLocale);
  const pr = new Intl.PluralRules(currentLocale, {
    type: options?.ordinal ? "ordinal" : "cardinal",
  });
  const cat = pr.select((params.count ?? 0) - (options?.offset ?? 0));
  // Try the plural-rules-selected form first; fall back to "other", then
  // to the un-suffixed key as a last resort.
  for (const form of [cat, "other", cat === "other" ? "one" : "other"]) {
    const composed = `${key}.${form}`;
    if (dict && composed in dict) {
      return t(composed, params);
    }
  }
  // No plural form at all — fall back to plain t().
  return t(key, params);
}

/**
 * ICU-style select form. Looks up `key.<value>` in the dictionary.
 * Used for things like gender, status, etc. where the count isn't
 * the deciding factor.
 *
 *   ts("usage.status", { status: "ok" }, { fallback: "unknown" })
 *
 * Returns the fallback (or the key itself) if the branch is missing.
 */
export function ts(
  key: string,
  params: Record<string, string | number> & { [k: string]: string | number },
  options: { fallback: string },
): string {
  const dict = dictionaries.get(currentLocale);
  for (const [k, v] of Object.entries(params)) {
    const composed = `${key}.${v}`;
    if (dict && composed in dict) {
      return t(composed, params);
    }
    // Hint that we tried this branch — keeps the `k` variable live.
    void k;
  }
  return t(`${key}.${options.fallback}`, params, t(key, params));
}

/** Subscribe to locale changes. Returns an unsubscribe function. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * React hook: re-renders the calling component when the locale changes.
 * Returns the active locale and a stable setter.
 */
export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void; reset: () => void } {
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribe(forceUpdate), []);
  return { locale: currentLocale, setLocale, reset: resetLocaleToSystem };
}

/**
 * Test-only: reset module state. Not part of the public API.
 * @internal
 */
export function __resetI18n(): void {
  currentLocale = DEFAULT_LOCALE;
  listeners.clear();
  warnedKeys.clear();
  dictionaries.clear();
  displayNames.clear();
  dictionaries.set("zh-CN", dictZh as Dict);
  dictionaries.set("en-US", dictEn as Dict);
  displayNames.set("zh-CN", "中文 (简体)");
  displayNames.set("en-US", "English");
  savePersister = undefined;
  removePersister = undefined;
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// Format helpers (numbers, dates, durations, etc.) are exported separately
// from "./format.js" so the runtime can tree-shake them out of TUI bundles
// that only need the string table.
export {
  formatNumber,
  formatPercent,
  formatCompact,
  formatTokens,
  formatBytes,
  formatDate,
  formatDateTime,
  formatRelative,
  formatDuration,
  formatList,
} from "./format.js";
