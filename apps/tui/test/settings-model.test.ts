/**
 * Unit tests for the Settings dialog's pure model layer (settings-model.ts):
 * the section catalog, palette filtering, canonical sorting, availability
 * gating (theme-switching capability + API reachability) and cursor
 * clamping. All inputs are defensive — the tests pin the garbage behavior
 * too, per the dashboard's model/presentation discipline.
 */

import { describe, it, expect } from "vitest"
import {
  clampSettingsCursor,
  filterSettingsSections,
  sectionAvailability,
  SETTINGS_SECTIONS,
  settingsSectionsView,
  sortSettingsSections,
  TUI_THEME_SWITCHING_SUPPORTED,
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
