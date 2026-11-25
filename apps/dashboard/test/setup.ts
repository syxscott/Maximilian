import "@testing-library/jest-dom/vitest"
import { setLocale } from "@max/i18n"
import { ensureLocaleLoaded } from "../src/locales/index"

// Default test locale is en-US so existing English assertions keep working
// without per-test boilerplate. The i18n package defaults to zh-CN by design
// (project requirement) — tests that want to exercise Chinese can call
// setLocale("zh-CN") inside their own setup.
setLocale("en-US")

// Dashboard domain dictionaries are lazy-loaded in production. Tests render
// synchronously right after importing this file, so preload the two dashboard
// locales here; top-level await blocks the test module graph until the chunks
// are merged.
await Promise.all([ensureLocaleLoaded("zh-CN"), ensureLocaleLoaded("en-US")])
