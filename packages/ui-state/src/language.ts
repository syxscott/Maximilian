import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { createStore, useStore } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

/**
 * Ported from OpenCode packages/app/src/context/language.tsx
 *
 * SolidJS createResource -> React useState + lazy load
 * SolidJS createMemo -> useMemo
 * SolidJS createSimpleContext -> React Context
 *
 * Translation dictionaries are loaded lazily and cached in module scope.
 */

export type Locale =
  | "en"
  | "zh"
  | "zht"
  | "ko"
  | "de"
  | "es"
  | "fr"
  | "da"
  | "ja"
  | "pl"
  | "ru"
  | "uk"
  | "ar"
  | "no"
  | "br"
  | "th"
  | "bs"
  | "tr"

type RawDictionary = Record<string, string>
type Dictionary = RawDictionary

function cookie(locale: Locale) {
  return `oc_locale=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`
}

export const LOCALES: readonly Locale[] = [
  "en",
  "zh",
  "zht",
  "ko",
  "de",
  "es",
  "fr",
  "da",
  "ja",
  "pl",
  "ru",
  "uk",
  "bs",
  "ar",
  "no",
  "br",
  "th",
  "tr",
]

const INTL: Record<Locale, string> = {
  en: "en",
  zh: "zh-Hans",
  zht: "zh-Hant",
  ko: "ko",
  de: "de",
  es: "es",
  fr: "fr",
  da: "da",
  ja: "ja",
  pl: "pl",
  ru: "ru",
  uk: "uk",
  ar: "ar",
  no: "nb-NO",
  br: "pt-BR",
  th: "th",
  bs: "bs",
  tr: "tr",
}

// Base dictionary is bundled with English text. Other locales are lazy-loaded
// through this module's loadDict function. The English base acts as the fallback.
const base: Dictionary = {}
const dicts = new Map<Locale, Dictionary>([["en", base]])

export type DictionaryLoader = () => Promise<Dictionary>

/**
 * Register a dictionary loader for a non-English locale.
 * OpenCode's `loaders` map is ported as a registry so the consumer can wire
 * dynamic imports in (matches the spirit of the original lazy import pattern).
 */
const loaders = new Map<Exclude<Locale, "en">, DictionaryLoader>()

export function registerLocaleLoader(locale: Exclude<Locale, "en">, loader: DictionaryLoader) {
  loaders.set(locale, loader)
  // Warm cache when possible.
  void loader().then((dict) => dicts.set(locale, dict))
}

function loadDict(locale: Locale): Promise<Dictionary> {
  const hit = dicts.get(locale)
  if (hit) return Promise.resolve(hit)
  if (locale === "en") return Promise.resolve(base)
  const loader = loaders.get(locale)
  if (!loader) return Promise.resolve(base)
  return loader().then((next) => {
    dicts.set(locale, next)
    return next
  })
}

export function loadLocaleDict(locale: Locale) {
  return loadDict(locale).then(() => undefined)
}

const localeMatchers: Array<{ locale: Locale; match: (language: string) => boolean }> = [
  { locale: "en", match: (language) => language.startsWith("en") },
  { locale: "zht", match: (language) => language.startsWith("zh") && language.includes("hant") },
  { locale: "zh", match: (language) => language.startsWith("zh") },
  { locale: "ko", match: (language) => language.startsWith("ko") },
  { locale: "de", match: (language) => language.startsWith("de") },
  { locale: "es", match: (language) => language.startsWith("es") },
  { locale: "fr", match: (language) => language.startsWith("fr") },
  { locale: "da", match: (language) => language.startsWith("da") },
  { locale: "ja", match: (language) => language.startsWith("ja") },
  { locale: "pl", match: (language) => language.startsWith("pl") },
  { locale: "ru", match: (language) => language.startsWith("ru") },
  { locale: "uk", match: (language) => language.startsWith("uk") },
  { locale: "ar", match: (language) => language.startsWith("ar") },
  {
    locale: "no",
    match: (language) => language.startsWith("no") || language.startsWith("nb") || language.startsWith("nn"),
  },
  { locale: "br", match: (language) => language.startsWith("pt") },
  { locale: "th", match: (language) => language.startsWith("th") },
  { locale: "bs", match: (language) => language.startsWith("bs") },
  { locale: "tr", match: (language) => language.startsWith("tr") },
]

export function detectLocale(): Locale {
  if (typeof navigator !== "object") return "en"

  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    if (!language) continue
    const normalized = language.toLowerCase()
    const match = localeMatchers.find((entry) => entry.match(normalized))
    if (match) return match.locale
  }

  return "en"
}

export function normalizeLocale(value: string): Locale {
  return LOCALES.includes(value as Locale) ? (value as Locale) : "en"
}

function readStoredLocale(): Locale | undefined {
  if (typeof localStorage !== "object") return
  try {
    const raw = localStorage.getItem("opencode.global.dat:language")
    if (!raw) return
    const next = JSON.parse(raw) as { locale?: string }
    if (typeof next?.locale !== "string") return
    return normalizeLocale(next.locale)
  } catch {
    return
  }
}

const warm = readStoredLocale() ?? detectLocale()
if (warm !== "en") void loadDict(warm)

interface LanguageState {
  ready: boolean
  locale: Locale
  setLocale: (next: Locale) => void
}

export const createLanguageStore = (initialLocale?: Locale) =>
  createStore<LanguageState>()(
    persist(
      (set) => ({
        ready: false,
        locale: initialLocale ?? warm,
        setLocale: (next) => set({ locale: normalizeLocale(next) }),
      }),
      {
        name: "language.v1",
        storage: createJSONStorage(() => (typeof localStorage !== "undefined" ? localStorage : undefinedStorage())),
        onRehydrateStorage: () => (state) => {
          if (state) state.ready = true
        },
      },
    ),
  )

function undefinedStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size
    },
  }
}

export type LanguageStore = ReturnType<typeof createLanguageStore>

interface LanguageContextValue {
  store: LanguageStore
  dict: Dictionary
  loadedLocale: Locale
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children, locale: localeProp }: { children: ReactNode; locale?: Locale }) {
  const initial = localeProp ?? readStoredLocale() ?? detectLocale()
  const [store] = useState(() => createLanguageStore(initial))
  const locale = useStore(store, (s) => s.locale)
  const [dict, setDict] = useState<Dictionary>(() => dicts.get(initial) ?? base)

  useEffect(() => {
    let cancelled = false
    loadDict(locale)
      .then((next) => {
        if (cancelled) return
        setDict(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [locale])

  useEffect(() => {
    if (typeof document !== "object") return
    document.documentElement.lang = locale
    document.cookie = cookie(locale)
  }, [locale])

  const value = useMemo<LanguageContextValue>(
    () => ({ store, dict, loadedLocale: locale }),
    [store, dict, locale],
  )

  return React.createElement(LanguageContext.Provider, { value }, children)
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider")
  return ctx
}

const LABEL_KEY: Record<Locale, string> = {
  en: "language.en",
  zh: "language.zh",
  zht: "language.zht",
  ko: "language.ko",
  de: "language.de",
  es: "language.es",
  fr: "language.fr",
  da: "language.da",
  ja: "language.ja",
  pl: "language.pl",
  ru: "language.ru",
  uk: "language.uk",
  ar: "language.ar",
  no: "language.no",
  br: "language.br",
  th: "language.th",
  bs: "language.bs",
  tr: "language.tr",
}

/**
 * Helper hook that mirrors the SolidJS fluent API (locale, intl, t, label,
 * setLocale, locales).  Components that need translation should consume this.
 */
export function useTranslation() {
  const { store, dict } = useLanguage()
  const locale = useStore(store, (s) => s.locale)
  const intl = INTL[locale]

  function t(key: string, params?: Record<string, string | number | boolean>) {
    const template = dict[key] ?? base[key] ?? key
    if (!params) return template
    return Object.entries(params).reduce(
      (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
      template,
    )
  }

  const label = (value: Locale) => t(LABEL_KEY[value])

  return {
    ready: useStore(store, (s) => s.ready),
    locale,
    intl,
    locales: LOCALES,
    label,
    t,
    setLocale: (next: Locale) => store.getState().setLocale(next),
  }
}