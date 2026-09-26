/**
 * Unit tests for the Settings dialog's pure model layer (settings-model.ts):
 * the section catalog, palette filtering, canonical sorting, availability
 * gating (theme-switching capability + API reachability) and cursor
 * clamping. All inputs are defensive — the tests pin the garbage behavior
 * too, per the dashboard's model/presentation discipline.
 */

import { describe, it, expect, vi } from "vitest"
import {
  cachedProbe,
  clampSettingsCursor,
  createProbeCache,
  filterSettingsSections,
  sectionAvailability,
  SETTINGS_SECTIONS,
  settingsSectionsView,
  sortSettingsSections,
  TUI_THEME_SWITCHING_SUPPORTED,
  wrapSettingsCursor,
  type SettingsSection,
} from "../src/components/settings-model"

const ids = (sections: readonly SettingsSection[]) => sections.map((s) => s.id)

describe("SETTINGS_SECTIONS catalog", () => {
  it("mirrors the dashboard settings center in canonical order", () => {
    expect(ids(SETTINGS_SECTIONS)).toEqual(["appearance", "jobs", "memory", "usage"])
    for (const section of SETTINGS_SECTIONS) {
      expect(section.titleKey.startsWith("tui.")).toBe(true)
      expect(section.title.length).toBeGreaterThan(0)
      expect(section.hintKey.startsWith("tui.")).toBe(true)
      expect(section.hint.length).toBeGreaterThan(0)
    }
  })

  it("routes each section to the right TUI face and API requirement", () => {
    const byId = new Map(SETTINGS_SECTIONS.map((s) => [s.id, s]))
    expect(byId.get("appearance")?.target).toBe("theme")
    expect(byId.get("appearance")?.requiresApi).toBe(false)
    expect(byId.get("jobs")?.target).toBe("jobs-dialog")
    expect(byId.get("memory")?.target).toBe("memory-panel")
    expect(byId.get("usage")?.target).toBe("usage-panel")
    for (const id of ["jobs", "memory", "usage"] as const) {
      expect(byId.get(id)?.requiresApi).toBe(true)
    }
  })
})

describe("filterSettingsSections", () => {
  it("returns the full catalog for empty, whitespace or garbage queries", () => {
    for (const query of [undefined, null, "", "   ", 42, {}]) {
      expect(ids(filterSettingsSections(query))).toEqual(["appearance", "jobs", "memory", "usage"])
    }
  })

  it("matches id, title and hint case-insensitively", () => {
    expect(ids(filterSettingsSections("jobs"))).toEqual(["jobs"])
    expect(ids(filterSettingsSections("MEMORY"))).toEqual(["memory"])
    // "token & cost windows" lives in the usage hint.
    expect(ids(filterSettingsSections("token"))).toEqual(["usage"])
    // "Theme" appears in the appearance title and hint.
    expect(ids(filterSettingsSections("theme"))).toEqual(["appearance"])
  })

  it("returns an empty list when nothing matches", () => {
    expect(filterSettingsSections("no-such-section")).toEqual([])
  })
})

describe("sortSettingsSections", () => {
  it("restores canonical order from any input order", () => {
    const shuffled = [
      SETTINGS_SECTIONS[3],
      SETTINGS_SECTIONS[0],
      SETTINGS_SECTIONS[2],
      SETTINGS_SECTIONS[1],
    ]
    expect(ids(sortSettingsSections(shuffled))).toEqual(["appearance", "jobs", "memory", "usage"])
  })

  it("drops garbage rows and never mutates the input", () => {
    const input: unknown[] = [null, SETTINGS_SECTIONS[1], 42, "jobs", SETTINGS_SECTIONS[3]]
    const sorted = sortSettingsSections(input)
    expect(ids(sorted)).toEqual(["jobs", "usage"])
    // The input array is untouched (length and slot identity preserved).
    expect(input).toHaveLength(5)
    expect(input[1]).toBe(SETTINGS_SECTIONS[1])
    // Non-array garbage degrades to an empty list, not a throw.
    expect(sortSettingsSections(undefined)).toEqual([])
    expect(sortSettingsSections("jobs")).toEqual([])
  })
})

describe("sectionAvailability", () => {
  const appearance = SETTINGS_SECTIONS[0]
  const jobs = SETTINGS_SECTIONS[1]

  it("keeps Appearance unavailable until the TUI can actually switch themes", () => {
    // The honesty contract: the ported theme context's set() is a no-op
    // stub, so the flag — and the section — must be off until it isn't.
    expect(TUI_THEME_SWITCHING_SUPPORTED).toBe(false)
    for (const themeSwitchable of [false, undefined, null]) {
      const verdict = sectionAvailability(appearance, { themeSwitchable })
      expect(verdict.state).toBe("unavailable")
      if (verdict.state === "unavailable") {
        expect(verdict.reasonKey).toBe("tui.settings.unavailable.dashboardOnly")
      }
    }
    expect(sectionAvailability(appearance, { themeSwitchable: true })).toEqual({
      state: "available",
    })
  })

  it("blocks API-backed sections only on a definitive probe failure", () => {
    for (const section of [jobs, SETTINGS_SECTIONS[2], SETTINGS_SECTIONS[3]]) {
      const verdict = sectionAvailability(section, { apiReachable: false })
      expect(verdict.state).toBe("unavailable")
      if (verdict.state === "unavailable") {
        expect(verdict.reasonKey).toBe("tui.settings.unavailable.apiUnreachable")
      }
    }
  })

  it("degrades an unknown probe state to available (panels own loading/error)", () => {
    for (const apiReachable of [true, undefined, null]) {
      expect(sectionAvailability(jobs, { apiReachable })).toEqual({ state: "available" })
    }
    // Appearance is unaffected by the API probe either way.
    expect(sectionAvailability(appearance, { apiReachable: false }).state).toBe("unavailable")
  })

  it("survives garbage sections and deps without throwing", () => {
    for (const section of [null, undefined, "jobs", 42, { id: 42 }, { noId: true }]) {
      const verdict = sectionAvailability(section, { apiReachable: true })
      expect(verdict.state).toBe("unavailable")
      if (verdict.state === "unavailable") {
        expect(verdict.reasonKey).toBe("tui.settings.unavailable.unknown")
      }
    }
    // Garbage deps behave like "no deps": appearance still dashboard-only,
    // API-backed sections still open.
    expect(sectionAvailability(jobs, "garbage").state).toBe("available")
    expect(sectionAvailability(jobs, null).state).toBe("available")
    expect(sectionAvailability(appearance, "garbage").state).toBe("unavailable")
  })
})

describe("settingsSectionsView", () => {
  it("composes filter, canonical sort and availability into paintable rows", () => {
    const view = settingsSectionsView(undefined, {
      apiReachable: false,
      themeSwitchable: false,
    })
    expect(view.map((row) => row.section.id)).toEqual(["appearance", "jobs", "memory", "usage"])
    expect(view.every((row) => row.availability.state === "unavailable")).toBe(true)
  })

  it("filters to the matched section with its own verdict", () => {
    const view = settingsSectionsView("mem", { apiReachable: true })
    expect(view).toHaveLength(1)
    expect(view[0]?.section.id).toBe("memory")
    expect(view[0]?.availability).toEqual({ state: "available" })
    expect(settingsSectionsView("zzz", {})).toEqual([])
  })
})

describe("clampSettingsCursor", () => {
  it("clamps into [0, length-1]", () => {
    expect(clampSettingsCursor(0, 4)).toBe(0)
    expect(clampSettingsCursor(2, 4)).toBe(2)
    expect(clampSettingsCursor(3, 4)).toBe(3)
    expect(clampSettingsCursor(9, 4)).toBe(3)
    expect(clampSettingsCursor(-2, 4)).toBe(0)
    expect(clampSettingsCursor(1.7, 4)).toBe(1)
  })

  it("degrades garbage operands to 0 (the top of the list)", () => {
    expect(clampSettingsCursor("1", 4)).toBe(0)
    expect(clampSettingsCursor(Number.NaN, 4)).toBe(0)
    expect(clampSettingsCursor(undefined, 4)).toBe(0)
    expect(clampSettingsCursor(0, 0)).toBe(0)
    expect(clampSettingsCursor(0, undefined)).toBe(0)
    expect(clampSettingsCursor(0, -5)).toBe(0)
  })
})

describe("wrapSettingsCursor (j/k navigation with first↔last wrap)", () => {
  it("wraps j on the last section to the first and k on the first to the last", () => {
    expect(wrapSettingsCursor(3, 1, 4)).toBe(0) // j past the bottom → top
    expect(wrapSettingsCursor(0, -1, 4)).toBe(3) // k past the top → bottom
    expect(wrapSettingsCursor(1, 1, 4)).toBe(2)
    expect(wrapSettingsCursor(2, -1, 4)).toBe(1)
  })

  it("clamps a stale cursor BEFORE wrapping and degrades garbage to the top", () => {
    // The section list shrank to 4 rows while the cursor sat at 9.
    expect(wrapSettingsCursor(9, 1, 4)).toBe(0)
    expect(wrapSettingsCursor(-2, -1, 4)).toBe(3)
    for (const cursor of [undefined, null, "1", Number.NaN, {}]) {
      // A garbage cursor reads as the top row...
      expect(wrapSettingsCursor(cursor, 0, 4)).toBe(0)
      // ...and the step still applies from there.
      expect(wrapSettingsCursor(cursor, 1, 4)).toBe(1)
    }
    expect(wrapSettingsCursor(1, "junk", 4)).toBe(1) // garbage delta = no step
    for (const length of [0, -4, undefined, "4", Number.NaN]) {
      expect(wrapSettingsCursor(0, 1, length)).toBe(0)
    }
    // A single-section list is a fixed point in both directions.
    expect(wrapSettingsCursor(0, 1, 1)).toBe(0)
    expect(wrapSettingsCursor(0, -1, 1)).toBe(0)
  })
})

describe("probe cache (cached availability verdicts — j/k never re-probes)", () => {
  it("invokes the probe once and serves every repeat from the cache", async () => {
    const cache = createProbeCache()
    const probe = vi.fn(async () => true)
    expect(await cachedProbe(cache, "api.health", probe)).toBe(true)
    expect(await cachedProbe(cache, "api.health", probe)).toBe(true)
    expect(await cachedProbe(cache, "api.health", probe)).toBe(true)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(cache.size).toBe(1)
  })

  it("caches a DEFINITIVE FAILURE the same way — a down API is probed exactly once", async () => {
    const cache = createProbeCache()
    const probe = vi.fn(async () => {
      throw new Error("ECONNREFUSED")
    })
    expect(await cachedProbe(cache, "api.health", probe)).toBe(false)
    for (let i = 0; i < 5; i += 1) {
      // Repeated navigation around the blocked sections keeps hitting the
      // cached failure — zero extra round-trips while the API stays down.
      expect(await cachedProbe(cache, "api.health", probe)).toBe(false)
    }
    expect(probe).toHaveBeenCalledTimes(1)
    expect(cache.get("api.health")).toBe(false)
  })

  it("normalizes outcomes to strict booleans and ignores garbage keys/values", async () => {
    const cache = createProbeCache()
    // Only `=== true` counts as reachable — anything else is a failure.
    expect(await cachedProbe(cache, "k1", async () => ({ ok: 1 }))).toBe(false)
    expect(await cachedProbe(cache, "k2", async () => true)).toBe(true)
    expect(cache.get("k1")).toBe(false)
    expect(cache.get("k2")).toBe(true)
    cache.set("k1", "junk") // non-boolean outcome ignored
    expect(cache.get("k1")).toBe(false)
    cache.set(42, true) // non-string key ignored
    expect(cache.get(42)).toBeUndefined()
    expect(cache.get("")).toBeUndefined()
    expect(cache.get(undefined)).toBeUndefined()
  })

  it("degrades garbage operands: no cache still probes, no probe yields null", async () => {
    const probe = vi.fn(async () => true)
    // Without a usable cache the probe still answers — it just cannot be
    // memoized, so every call re-probes.
    expect(await cachedProbe(null, "k", probe)).toBe(true)
    expect(await cachedProbe(undefined, "k", probe)).toBe(true)
    expect(await cachedProbe("junk", "k", probe)).toBe(true)
    expect(probe).toHaveBeenCalledTimes(3)
    expect(await cachedProbe(createProbeCache(), "k", null)).toBeNull()
    expect(await cachedProbe(createProbeCache(), "k", "not-a-function")).toBeNull()
  })
})
