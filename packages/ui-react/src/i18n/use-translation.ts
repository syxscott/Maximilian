import { useCallback, useMemo } from "react"
import { useI18n } from "../context/i18n.js"
import type { UiI18nParams, UiI18nKey } from "../context/i18n.js"

export interface UseTranslationResult {
  locale: string
  t: (key: UiI18nKey | string, params?: UiI18nParams) => string
}

export function useTranslation(): UseTranslationResult {
  const i18n = useI18n()
  const t = useCallback(
    (key: UiI18nKey | string, params?: UiI18nParams) => i18n.t(key as UiI18nKey, params),
    [i18n],
  )
  return useMemo(() => ({ locale: i18n.locale, t }), [i18n.locale, t])
}