// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the oracle lessons editor: model-layer unit tests (role-name
 * whitelist, defensive corpus normalization, pure upsert, error-kind
 * mapping) plus render smoke for the editor with the API + save hook
 * mocked (settings-deep.test.tsx pattern — the contract under test here
 * is the model layer and the UI's edit/create/failure flows).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import settingsDeepEn from "../src/locales/settings-deep.en-US.json"
import {
  ORACLE_ROLE_MAX_LENGTH,
  emptyCorpusView,
  oracleSaveErrorKind,
  toOracleCorpusView,
  upsertLesson,
  validateOracleRoleName,
  type OracleLessonView,
} from "../src/components/settings/oracle-domain/model"
import { OracleLessonsEditor } from "../src/components/settings/oracle-domain/OracleLessonsEditor"

/** Flatten the nested locale subtree into the dictionary's dotted keys. */
function flatten(
  tree: Record<string, unknown>,
  prefix = "",
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const dotted = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === "object") {
      flatten(value as Record<string, unknown>, dotted, out)
    } else {
      out[dotted] = String(value)
    }
  }
  return out
}

beforeAll(() => {
  const existing = getDictionary("en-US") ?? {}
  registerLocale("en-US", { ...existing, ...flatten(settingsDeepEn as Record<string, unknown>) })
  setLocale("en-US")
})

// ── Model layer ─────────────────────────────────────────────────────────────

describe("oracle-domain model: validateOracleRoleName", () => {
  it("accepts lowercase digit dash names within the length cap", () => {
    expect(validateOracleRoleName("planner")).toBeNull()
    expect(validateOracleRoleName("code-reviewer-2")).toBeNull()
    expect(validateOracleRoleName("a".repeat(ORACLE_ROLE_MAX_LENGTH))).toBeNull()
  })

  it("rejects empty, non-string and whitespace-only names as empty", () => {
    expect(validateOracleRoleName("")).toBe("empty")
    expect(validateOracleRoleName("   ")).toBe("empty")
    expect(validateOracleRoleName(undefined)).toBe("empty")
    expect(validateOracleRoleName(42)).toBe("empty")
  })

  it("rejects traversal, separators, dots, case and unicode as charset", () => {
    expect(validateOracleRoleName("../escape")).toBe("charset")
    expect(validateOracleRoleName("a/b")).toBe("charset")
    expect(validateOracleRoleName(".")).toBe("charset")
    expect(validateOracleRoleName("..")).toBe("charset")
    expect(validateOracleRoleName("Planner")).toBe("charset")
    expect(validateOracleRoleName("under_score")).toBe("charset")
    expect(validateOracleRoleName("中文名")).toBe("charset")
  })

  it("rejects names over the 64-char cap as tooLong", () => {
    expect(validateOracleRoleName("a".repeat(ORACLE_ROLE_MAX_LENGTH + 1))).toBe("tooLong")
  })
})

describe("oracle-domain model: toOracleCorpusView", () => {
  it("normalizes a well-formed payload and sorts by role", () => {
    const view = toOracleCorpusView({
      configured: true,
      dir: "/srv/lessons",
      lessons: [
        { role: "zeta", content: "z", bytes: 1 },
        { role: "alpha", content: "a".repeat(3), bytes: 3 },
      ],
    })
    expect(view.configured).toBe(true)
    expect(view.dir).toBe("/srv/lessons")
    expect(view.lessons.map((l) => l.role)).toEqual(["alpha", "zeta"])
    expect(view.lessons[0]).toEqual({ role: "alpha", content: "aaa", bytes: 3 })
  })

  it("defends against garbage entries and recomputes missing byte counts", () => {
    const view = toOracleCorpusView({
      configured: true,
      dir: 7,
      lessons: [
        null,
        { role: "", content: "x" },
        { role: "ok", content: 42 },
        { role: "ok", content: "hello" }, // no bytes → derived
        { role: "gone", bytes: "nan" }, // no content → dropped
      ],
    })
    expect(view.lessons).toEqual([{ role: "ok", content: "hello", bytes: 5 }])
    expect(view.dir).toBeNull()
  })

  it("falls back to the empty corpus for non-objects", () => {
    expect(toOracleCorpusView(null)).toEqual(emptyCorpusView())
    expect(toOracleCorpusView("x")).toEqual(emptyCorpusView())
    expect(toOracleCorpusView(undefined).lessons).toEqual([])
  })
})

describe("oracle-domain model: upsertLesson + error kinds", () => {
  const base: OracleLessonView[] = [
    { role: "alpha", content: "old", bytes: 3 },
    { role: "zeta", content: "z", bytes: 1 },
  ]

  it("replaces in place, appends new roles and keeps sort order", () => {
    const replaced = upsertLesson(base, "zeta", "longer content!")
    expect(replaced.map((l) => l.role)).toEqual(["alpha", "zeta"])
    expect(replaced[1].bytes).toBe("longer content!".length)

    const appended = upsertLesson(base, "mid", "m")
    expect(appended.map((l) => l.role)).toEqual(["alpha", "mid", "zeta"])
    // Pure: the input array is untouched.
    expect(base).toHaveLength(2)
  })

  it("maps save errors to stable i18n kinds", () => {
    expect(oracleSaveErrorKind(new Error("Invalid role name: X"))).toBe("invalidRole")
    expect(oracleSaveErrorKind(new Error("Oracle lessons directory not configured"))).toBe(
      "notConfigured",
    )
    expect(oracleSaveErrorKind(new Error("Invalid lesson content: too big"))).toBe("invalidContent")
    expect(oracleSaveErrorKind(new Error("oracle lesson save failed (500)"))).toBe("generic")
    expect(oracleSaveErrorKind(undefined)).toBe("generic")
  })
})

// ── Render smoke: editor with API + save mutation mocked ────────────────────

const mocks = vi.hoisted(() => ({
  oracleLessons: vi.fn(),
  mutateAsync: vi.fn(),
}))

vi.mock("@/api", () => ({
  systemApi: {
    oracleLessons: mocks.oracleLessons,
  },
}))

vi.mock("@/hooks/useSettingsQueries", () => ({
  ORACLE_LESSONS_QUERY_KEY: ["settings", "oracle-lessons"],
  useSaveOracleLesson: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}))

const corpusPayload = {
  configured: true,
  dir: "/srv/oracle-lessons",
  lessons: [{ role: "planner", content: "# planner rules", bytes: 15 }],
}

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe("OracleLessonsEditor: render smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mutateAsync.mockResolvedValue({ ok: true, role: "planner", bytes: 5 })
    mocks.oracleLessons.mockResolvedValue(corpusPayload)
  })

  it("shows loading, then the corpus card with an edit button", async () => {
    const { rerender } = renderWithQuery(<OracleLessonsEditor />)
    // Query starts pending → loading line; a rerender after the promise
    // resolves shows the loaded corpus.
    await waitFor(() => expect(screen.getByTestId("settings-oracle")).toBeTruthy())
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <OracleLessonsEditor />
      </QueryClientProvider>,
    )
    expect(screen.getByText("/srv/oracle-lessons")).toBeTruthy()
    expect(screen.getByTestId("oracle-edit-planner")).toBeTruthy()
    expect(screen.getByTestId("oracle-create")).toBeTruthy()
  })

  it("edits a lesson, saves through the mutation and shows the inline confirmation", async () => {
    renderWithQuery(<OracleLessonsEditor />)
    await screen.findByTestId("oracle-edit-planner")

    fireEvent.click(screen.getByTestId("oracle-edit-planner"))
    const textarea = await screen.findByTestId("oracle-editor-planner")
    fireEvent.change(textarea.querySelector("textarea")!, {
      target: { value: "# planner rules v2" },
    })
    fireEvent.click(screen.getByTestId("oracle-save-planner"))

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1))
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      role: "planner",
      content: "# planner rules v2",
    })
    expect(await screen.findByTestId("oracle-saved-planner")).toBeTruthy()
  })

  it("blocks invalid new-role names inline and opens the editor for valid ones", async () => {
    renderWithQuery(<OracleLessonsEditor />)
    await screen.findByTestId("oracle-create")

    const input = screen.getByTestId("oracle-new-role-input")
    fireEvent.change(input, { target: { value: "Bad Role!" } })
    fireEvent.click(screen.getByText("New lesson"))
    expect(screen.getByTestId("oracle-new-role-error")).toBeTruthy()
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
    expect(screen.queryByTestId("oracle-create-textarea")).toBeNull()

    fireEvent.change(input, { target: { value: "judge-2" } })
    fireEvent.click(screen.getByText("New lesson"))
    expect(screen.getByTestId("oracle-create-textarea")).toBeTruthy()
    // Empty content is not saveable until the user types.
    expect((screen.getByTestId("oracle-create-save") as HTMLButtonElement).disabled).toBe(true)
  })

  it("surfaces a save failure inline with the localized line and server reason", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("Oracle lessons directory not configured"))
    renderWithQuery(<OracleLessonsEditor />)
    await screen.findByTestId("oracle-edit-planner")

    fireEvent.click(screen.getByTestId("oracle-edit-planner"))
    fireEvent.click(screen.getByTestId("oracle-save-planner"))

    const line = await screen.findByTestId("oracle-error-planner")
    expect(line.textContent).toContain("Save failed — no lessons directory configured.")
    expect(line.textContent).toContain("Oracle lessons directory not configured")
    expect(screen.queryByTestId("oracle-saved-planner")).toBeNull()
  })
})
