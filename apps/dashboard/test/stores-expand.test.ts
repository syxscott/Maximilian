// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Domain store expansion tests — the eight new stores (notification,
 * search, settingsUi, jobs, trajectory, workspacePrefs, onboarding,
 * connection) in zustand getState/setState style, plus the stores.*.json
 * dictionary parity check. Pure helpers are tested directly; persistence
 * is exercised through the exported load/persist pairs with hostile
 * inputs; selector hooks get renderHook spot checks.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { setLocale } from "@max/i18n"

import storesEn from "@/locales/stores.en-US.json"
import storesZh from "@/locales/stores.zh-CN.json"
import {
  NOTIFICATIONS_LIMIT,
  NOTIFICATIONS_STORAGE_KEY,
  countUnread,
  loadNotifications,
  parseNotifications,
  persistNotifications,
  pushNotification,
  useNotificationStore,
  useNotifications,
  useUnreadCount,
  type NotificationItem,
} from "@/stores/notificationStore"
import {
  RECENT_SEARCHES_LIMIT,
  SEARCH_STORAGE_KEY,
  loadRecentSearches,
  parseSearchDoc,
  parseSearchResults,
  persistRecentSearches,
  pushRecentSearch,
  selectResultsFresh,
  useRecentSearches,
  useSearchStore,
} from "@/stores/searchStore"
import {
  SETTINGS_SECTIONS,
  anyDirty,
  useHasUnsaved,
  useSectionExpanded,
  useSettingsUiStore,
  withDirty,
  withExpanded,
} from "@/stores/settingsUiStore"
import {
  filterJobs,
  parseJobs,
  sortJobs,
  useJobsStore,
  useVisibleJobs,
  type JobRecord,
} from "@/stores/jobsStore"
import {
  TRAJECTORY_WINDOW_DEFAULT,
  TRAJECTORY_WINDOW_MAX,
  TRAJECTORY_WINDOW_MIN,
  clampWindowSize,
  matchesFilter,
  useTrajectoryStore,
  useTrajectoryWindowSize,
} from "@/stores/trajectoryStore"
import {
  WORKSPACE_PREFS_STORAGE_KEY,
  defaultWorkspacePrefs,
  loadWorkspacePrefs,
  mergeWorkspacePrefs,
  parseWorkspacePrefsMap,
  persistWorkspacePrefs,
  selectWorkspacePrefs,
  useWorkspacePrefs,
  useWorkspacePrefsStore,
} from "@/stores/workspacePrefsStore"
import {
  ONBOARDING_STEPS,
  ONBOARDING_STORAGE_KEY,
  computeProgress,
  loadOnboardingDoc,
  nextStep,
  parseOnboardingDoc,
  persistOnboardingDoc,
  useCurrentOnboardingStep,
  useOnboardingStore,
} from "@/stores/onboardingStore"
import {
  coerceErrorMessage,
  coerceHealth,
  healthLabelKey,
  useConnectionStore,
  useConnectionStatus,
} from "@/stores/connectionStore"

setLocale("en-US")

const STORAGE_KEYS = [
  NOTIFICATIONS_STORAGE_KEY,
  SEARCH_STORAGE_KEY,
  WORKSPACE_PREFS_STORAGE_KEY,
  ONBOARDING_STORAGE_KEY,
]

const clearStorages = () => {
  for (const key of STORAGE_KEYS) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }
}

beforeEach(() => {
  clearStorages()
  useNotificationStore.setState({ items: [] })
  useSearchStore.setState({
    query: "",
    scope: "all",
    results: [],
    resultsFor: null,
    recent: [],
  })
  useSettingsUiStore.getState().reset()
  useJobsStore.setState({ jobs: [], sortKey: "nextRunAt", sortAsc: true, filter: "all" })
  useTrajectoryStore.getState().reset()
  useWorkspacePrefsStore.setState({ prefs: {} })
  useOnboardingStore.setState({ completed: [], skipped: false })
  useConnectionStore.setState({
    status: "reachable",
    lastError: null,
    retryCount: 0,
    lastCheckedAt: null,
  })
})

afterEach(clearStorages)

// ── notificationStore ───────────────────────────────────────────────────────

const ntf = (over: Record<string, unknown>): unknown => ({ id: "n1", messageKey: "m", ...over })

describe("notificationStore pure helpers", () => {
  it("parseNotifications keeps only well-formed entries and defaults the rest", () => {
    expect(parseNotifications(null)).toEqual([])
    expect(parseNotifications("not json")).toEqual([])
    expect(parseNotifications("[1]")).toEqual([])
    const parsed = parseNotifications(
      JSON.stringify([
        ntf({
          id: "a",
          messageKey: "k",
          kind: "error",
          read: true,
          createdAt: 5,
          params: { x: "1" },
        }),
        ntf({ id: "", messageKey: "k" }), // dropped: blank id
        { id: "b" }, // dropped: no messageKey
        { id: "d", messageKey: "" }, // dropped: blank messageKey
        ntf({ id: "c", messageKey: "k", kind: "junk" }), // kind → info
      ]),
    )
    expect(parsed).toEqual([
      { id: "a", messageKey: "k", kind: "error", read: true, createdAt: 5, params: { x: "1" } },
      { id: "c", messageKey: "k", kind: "info", read: false, createdAt: 0 },
    ])
  })

  it("parseNotifications caps params and list length", () => {
    const params = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`p${i}`, "v"]))
    const items = Array.from({ length: NOTIFICATIONS_LIMIT + 5 }, (_, i) =>
      ntf({ id: `n${i}`, messageKey: "k", params }),
    )
    const parsed = parseNotifications(JSON.stringify(items))
    expect(parsed).toHaveLength(NOTIFICATIONS_LIMIT)
    expect(Object.keys(parsed[0]?.params ?? {})).toHaveLength(8)
  })

  it("pushNotification prepends and caps", () => {
    const item: NotificationItem = {
      id: "x",
      kind: "info",
      messageKey: "k",
      createdAt: 1,
      read: false,
    }
    expect(pushNotification([], item)).toEqual([item])
    const many = Array.from({ length: NOTIFICATIONS_LIMIT }, (_, i) => ({ ...item, id: `old${i}` }))
    expect(pushNotification(many, item)).toHaveLength(NOTIFICATIONS_LIMIT)
    expect(pushNotification(many, item)[0]?.id).toBe("x")
  })

  it("countUnread counts only unread items", () => {
    const items = [
      { id: "a", kind: "info", messageKey: "k", createdAt: 0, read: false },
      { id: "b", kind: "info", messageKey: "k", createdAt: 0, read: true },
      { id: "c", kind: "info", messageKey: "k", createdAt: 0, read: false },
    ]
    expect(countUnread(items)).toBe(2)
  })
})

describe("useNotificationStore", () => {
  it("pushes newest-first, persists, and bulk actions update read state", () => {
    useNotificationStore.getState().push("info", "stores.notification.empty")
    useNotificationStore
      .getState()
      .push("error", "stores.connection.lastError", { message: "boom" }, "custom-id")
    const items = useNotificationStore.getState().items
    expect(items.map((n) => n.id)).toEqual(["custom-id", expect.any(String)])
    expect(items[0]?.params).toEqual({ message: "boom" })
    expect(countUnread(items)).toBe(2)
    expect(JSON.parse(localStorage.getItem(NOTIFICATIONS_STORAGE_KEY) ?? "[]")).toHaveLength(2)

    useNotificationStore.getState().markRead("custom-id")
    expect(useNotificationStore.getState().items[0]?.read).toBe(true)
    useNotificationStore.getState().markAllRead()
    expect(countUnread(useNotificationStore.getState().items)).toBe(0)
  })

  it("remove drops one item, clear empties everything", () => {
    useNotificationStore.getState().push("info", "k", undefined, "a")
    useNotificationStore.getState().push("info", "k", undefined, "b")
    useNotificationStore.getState().remove("a")
    expect(useNotificationStore.getState().items.map((n) => n.id)).toEqual(["b"])
    useNotificationStore.getState().clear()
    expect(useNotificationStore.getState().items).toEqual([])
    expect(localStorage.getItem(NOTIFICATIONS_STORAGE_KEY)).toBe("[]")
  })

  it("selector hooks track the list and the unread badge", () => {
    const { result: items } = renderHook(() => useNotifications())
    const { result: unread } = renderHook(() => useUnreadCount())
    expect(items.current).toEqual([])
    expect(unread.current).toBe(0)
    act(() => useNotificationStore.getState().push("success", "k", undefined, "s1"))
    expect(items.current).toHaveLength(1)
    expect(unread.current).toBe(1)
  })

  it("load/persist round-trip survives a throwing storage", () => {
    // Passing undefined explicitly falls back to the default (real) storage.
    expect(loadNotifications(undefined)).toEqual([])
    persistNotifications([{ id: "r", kind: "info", messageKey: "k", createdAt: 3, read: false }])
    expect(loadNotifications().map((n) => n.id)).toEqual(["r"])
    const throwing = {
      getItem: () => {
        throw new Error("no")
      },
    } as unknown as Storage
    expect(loadNotifications(throwing)).toEqual([])
  })
})

// ── searchStore ─────────────────────────────────────────────────────────────

describe("searchStore pure helpers", () => {
  it("pushRecentSearch front-inserts, dedupes, caps and trims blanks", () => {
    expect(pushRecentSearch([], "  a  ")).toEqual(["a"])
    expect(pushRecentSearch(["a", "b"], "a")).toEqual(["a", "b"])
    expect(pushRecentSearch(["a"], "   ")).toEqual(["a"])
    let recent: string[] = []
    for (let i = 0; i < RECENT_SEARCHES_LIMIT + 3; i++) recent = pushRecentSearch(recent, `q${i}`)
    expect(recent).toHaveLength(RECENT_SEARCHES_LIMIT)
    expect(recent[0]).toBe(`q${RECENT_SEARCHES_LIMIT + 2}`)
  })

  it("parseSearchDoc accepts only sane documents", () => {
    expect(parseSearchDoc(null)).toEqual({ recent: [] })
    expect(parseSearchDoc("{")).toEqual({ recent: [] })
    expect(parseSearchDoc("[]")).toEqual({ recent: [] })
    expect(parseSearchDoc('{"recent":["a","",42,"b"]}')).toEqual({ recent: ["a", "b"] })
  })

  it("parseSearchResults drops junk entries and bounds fields", () => {
    expect(parseSearchResults("nope")).toEqual([])
    const results = parseSearchResults([
      { id: "1", label: "Task one", scope: "tasks", detail: "d", taskId: "t1" },
      { id: "", label: "no id" },
      { label: "no id either" },
      42,
    ])
    expect(results).toEqual([
      { id: "1", label: "Task one", scope: "tasks", detail: "d", taskId: "t1" },
    ])
  })
})

describe("useSearchStore", () => {
  it("setQuery edits the live query; setScope validates and invalidates results", () => {
    useSearchStore.getState().setResults([{ id: "1", label: "hit" }])
    expect(useSearchStore.getState().results).toHaveLength(1)
    useSearchStore.getState().setQuery("needle")
    expect(useSearchStore.getState().query).toBe("needle")
    useSearchStore.getState().setScope("tasks")
    const s = useSearchStore.getState()
    expect(s.scope).toBe("tasks")
    expect(s.results).toEqual([]) // scope switch invalidated the cache
    expect(s.resultsFor).toBeNull()
  })

  it("setResults tags the cache with the answering query+scope", () => {
    useSearchStore.getState().setQuery("docs")
    useSearchStore.getState().setResults([{ id: "1", label: "hit" }])
    expect(selectResultsFresh(useSearchStore.getState())).toBe(true)
    useSearchStore.getState().setQuery("other")
    expect(selectResultsFresh(useSearchStore.getState())).toBe(false)
  })

  it("commitSearch persists history; removeRecent/clearRecent maintain it", () => {
    useSearchStore.getState().setQuery("first")
    useSearchStore.getState().commitSearch()
    useSearchStore.getState().setQuery("second")
    useSearchStore.getState().commitSearch()
    expect(useSearchStore.getState().recent).toEqual(["second", "first"])
    expect(JSON.parse(localStorage.getItem(SEARCH_STORAGE_KEY) ?? "{}")).toMatchObject({
      recent: ["second", "first"],
    })
    useSearchStore.getState().removeRecent("second")
    expect(useSearchStore.getState().recent).toEqual(["first"])
    useSearchStore.getState().clearRecent()
    expect(useSearchStore.getState().recent).toEqual([])
    expect(localStorage.getItem(SEARCH_STORAGE_KEY)).toBe('{"recent":[]}')
  })

  it("useRecentSearches tracks the committed history", () => {
    const { result } = renderHook(() => useRecentSearches())
    expect(result.current).toEqual([])
    act(() => {
      useSearchStore.getState().setQuery("hooked")
      useSearchStore.getState().commitSearch()
    })
    expect(result.current).toEqual(["hooked"])
  })

  it("load/persist round-trip and defensive storage", () => {
    expect(loadRecentSearches(undefined)).toEqual([]) // nothing persisted yet
    persistRecentSearches(["x", "y"])
    expect(loadRecentSearches()).toEqual(["x", "y"])
  })
})

// ── settingsUiStore ─────────────────────────────────────────────────────────

describe("settingsUiStore pure helpers", () => {
  it("withExpanded toggles or sets, defaulting unknown sections to open", () => {
    expect(withExpanded({}, "providers")).toEqual({ providers: true })
    expect(withExpanded({ providers: true }, "providers")).toEqual({ providers: false })
    expect(withExpanded({ providers: false }, "providers", true)).toEqual({ providers: true })
  })

  it("withDirty keeps only explicit true flags; anyDirty answers the header badge", () => {
    expect(withDirty({ general: true }, "general", false)).toEqual({})
    expect(withDirty({}, "providers", true)).toEqual({ providers: true })
    expect(anyDirty({})).toBe(false)
    expect(anyDirty({ general: false, providers: true })).toBe(true)
  })
})

describe("useSettingsUiStore", () => {
  it("tracks the active section and rejects unknown ids", () => {
    useSettingsUiStore.getState().setSection("providers")
    expect(useSettingsUiStore.getState().activeSection).toBe("providers")
    useSettingsUiStore.getState().setSection("not-a-section" as never)
    expect(useSettingsUiStore.getState().activeSection).toBeNull()
    useSettingsUiStore.getState().setSection(null)
    expect(useSettingsUiStore.getState().activeSection).toBeNull()
    expect(SETTINGS_SECTIONS.length).toBeGreaterThan(0)
  })

  it("expandAll opens every listed section at once", () => {
    useSettingsUiStore.getState().expandAll(SETTINGS_SECTIONS)
    expect(Object.keys(useSettingsUiStore.getState().expanded)).toHaveLength(
      SETTINGS_SECTIONS.length,
    )
  })

  it("dirty flags are per-section: markSaved clears one, discardAll all", () => {
    useSettingsUiStore.getState().setDirty("general", true)
    useSettingsUiStore.getState().setDirty("providers", true)
    expect(anyDirty(useSettingsUiStore.getState().dirty)).toBe(true)
    useSettingsUiStore.getState().markSaved("general")
    expect(useSettingsUiStore.getState().dirty).toEqual({ providers: true })
    useSettingsUiStore.getState().discardAll()
    expect(useSettingsUiStore.getState().dirty).toEqual({})
  })

  it("selector hooks read expansion and unsaved state", () => {
    const { result: expanded } = renderHook(() => useSectionExpanded("appearance"))
    const { result: unsaved } = renderHook(() => useHasUnsaved())
    expect(expanded.current).toBe(false)
    expect(unsaved.current).toBe(false)
    act(() => {
      useSettingsUiStore.getState().toggleExpanded("appearance")
      useSettingsUiStore.getState().setDirty("general", true)
    })
    expect(expanded.current).toBe(true)
    expect(unsaved.current).toBe(true)
  })
})

// ── jobsStore ───────────────────────────────────────────────────────────────

const job = (over: Partial<JobRecord>): JobRecord => ({
  id: "j1",
  name: "nightly-index",
  kind: "scheduled",
  state: "idle",
  ...over,
})

describe("jobsStore pure helpers", () => {
  it("parseJobs accepts arrays and {jobs} payloads, drops junk and duplicates", () => {
    expect(parseJobs("nope")).toEqual([])
    expect(parseJobs({})).toEqual([])
    const payload = [
      job({ id: "a" }),
      { id: "", name: "x" }, // dropped: blank id
      "junk",
      job({ id: "b", state: "failed", error: "boom", lastRunAt: "2026-01-01T00:00:00Z" }),
      job({ id: "a" }), // duplicate dropped
    ]
    const parsed = parseJobs(payload)
    expect(parsed.map((j) => j.id)).toEqual(["a", "b"])
    expect(parsed[1]).toMatchObject({
      state: "failed",
      error: "boom",
      lastRunAt: Date.parse("2026-01-01T00:00:00Z"),
    })
    expect(parseJobs({ jobs: payload }).map((j) => j.id)).toEqual(["a", "b"])
    expect(
      parseJobs([{ id: "a", name: "x", state: "nonsense", kind: "nonsense" }])[0],
    ).toMatchObject({ state: "idle", kind: "background" })
  })

  it("filterJobs keeps matching states only", () => {
    const jobs = [job({ id: "1", state: "running" }), job({ id: "2", state: "failed" })]
    expect(filterJobs(jobs, "all")).toHaveLength(2)
    expect(filterJobs(jobs, "running").map((j) => j.id)).toEqual(["1"])
    expect(filterJobs(jobs, "failed").map((j) => j.id)).toEqual(["2"])
  })

  it("sortJobs sorts by name / timestamps, missing timestamps sink", () => {
    const jobs = [job({ id: "1", name: "b" }), job({ id: "2", name: "a" })]
    expect(sortJobs(jobs, "name", true).map((j) => j.id)).toEqual(["2", "1"])
    expect(sortJobs(jobs, "name", false).map((j) => j.id)).toEqual(["1", "2"])

    const stamped = [
      job({ id: "early", lastRunAt: 100 }),
      job({ id: "late", lastRunAt: 200 }),
      job({ id: "never" }),
    ]
    expect(sortJobs(stamped, "lastRunAt", true).map((j) => j.id)).toEqual([
      "early",
      "late",
      "never",
    ])
    expect(sortJobs(stamped, "lastRunAt", false).map((j) => j.id)).toEqual([
      "late",
      "early",
      "never",
    ])
  })
})

describe("useJobsStore", () => {
  it("setJobs parses caller-injected payloads", () => {
    useJobsStore.getState().setJobs([job({ id: "a" }), job({ id: "b", state: "running" })])
    expect(useJobsStore.getState().jobs).toHaveLength(2)
    useJobsStore.getState().setJobs("garbage")
    expect(useJobsStore.getState().jobs).toEqual([])
  })

  it("setSort flips direction on the active key, resets on a new key", () => {
    useJobsStore.getState().setSort("name")
    expect(useJobsStore.getState()).toMatchObject({ sortKey: "name", sortAsc: true })
    useJobsStore.getState().setSort("name")
    expect(useJobsStore.getState().sortAsc).toBe(false)
    useJobsStore.getState().setSort("lastRunAt")
    expect(useJobsStore.getState()).toMatchObject({ sortKey: "lastRunAt", sortAsc: true })
  })

  it("setFilter validates and clear empties the list", () => {
    useJobsStore.getState().setFilter("failed")
    expect(useJobsStore.getState().filter).toBe("failed")
    useJobsStore.getState().setFilter("nonsense" as never)
    expect(useJobsStore.getState().filter).toBe("all")
    useJobsStore.getState().setJobs([job({})])
    useJobsStore.getState().clear()
    expect(useJobsStore.getState().jobs).toEqual([])
  })

  it("selectVisibleJobs chains filter + sort; hook mirrors it", () => {
    useJobsStore.setState({
      jobs: [
        job({ id: "1", name: "b", state: "running" }),
        job({ id: "2", name: "a", state: "failed" }),
      ],
      filter: "running",
    })
    expect(useJobsStore.getState().jobs).toHaveLength(2)
    const { result } = renderHook(() => useVisibleJobs())
    expect(result.current.map((j) => j.id)).toEqual(["1"])
  })
})

// ── trajectoryStore ─────────────────────────────────────────────────────────

describe("trajectoryStore pure helpers", () => {
  it("clampWindowSize bounds junk into the renderable range", () => {
    expect(clampWindowSize(TRAJECTORY_WINDOW_MIN - 50)).toBe(TRAJECTORY_WINDOW_MIN)
    expect(clampWindowSize(TRAJECTORY_WINDOW_MAX + 50)).toBe(TRAJECTORY_WINDOW_MAX)
    expect(clampWindowSize(42.6)).toBe(43)
    expect(clampWindowSize(Number.NaN)).toBe(TRAJECTORY_WINDOW_DEFAULT)
  })

  it("matchesFilter applies the state filter and case-insensitive query", () => {
    const task = { state: "running", label: "Build backend" }
    expect(matchesFilter(task, "", "all")).toBe(true)
    expect(matchesFilter(task, "", "failed")).toBe(false)
    expect(matchesFilter(task, "BUILD", "running")).toBe(true)
    expect(matchesFilter(task, "frontend", "running")).toBe(false)
    expect(matchesFilter({ label: 42 }, "", "all")).toBe(true) // empty query matches everything
    expect(matchesFilter({ label: 42 }, "x", "all")).toBe(false) // no label → query cannot match
  })
})

describe("useTrajectoryStore", () => {
  it("view knobs update and validate", () => {
    useTrajectoryStore.getState().setQuery("docs")
    useTrajectoryStore.getState().setStateFilter("running")
    useTrajectoryStore.getState().setWindowSize(99)
    expect(useTrajectoryStore.getState()).toMatchObject({
      query: "docs",
      stateFilter: "running",
      windowSize: 99,
    })
    useTrajectoryStore.getState().setStateFilter("nonsense" as never)
    expect(useTrajectoryStore.getState().stateFilter).toBe("all")
    useTrajectoryStore.getState().showMore(1000)
    expect(useTrajectoryStore.getState().windowSize).toBe(TRAJECTORY_WINDOW_MAX)
  })

  it("selectTask is view-local; blank ids clear it", () => {
    useTrajectoryStore.getState().selectTask("t1")
    expect(useTrajectoryStore.getState().selectedTaskId).toBe("t1")
    useTrajectoryStore.getState().selectTask("")
    expect(useTrajectoryStore.getState().selectedTaskId).toBeNull()
  })

  it("clearFilters resets query+filter but keeps window and selection; reset clears all", () => {
    useTrajectoryStore.getState().selectTask("t1")
    useTrajectoryStore.getState().setWindowSize(120)
    useTrajectoryStore.getState().setQuery("x")
    useTrajectoryStore.getState().setStateFilter("failed")
    useTrajectoryStore.getState().clearFilters()
    expect(useTrajectoryStore.getState()).toMatchObject({
      query: "",
      stateFilter: "all",
      windowSize: 120,
      selectedTaskId: "t1",
    })
    useTrajectoryStore.getState().reset()
    expect(useTrajectoryStore.getState().selectedTaskId).toBeNull()
    expect(useTrajectoryStore.getState().windowSize).toBe(TRAJECTORY_WINDOW_DEFAULT)
  })

  it("window size hook tracks the store", () => {
    const { result } = renderHook(() => useTrajectoryWindowSize())
    expect(result.current).toBe(TRAJECTORY_WINDOW_DEFAULT)
    act(() => useTrajectoryStore.getState().setWindowSize(77))
    expect(result.current).toBe(77)
  })
})

// ── workspacePrefsStore ─────────────────────────────────────────────────────

describe("workspacePrefsStore pure helpers", () => {
  it("parseWorkspacePrefsMap keeps only valid string-keyed entries", () => {
    expect(parseWorkspacePrefsMap(null)).toEqual({})
    expect(parseWorkspacePrefsMap("{")).toEqual({})
    expect(parseWorkspacePrefsMap("[]")).toEqual({})
    const parsed = parseWorkspacePrefsMap(
      JSON.stringify({
        ws1: { sidebarHidden: true, sortOrder: "alpha", lastVisitedAt: 9 },
        ws2: { sortOrder: "nonsense" }, // coerced to defaults
      }),
    )
    expect(parsed.ws1).toEqual({ sidebarHidden: true, sortOrder: "alpha", lastVisitedAt: 9 })
    expect(parsed.ws2).toEqual(defaultWorkspacePrefs())
  })

  it("mergeWorkspacePrefs validates the patch over the base", () => {
    expect(mergeWorkspacePrefs(undefined, { sidebarHidden: true })).toEqual({
      sidebarHidden: true,
      sortOrder: "recent",
      lastVisitedAt: 0,
    })
    expect(
      mergeWorkspacePrefs(defaultWorkspacePrefs(5), {
        sortOrder: "bogus" as never,
        lastVisitedAt: 7,
      }),
    ).toEqual({ sidebarHidden: false, sortOrder: "recent", lastVisitedAt: 7 })
  })
})

describe("useWorkspacePrefsStore", () => {
  it("updatePrefs creates then patches a record and persists it", () => {
    useWorkspacePrefsStore.getState().updatePrefs("ws-1", { sidebarHidden: true })
    expect(useWorkspacePrefsStore.getState().prefs["ws-1"]?.sidebarHidden).toBe(true)
    useWorkspacePrefsStore.getState().updatePrefs("ws-1", { sortOrder: "alpha" })
    expect(useWorkspacePrefsStore.getState().prefs["ws-1"]).toMatchObject({
      sidebarHidden: true,
      sortOrder: "alpha",
    })
    expect(loadWorkspacePrefs()).toMatchObject({ "ws-1": { sortOrder: "alpha" } })
  })

  it("markVisited stamps an injectable timestamp", () => {
    useWorkspacePrefsStore.getState().markVisited("ws-2", 1234)
    expect(useWorkspacePrefsStore.getState().prefs["ws-2"]?.lastVisitedAt).toBe(1234)
  })

  it("forgetWorkspace drops only the target record", () => {
    useWorkspacePrefsStore.getState().updatePrefs("ws-1", {})
    useWorkspacePrefsStore.getState().updatePrefs("ws-2", {})
    useWorkspacePrefsStore.getState().forgetWorkspace("ws-1")
    expect(Object.keys(useWorkspacePrefsStore.getState().prefs)).toEqual(["ws-2"])
    useWorkspacePrefsStore.getState().forgetWorkspace("missing") // no-op
    expect(Object.keys(useWorkspacePrefsStore.getState().prefs)).toEqual(["ws-2"])
  })

  it("selector defaults untouched workspaces; hook reads one workspace", () => {
    expect(selectWorkspacePrefs("ghost")(useWorkspacePrefsStore.getState())).toEqual(
      defaultWorkspacePrefs(),
    )
    const { result } = renderHook(() => useWorkspacePrefs("ws-3"))
    expect(result.current.sidebarHidden).toBe(false) // defaulted record
    act(() => useWorkspacePrefsStore.getState().updatePrefs("ws-3", { sidebarHidden: true }))
    expect(result.current.sidebarHidden).toBe(true)
  })

  it("storage round-trips", () => {
    persistWorkspacePrefs({ ws: defaultWorkspacePrefs(11) })
    expect(loadWorkspacePrefs().ws).toEqual(defaultWorkspacePrefs(11))
  })
})

// ── onboardingStore ─────────────────────────────────────────────────────────

describe("onboardingStore pure helpers", () => {
  it("parseOnboardingDoc filters unknown steps and rejects junk", () => {
    expect(parseOnboardingDoc(null)).toEqual({ completed: [], skipped: false })
    expect(parseOnboardingDoc("nope")).toEqual({ completed: [], skipped: false })
    expect(parseOnboardingDoc("[]")).toEqual({ completed: [], skipped: false })
    expect(
      parseOnboardingDoc(
        JSON.stringify({ completed: ["welcome", "hax", "connect"], skipped: true }),
      ),
    ).toEqual({ completed: ["welcome", "connect"], skipped: true })
  })

  it("computeProgress and nextStep walk the tour in order", () => {
    expect(computeProgress([], false)).toBe(0)
    expect(computeProgress(["welcome"], false)).toBe(0.25)
    expect(computeProgress(ONBOARDING_STEPS, false)).toBe(1)
    expect(computeProgress(["welcome"], true)).toBe(1) // skipped counts as done
    expect(nextStep([], false)).toBe("welcome")
    expect(nextStep(["welcome", "connect"], false)).toBe("workspace")
    expect(nextStep(ONBOARDING_STEPS, false)).toBeNull()
    expect(nextStep([], true)).toBeNull()
  })
})

describe("useOnboardingStore", () => {
  it("completing steps persists in tour order; duplicates are no-ops", () => {
    useOnboardingStore.getState().completeStep("connect")
    useOnboardingStore.getState().completeStep("welcome")
    useOnboardingStore.getState().completeStep("welcome")
    // Arrival order does not matter — completed always stays in tour order.
    expect(useOnboardingStore.getState().completed).toEqual(["welcome", "connect"])
    expect(loadOnboardingDoc().completed).toEqual(["welcome", "connect"])
  })

  it("reopenStep undoes one step; skip and reset manage the whole tour", () => {
    const { result: currentStep } = renderHook(() => useCurrentOnboardingStep())
    act(() => {
      const store = useOnboardingStore.getState()
      store.completeStep("welcome")
      store.reopenStep("welcome")
    })
    expect(useOnboardingStore.getState().completed).toEqual([])
    useOnboardingStore.getState().reopenStep("welcome") // no-op when not done
    expect(useOnboardingStore.getState().skipped).toBe(false)
    act(() => useOnboardingStore.getState().skip())
    expect(useOnboardingStore.getState().skipped).toBe(true)
    expect(currentStep.current).toBeNull()
    act(() => useOnboardingStore.getState().reset())
    expect(useOnboardingStore.getState()).toMatchObject({ completed: [], skipped: false })
  })

  it("selector hooks derive progress and the current step", () => {
    const { result: currentStep } = renderHook(() => useCurrentOnboardingStep())
    act(() => {
      useOnboardingStore.getState().completeStep("welcome")
      useOnboardingStore.getState().completeStep("connect")
    })
    expect(currentStep.current).toBe("workspace")
    expect(loadOnboardingDoc().completed).toEqual(["welcome", "connect"])
  })

  it("doc round-trips through storage", () => {
    persistOnboardingDoc({ completed: ["welcome"], skipped: false })
    expect(loadOnboardingDoc()).toEqual({ completed: ["welcome"], skipped: false })
  })
})

// ── connectionStore ─────────────────────────────────────────────────────────

describe("connectionStore pure helpers", () => {
  it("coerceHealth accepts only known statuses", () => {
    expect(coerceHealth("reachable")).toBe("reachable")
    expect(coerceHealth("degraded")).toBe("degraded")
    expect(coerceHealth("unreachable")).toBe("unreachable")
    expect(coerceHealth("excellent")).toBeUndefined()
    expect(coerceHealth(42)).toBeUndefined()
  })

  it("coerceErrorMessage trims and bounds; blank becomes null", () => {
    expect(coerceErrorMessage("  boom  ")).toBe("boom")
    expect(coerceErrorMessage("   ")).toBeNull()
    expect(coerceErrorMessage(42)).toBeNull()
    expect(coerceErrorMessage("x".repeat(400))).toHaveLength(300)
  })

  it("healthLabelKey names the dictionary keys", () => {
    expect(healthLabelKey("reachable")).toBe("stores.connection.status.reachable")
    expect(healthLabelKey("unreachable")).toBe("stores.connection.status.unreachable")
  })
})

describe("useConnectionStore", () => {
  it("setHealth records observations; junk is ignored", () => {
    useConnectionStore.getState().setHealth("degraded", 100)
    expect(useConnectionStore.getState()).toMatchObject({ status: "degraded", lastCheckedAt: 100 })
    useConnectionStore.getState().setHealth("galaxy-brain", 200)
    expect(useConnectionStore.getState().status).toBe("degraded")
    useConnectionStore.getState().setHealth("reachable", 300)
    expect(useConnectionStore.getState().status).toBe("reachable")
  })

  it("healthy observations clear the sticky error and retry counter", () => {
    useConnectionStore.getState().setError("socket hung up", 1)
    useConnectionStore.getState().retry()
    expect(useConnectionStore.getState()).toMatchObject({
      status: "degraded",
      retryCount: 1,
      lastError: { message: "socket hung up", at: 1 },
    })
    useConnectionStore.getState().setHealth("reachable", 2)
    expect(useConnectionStore.getState()).toMatchObject({ lastError: null, retryCount: 0 })
  })

  it("setError degrades but never downgrades an unreachable status; junk is ignored", () => {
    useConnectionStore.getState().setHealth("unreachable", 1)
    useConnectionStore.getState().setError("timeout", 2)
    expect(useConnectionStore.getState().status).toBe("unreachable")
    expect(useConnectionStore.getState().lastError).toEqual({ message: "timeout", at: 2 })
    useConnectionStore.getState().setError("   ", 3)
    expect(useConnectionStore.getState().lastError).toEqual({ message: "timeout", at: 2 })
  })

  it("retry counts up and clearError clears the sticky error only", () => {
    useConnectionStore.getState().setError("down", 1)
    useConnectionStore.getState().retry()
    useConnectionStore.getState().retry()
    expect(useConnectionStore.getState().retryCount).toBe(2)
    useConnectionStore.getState().clearError()
    expect(useConnectionStore.getState().lastError).toBeNull()
    expect(useConnectionStore.getState().status).toBe("degraded")
  })

  it("status hook tracks the store", () => {
    const { result } = renderHook(() => useConnectionStatus())
    expect(result.current).toBe("reachable")
    act(() => useConnectionStore.getState().setHealth("degraded"))
    expect(result.current).toBe("degraded")
  })
})

// ── stores i18n dictionaries ────────────────────────────────────────────────

describe("stores dictionaries", () => {
  const keys = (o: unknown, prefix = ""): string[] =>
    o !== null && typeof o === "object"
      ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
          v !== null && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
        )
      : []

  it("have identical key trees in zh-CN and en-US", () => {
    expect(keys(storesZh).sort()).toEqual(keys(storesEn).sort())
  })

  it("cover every new store domain in both locales", () => {
    for (const domain of [
      "notification",
      "search",
      "settingsUi",
      "jobs",
      "trajectory",
      "workspacePrefs",
      "onboarding",
      "connection",
    ]) {
      expect(Object.keys(storesEn.stores as object)).toContain(domain)
      expect(Object.keys(storesZh.stores as object)).toContain(domain)
    }
    expect(Object.keys(storesZh)).toEqual(["stores"])
    expect(Object.keys(storesEn)).toEqual(["stores"])
  })

  it("keep the composer hint intact", () => {
    const c = storesEn.stores as unknown as { composer: { draftPlaceholder: string } }
    expect(c.composer.draftPlaceholder).toContain("workspace")
  })
})
