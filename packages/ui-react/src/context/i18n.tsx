import * as React from "react"
import { dict as en } from "../i18n/en.js"

export type UiI18nKey = keyof typeof en

export type UiI18nParams = Record<string, string | number | boolean>

export interface UiI18n {
  locale: string
  t: (key: UiI18nKey, params?: UiI18nParams) => string
}

function resolveTemplate(text: string, params?: UiI18nParams) {
  if (!params) return text
  return text.replace(/{{\s*([^}]+?)\s*}}/g, (_, rawKey) => {
    const key = String(rawKey)
    const value = params[key]
    return value === undefined ? "" : String(value)
  })
}

const fallback: UiI18n = {
  locale: "en",
  t: (key, params) => {
    const value = en[key] ?? String(key)
    return resolveTemplate(value, params)
  },
}

const I18nContext = React.createContext<UiI18n>(fallback)

export interface I18nProviderProps {
  value: UiI18n
  children?: React.ReactNode
}

export function I18nProvider(props: I18nProviderProps) {
  return <I18nContext.Provider value={props.value}>{props.children}</I18nContext.Provider>
}

export function useI18n(): UiI18n {
  return React.useContext(I18nContext)
}