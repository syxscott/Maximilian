/**
 * Import smoke test for the three panel components: pulls in the full
 * component modules (dialogs + the locale registration side effect) so an
 * import-time breakage — circular import, missing i18n key module — fails
 * here instead of at first keypress. `ink` itself is mocked: its
 * react-reconciler cannot boot under vitest's node environment (duplicate
 * React instance), and these modules only need the JSX runtime + hooks at
 * import time, not a renderer.
 */

import { describe, it, expect, vi } from "vitest"

vi.mock("ink", () => ({
  Box: () => null,
  Text: () => null,
  useInput: () => undefined,
  useStdout: () => ({ write: () => {} }),
}))
vi.mock("ink-spinner", () => ({ default: () => null }))

import { JobsDialog } from "../src/components/jobs-dialog"
import { GoalsPanel } from "../src/components/goals-panel"
import { UsagePanel } from "../src/components/usage-panel"
import { getDictionary } from "@max/i18n"
import "../src/locales/tui-panels"

describe("panel component modules", () => {
  it("import cleanly and export callable components", () => {
    expect(typeof JobsDialog).toBe("function")
    expect(typeof GoalsPanel).toBe("function")
    expect(typeof UsagePanel).toBe("function")
  })

  it("merge the panel strings into the zh-CN and en-US dictionaries", () => {
    for (const locale of ["zh-CN", "en-US"]) {
      const dict = getDictionary(locale) as Record<string, string> | undefined
      expect(dict?.["tui.jobs"]).toBeTruthy()
      expect(dict?.["tui.goals"]).toBeTruthy()
      expect(dict?.["tui.usage"]).toBeTruthy()
    }
    // Locales without a translation fall back to the English subtree.
    const ja = getDictionary("ja-JP") as Record<string, string> | undefined
    expect(ja?.["tui.jobs"]).toBe("Jobs")
  })
})
