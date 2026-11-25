// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Dashboard locale lazy-loading tests (cc-switch i18n mechanism borrowing):
 *   - `applyDashboardDictionaries()` starts only the active locale;
 *   - concurrent `ensureLocaleLoaded()` calls share one fetch (in-flight map);
 *   - a completed locale is cached and never re-fetched;
 *   - locales without dashboard domain files are a no-op.
 *
 * The suite preloads both locales in `test/setup.ts`, so the first test
 * resets the module graph to observe genuine first-load behavior. Merge
 * calls are recorded (not replaced) so the assertions can inspect exactly
 * which locale was fetched and what dotted keys it produced.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type MergeCall = { locale: string; overrides: Record<string, unknown> }

const mergeCalls = vi.hoisted(() => [] as MergeCall[])

vi.mock("@/lib/i18n-merge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/i18n-merge")>()
  return {
    mergeAndRegister: (
      locale: string,
      core: Record<string, unknown> | undefined,
      overrides: Record<string, unknown>,
      displayName?: string,
    ) => {
      mergeCalls.push({ locale, overrides })
      actual.mergeAndRegister(locale, core, overrides, displayName)
    },
  }
})

/** Fresh module graph + fresh merge counter, with the active locale fixed. */
async function freshLocales(activeLocale: string) {
  vi.resetModules()
  mergeCalls.length = 0
  const [{ applyDashboardDictionaries, ensureLocaleLoaded }, { setLocale, getDictionary }] =
    await Promise.all([import("../src/locales/index"), import("@max/i18n")])
  setLocale(activeLocale)
  return { applyDashboardDictionaries, ensureLocaleLoaded, getDictionary, setLocale }
}

beforeEach(() => {
  mergeCalls.length = 0
})

describe("dashboard locale lazy loading", () => {
  it("bootstraps only the active locale (the other stays unloaded)", async () => {
    const { applyDashboardDictionaries, ensureLocaleLoaded, getDictionary } =
      await freshLocales("en-US")

    applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
    // Joining the in-flight load also waits for the bootstrap's fire-and-forget.
    await ensureLocaleLoaded("en-US")

    expect(mergeCalls.map((call) => call.locale)).toEqual(["en-US"])
    expect(mergeCalls[0]?.overrides["mentions.roles.title"]).toBe("Agent roles")
    // zh-CN domains must not be fetched during an en-US boot.
    expect(getDictionary("zh-CN")?.["mentions.roles.title"]).toBeUndefined()
  })

  it("dedupes concurrent loads of the same locale into one merge", async () => {
    const { ensureLocaleLoaded } = await freshLocales("en-US")

    await Promise.all([
      ensureLocaleLoaded("zh-CN"),
      ensureLocaleLoaded("zh-CN"),
      ensureLocaleLoaded("zh-CN"),
    ])

    expect(mergeCalls.map((call) => call.locale)).toEqual(["zh-CN"])
    expect(mergeCalls[0]?.overrides["mentions.roles.title"]).toBe("智能体角色")
  })

  it("serves repeat calls from cache without re-fetching", async () => {
    const { ensureLocaleLoaded } = await freshLocales("en-US")
    await ensureLocaleLoaded("zh-CN")
    mergeCalls.length = 0

    await Promise.all([ensureLocaleLoaded("zh-CN"), ensureLocaleLoaded("zh-CN")])
    await ensureLocaleLoaded("zh-CN")

    expect(mergeCalls).toEqual([])
  })

  it("pulls the incoming locale's domains when the locale changes", async () => {
    const { applyDashboardDictionaries, ensureLocaleLoaded, getDictionary, setLocale } =
      await freshLocales("en-US")

    applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
    // Join the bootstrap load so only en-US has been fetched so far.
    await ensureLocaleLoaded("en-US")
    expect(mergeCalls.map((call) => call.locale)).toEqual(["en-US"])
    expect(getDictionary("zh-CN")?.["mentions.roles.title"]).toBeUndefined()

    // A real switch only calls setLocale(); the lazy loader must react to it.
    mergeCalls.length = 0
    setLocale("zh-CN")

    await vi.waitFor(() => {
      expect(mergeCalls.map((call) => call.locale)).toEqual(["zh-CN"])
    })
    // The zh-CN domain chunks were fetched and handed to the merger.
    expect(mergeCalls[0]?.overrides["mentions.roles.title"]).toBe("智能体角色")
  })

  it("resolves locales without domain files without touching their dictionary", async () => {
    const { ensureLocaleLoaded, getDictionary } = await freshLocales("en-US")
    const before = getDictionary("ja-JP")

    await ensureLocaleLoaded("ja-JP")

    expect(mergeCalls).toEqual([])
    expect(getDictionary("ja-JP")).toBe(before)
  })
})
