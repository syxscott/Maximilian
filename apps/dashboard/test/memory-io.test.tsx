// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the memory domain's import/export round trip: the pure export
 * envelope builder, the strict client-side import parser (buckets shape,
 * per-entry content/mime fields, empty-import rejection) and the render
 * flow — Blob download with clipboard fallback, the confirm dialog with
 * the per-bucket count summary, and the POST mutation handoff (the route
 * itself is covered by apps/api/test/admin-memory-import.test.ts).
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import memoryEn from "../src/locales/memory.en-US.json"
import {
  MEMORY_EXPORT_KIND,
  MEMORY_EXPORT_VERSION,
  buildMemoryExportEnvelope,
  exportBucketCounts,
  exportFileName,
  parseMemoryImportFile,
  toExportEntry,
} from "../src/components/settings/memory-domain/model"
import { MemoryDomain } from "../src/components/settings/memory-domain/MemoryDomain"

beforeAll(() => {
  const existing = getDictionary("en-US") ?? {}
  registerLocale("en-US", { ...existing, ...flatten(memoryEn as Record<string, unknown>) })
  setLocale("en-US")
})

/** Domain JSON is nested; t() looks up flat dotted keys — flatten first. */
function flatten(tree: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree)) {
    const dotted = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === "object") {
      Object.assign(out, flatten(value as Record<string, unknown>, dotted))
    } else {
      out[dotted] = String(value)
    }
  }
  return out
}

// ── Model: export envelope ──────────────────────────────────────────────────

describe("memory export model", () => {
  const rawRow = {
    role: "planner",
    currentVersion: "v3",
    memory: {
      userFeedback: [
        { content: "prefer tables", mime: "text/plain", metadata: { at: "2026-09-20T10:00:00Z" } },
        "legacy string entry",
        { noContent: true },
        { content: "", mime: "text/plain" },
      ],
      reviewSuggestions: [],
      commonErrors: [{ content: "forgot cleanup" }],
      goodExamples: [],
      efficacy: { commonErrors: { injectedCount: 2, deltaSum: -1 } },
      archived: { userFeedback: [{ content: "old", mime: "text/plain" }] },
      totalEntries: 99,
    },
  }

  it("normalizes entries (legacy strings, invalid drops) into export shape", () => {
    expect(toExportEntry("legacy")).toEqual({ content: "legacy", mime: "text/plain" })
    expect(toExportEntry({ content: "x" })).toEqual({ content: "x", mime: "text/plain" })
    expect(toExportEntry({ content: "x", mime: "application/json", metadata: { a: 1 } })).toEqual({
      content: "x",
      mime: "application/json",
      metadata: { a: 1 },
    })
    // Honest drops: empty content, missing content, primitives.
    expect(toExportEntry({ content: "", mime: "text/plain" })).toBeNull()
    expect(toExportEntry({ noContent: true })).toBeNull()
    expect(toExportEntry(7)).toBeNull()
  })

  it("builds the envelope from the raw profile row, keeping efficacy and archive", () => {
    const envelope = buildMemoryExportEnvelope("planner", rawRow, "2026-09-24T08:00:00.000Z")
    expect(envelope).not.toBeNull()
    if (envelope === null) throw new Error("envelope must build")
    expect(envelope.kind).toBe(MEMORY_EXPORT_KIND)
    expect(envelope.version).toBe(MEMORY_EXPORT_VERSION)
    expect(envelope.role).toBe("planner")
    expect(envelope.exportedAt).toBe("2026-09-24T08:00:00.000Z")
    expect(envelope.buckets.userFeedback).toEqual([
      {
        content: "prefer tables",
        mime: "text/plain",
        metadata: { at: "2026-09-20T10:00:00Z" },
      },
      { content: "legacy string entry", mime: "text/plain" },
    ])
    expect(envelope.buckets.commonErrors).toEqual([
      { content: "forgot cleanup", mime: "text/plain" },
    ])
    expect(envelope.buckets.goodExamples).toEqual([])
    expect(envelope.efficacy).toEqual({ commonErrors: { injectedCount: 2, deltaSum: -1 } })
    expect(envelope.archived).toEqual({
      userFeedback: [{ content: "old", mime: "text/plain" }],
    })
    expect(envelope).not.toHaveProperty("totalEntries")
  })

  it("returns null for a missing role and tolerates a row without memory", () => {
    expect(buildMemoryExportEnvelope("", rawRow, "x")).toBeNull()
    const empty = buildMemoryExportEnvelope("planner", { role: "planner" }, "2026-09-24")
    expect(empty?.buckets.userFeedback).toEqual([])
    expect(empty?.efficacy).toBeUndefined()
    expect(empty?.archived).toBeUndefined()
  })

  it("counts entries per bucket and builds a safe filename", () => {
    const envelope = buildMemoryExportEnvelope("planner", rawRow, "2026-09-24T08:00:00.000Z")
    if (envelope === null) throw new Error("envelope must build")
    expect(exportBucketCounts(envelope)).toEqual({
      userFeedback: 2,
      reviewSuggestions: 0,
      commonErrors: 1,
      goodExamples: 0,
    })
    expect(exportFileName("code reviewer/2", "2026-09-24T08:00:00.000Z")).toBe(
      "maximilian-memory-code_reviewer_2-2026-09-24.json",
    )
  })
})

// ── Model: strict import parsing ────────────────────────────────────────────

describe("memory import parser", () => {
  const validFile = {
    kind: MEMORY_EXPORT_KIND,
    version: MEMORY_EXPORT_VERSION,
    role: "planner",
    exportedAt: "2026-09-24T08:00:00.000Z",
    buckets: {
      userFeedback: [
        { content: "prefer tables", mime: "text/plain" },
        { content: '{"a":1}', mime: "application/json", metadata: { at: "2026-09-20" } },
      ],
      commonErrors: [{ content: "forgot cleanup", mime: "text/plain" }],
    },
    efficacy: { commonErrors: { injectedCount: 2, deltaSum: -1 } },
  }

  it("accepts a valid file and fills zero counts for absent buckets", () => {
    const parsed = parseMemoryImportFile(JSON.stringify(validFile))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.totalEntries).toBe(3)
    expect(parsed.counts).toEqual({
      userFeedback: 2,
      reviewSuggestions: 0,
      commonErrors: 1,
      goodExamples: 0,
    })
    expect(parsed.buckets.userFeedback?.[1]?.metadata).toEqual({ at: "2026-09-20" })
    expect(parsed.efficacy).toEqual({ commonErrors: { injectedCount: 2, deltaSum: -1 } })
    expect(parsed.archived).toBeUndefined()
  })

  it("round-trips an export envelope through the parser", () => {
    const rawRow = {
      role: "planner",
      memory: {
        userFeedback: ["legacy", { content: "typed", mime: "application/json" }],
        commonErrors: [{ content: "e", mime: "text/plain" }],
        efficacy: { commonErrors: { injectedCount: 1, deltaSum: 0.5 } },
        archived: { userFeedback: [{ content: "old", mime: "text/plain" }] },
      },
    }
    const envelope = buildMemoryExportEnvelope("planner", rawRow, "2026-09-24T08:00:00.000Z")
    const parsed = parseMemoryImportFile(JSON.stringify(envelope))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.totalEntries).toBe(3)
    expect(parsed.buckets.userFeedback).toEqual([
      { content: "legacy", mime: "text/plain" },
      { content: "typed", mime: "application/json" },
    ])
    expect(parsed.archived).toEqual({
      userFeedback: [{ content: "old", mime: "text/plain" }],
    })
  })

  it("rejects broken structure with specific error codes", () => {
    expect(parseMemoryImportFile("not json{")).toEqual({
      ok: false,
      error: { code: "invalidJson" },
    })
    expect(parseMemoryImportFile("[1,2]")).toEqual({ ok: false, error: { code: "notObject" } })
    expect(parseMemoryImportFile(JSON.stringify({ role: "x" }))).toEqual({
      ok: false,
      error: { code: "missingBuckets" },
    })
    expect(parseMemoryImportFile(JSON.stringify({ buckets: [] }))).toEqual({
      ok: false,
      error: { code: "missingBuckets" },
    })
    expect(
      parseMemoryImportFile(
        JSON.stringify({ buckets: { secrets: [{ content: "x", mime: "y" }] } }),
      ),
    ).toEqual({ ok: false, error: { code: "unknownBucket", detail: "secrets" } })
    expect(parseMemoryImportFile(JSON.stringify({ buckets: { userFeedback: "nope" } }))).toEqual({
      ok: false,
      error: { code: "bucketNotArray", detail: "userFeedback" },
    })
  })

  it("requires every entry to carry non-empty string content and mime", () => {
    const cases: unknown[] = [
      { userFeedback: ["bare legacy string"] }, // no content/mime fields
      { userFeedback: [{ content: "x" }] }, // mime missing
      { userFeedback: [{ mime: "text/plain" }] }, // content missing
      { userFeedback: [{ content: "", mime: "text/plain" }] }, // empty content
      { userFeedback: [{ content: "x", mime: "" }] }, // empty mime
      { userFeedback: [null] },
      { userFeedback: [["x", "text/plain"]] },
    ]
    for (const buckets of cases) {
      const parsed = parseMemoryImportFile(JSON.stringify({ buckets }))
      expect(parsed.ok).toBe(false)
      if (parsed.ok) return
      expect(parsed.error.code).toBe("invalidEntry")
      expect(parsed.error.detail).toMatch(/^userFeedback:[1-9]/)
    }
  })

  it("rejects an all-empty import and ignores scalar efficacy/archived", () => {
    expect(parseMemoryImportFile(JSON.stringify({ buckets: { userFeedback: [] } }))).toEqual({
      ok: false,
      error: { code: "emptyImport" },
    })
    const parsed = parseMemoryImportFile(
      JSON.stringify({
        buckets: { userFeedback: [{ content: "x", mime: "text/plain" }] },
        efficacy: "garbage",
        archived: 42,
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.efficacy).toBeUndefined()
    expect(parsed.archived).toBeUndefined()
  })
})

// ── Render: export download / clipboard fallback / import dialog flow ──────

vi.mock("@/hooks/useSettingsQueries", () => ({
  SUBAGENTS_QUERY_KEY: ["settings-deep", "subagents"],
  MIGRATIONS_QUERY_KEY: ["settings-deep", "migrations"],
  useSubagentProfiles: vi.fn(),
  useMigrationCandidates: vi.fn(),
  useMemoryImport: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

import * as settingsHooks from "@/hooks/useSettingsQueries"

const mockedSettings = vi.mocked(settingsHooks)

const payload = {
  profiles: [
    {
      role: "planner",
      currentVersion: "v3",
      memory: {
        userFeedback: [{ content: "prefer tables", mime: "text/plain" }, "legacy"],
        reviewSuggestions: [],
        commonErrors: [{ content: "forgot cleanup" }],
        goodExamples: [],
        efficacy: { commonErrors: { injectedCount: 2, deltaSum: -1 } },
        archived: { userFeedback: [{ content: "old", mime: "text/plain" }] },
      },
    },
  ],
}

let mockMutate: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
  mockMutate = vi.fn()
  mockedSettings.useSubagentProfiles.mockReturnValue({
    isFetching: false,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    data: payload,
  } as never)
  mockedSettings.useMemoryImport.mockReturnValue({
    mutate: mockMutate,
    isPending: false,
  } as never)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

/** A minimal stand-in for a picked File: the component only calls .text(). */
function fakeFile(text: string): File {
  return { text: async () => text } as unknown as File
}

/** Valid import file as the export path would have produced it. */
const importFileContent = JSON.stringify({
  kind: MEMORY_EXPORT_KIND,
  version: MEMORY_EXPORT_VERSION,
  role: "planner",
  exportedAt: "2026-09-24T08:00:00.000Z",
  buckets: {
    userFeedback: [
      { content: "prefer tables", mime: "text/plain" },
      { content: "legacy", mime: "text/plain" },
    ],
    commonErrors: [{ content: "forgot cleanup", mime: "text/plain" }],
  },
  efficacy: { commonErrors: { injectedCount: 2, deltaSum: -1 } },
  archived: { userFeedback: [{ content: "old", mime: "text/plain" }] },
})

describe("memory import/export render flow", () => {
  it("exports the active role as a JSON download (Blob + a[download])", async () => {
    const createObjectURL = vi.fn(() => "blob:mock")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    renderWithQuery(<MemoryDomain />)

    fireEvent.click(screen.getByTestId("memory-export"))
    await waitFor(async () => {
      expect(screen.getByTestId("memory-export-status").textContent).toContain("downloaded")
    })
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    const blobArg = createObjectURL.mock.calls[0]?.[0] as Blob
    expect(blobArg).toBeInstanceOf(Blob)
  })

  it("falls back to the clipboard when anchor download is unavailable", async () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => {
        throw new Error("no blob urls here")
      },
      revokeObjectURL: () => {},
    })
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    renderWithQuery(<MemoryDomain />)

    fireEvent.click(screen.getByTestId("memory-export"))
    await waitFor(async () => {
      expect(screen.getByTestId("memory-export-status").textContent).toContain("clipboard")
    })
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  it("opens the confirm dialog with the four-bucket count summary", async () => {
    renderWithQuery(<MemoryDomain />)
    expect(screen.queryByTestId("memory-import-dialog")).toBeNull()

    const input = screen.getByTestId("memory-import-input")
    fireEvent.change(input, { target: { files: [fakeFile(importFileContent)] } })

    const dialog = await vi.waitFor(() => screen.getByTestId("memory-import-dialog"))
    expect(dialog).toBeTruthy()
    const summary = screen.getByTestId("memory-import-summary").textContent
    expect(summary).toContain("3") // total entries
    expect(screen.getByTestId("memory-import-count-userFeedback").textContent).toBe("2")
    expect(screen.getByTestId("memory-import-count-commonErrors").textContent).toBe("1")
    expect(screen.getByTestId("memory-import-count-goodExamples").textContent).toBe("0")
    expect(screen.getByTestId("memory-import-count-reviewSuggestions").textContent).toBe("0")
  })

  it("posts the parsed buckets for the active role on confirm", async () => {
    renderWithQuery(<MemoryDomain />)
    const input = screen.getByTestId("memory-import-input")
    fireEvent.change(input, { target: { files: [fakeFile(importFileContent)] } })
    await vi.waitFor(() => screen.getByTestId("memory-import-dialog"))

    fireEvent.click(screen.getByTestId("memory-import-confirm"))
    expect(mockMutate).toHaveBeenCalledTimes(1)
    const inputArg = mockMutate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(inputArg.role).toBe("planner")
    expect(Object.keys(inputArg.buckets as object).sort()).toEqual([
      "commonErrors",
      "goodExamples",
      "reviewSuggestions",
      "userFeedback",
    ])
    expect((inputArg.buckets as Record<string, unknown>).userFeedback).toEqual([
      { content: "prefer tables", mime: "text/plain" },
      { content: "legacy", mime: "text/plain" },
    ])
    expect(inputArg.archived).toEqual({
      userFeedback: [{ content: "old", mime: "text/plain" }],
    })
  })

  it("shows the localized parse error instead of the dialog for invalid files", async () => {
    renderWithQuery(<MemoryDomain />)
    const input = screen.getByTestId("memory-import-input")
    fireEvent.change(input, { target: { files: [fakeFile(JSON.stringify({ buckets: [] }))] } })

    expect(await vi.waitFor(() => screen.getByTestId("memory-import-status"))).toBeTruthy()
    expect(screen.getByTestId("memory-import-status").textContent).toContain("buckets")
    expect(screen.queryByTestId("memory-import-dialog")).toBeNull()
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it("closes the dialog on cancel without posting", async () => {
    renderWithQuery(<MemoryDomain />)
    const input = screen.getByTestId("memory-import-input")
    fireEvent.change(input, { target: { files: [fakeFile(importFileContent)] } })
    await vi.waitFor(() => screen.getByTestId("memory-import-dialog"))

    fireEvent.click(screen.getByTestId("memory-import-cancel"))
    expect(screen.queryByTestId("memory-import-dialog")).toBeNull()
    expect(mockMutate).not.toHaveBeenCalled()
  })
})

/** Tiny waitFor helper over timers to avoid pulling @testing-library/dom. */
async function waitFor(fn: () => Promise<void> | void): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      await fn()
      return
    } catch {
      await new Promise((r) => setTimeout(r, 10))
    }
  }
  await fn()
}
