import { dict as en } from "./en.js"
import { dict as zhCN } from "./zh-CN.js"
import type { UiI18nParams } from "../context/i18n.js"

export type Locale = "en" | "zh-CN"

export const locales: Record<Locale, Record<string, string>> = {
  en,
  "zh-CN": zhCN as Record<string, string>,
}

export function resolveTemplate(text: string, params?: UiI18nParams) {
  if (!params) return text
  return text.replace(/{{\s*([^}]+?)\s*}}/g, (_, rawKey) => {
    const key = String(rawKey)
    const value = params[key]
    return value === undefined ? "" : String(value)
  })
}

export interface CreateI18nOptions {
  locale: Locale
  /** Optional fallback locale. Defaults to `"en"`. */
  fallback?: Locale
}

export function createI18n(options: CreateI18nOptions) {
  const { locale, fallback = "en" } = options

  return {
    locale,
    t(key: string, params?: UiI18nParams): string {
      const dict = locales[locale] ?? en
      const fallbackDict = locales[fallback] ?? en
      const value = (dict[key] ?? fallbackDict[key] ?? String(key)) as string
      return resolveTemplate(value, params)
    },
  }
}

export type { UiI18n } from "../context/i18n.js"
export { dict as en } from "./en.js"
export { dict as zhCN } from "./zh-CN.js"