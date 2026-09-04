// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Hermes self-evolution trio tests: curator (archive-not-delete), frozen
 * memory snapshots, and the background reflection fork wired through the
 * facade.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"

import type { AgentRole, AgentManifest } from "@max/core"
import type { MetricRecord } from "../src/index.js"
import {
  AgentMemoryStore,
  MemoryCurator,
  BackgroundReflector,
  defaultReflector,
  generalizeIncident,
  EvolutionFacade,
  MetricsStore,
  ProfileStore,
  emptyMemory,
} from "../src/index.js"
import { toMemoryEntry, entryContent } from "../src/types.js"

function mem(): ReturnType<typeof emptyMemory> {
  return emptyMemory()
}

function bucket(memObj: { userFeedback: ReturnType<typeof toMemoryEntry>[] }, i = 0) {
  return memObj.userFeedback
}

describe("MemoryCurator — archive-not-delete", () => {
  it("archives matching entries into memory.archived and keeps pinned ones active", () => {
    let m = mem()
    m.userFeedback.push(toMemoryEntry("prefer pnpm over npm"))
    m.userFeedback.push(toMemoryEntry("always run tests before committing"))
    m = MemoryCurator.pin(m, "userFeedback", "run tests")
    m = MemoryCurator.archive(m, "userFeedback", "prefer pnpm")

    expect(m.userFeedback).toHaveLength(1)
    const archived = m.archived?.userFeedback ?? []
    expect(archived).toHaveLength(1)
    expect(entryContent(archived[0])).toContain("prefer pnpm")
    expect(archived[0].metadata?.archivedAt).toBeTruthy()
    // pinned entry untouched
    expect(m.userFeedback.some((e) => e.metadata?.pinned === true)).toBe(true)
  })

  it("never deletes: every archived entry survives in memory.archived", () => {
    let m = mem()
    for (let i = 0; i < 5; i++) m.commonErrors.push(toMemoryEntry(`error ${i}: bad thing`))
    m = MemoryCurator.archive(m, "commonErrors", () => true)
    expect(m.commonErrors).toHaveLength(0)
    expect(m.archived?.commonErrors).toHaveLength(5)
  })
})

describe("MemoryCurator — consolidation", () => {
  it("collapses near-duplicates keeping the newest, archiving the loser", () => {
    const m = mem()
    m.userFeedback.push(toMemoryEntry("Avoid  trailing spaces."))
    m.userFeedback.push(toMemoryEntry("avoid trailing spaces"))
    m.userFeedback.push(toMemoryEntry("unrelated lesson"))
    const res = MemoryCurator.consolidate(m, "userFeedback")
    expect(res.consolidated).toBe(1)
    expect(res.memory.userFeedback.map((e) => entryContent(e))).toEqual([
      "avoid trailing spaces",
      "unrelated lesson",
    ])
    expect(res.memory.archived?.userFeedback).toHaveLength(1)
  })

  it("two pinned duplicates are both kept — pinned entries are never archived", () => {
    let m = mem()
    m.userFeedback.push(toMemoryEntry("Golden rule: validate inputs"))
    m = MemoryCurator.pin(m, "userFeedback", "golden rule")
    m.userFeedback.push(toMemoryEntry("golden rule validate inputs"))
    m = MemoryCurator.pin(m, "userFeedback", "golden rule")
    const res = MemoryCurator.consolidate(m, "userFeedback")
    // immunity beats dedupe: both pinned copies survive in the active bucket
    expect(res.consolidated).toBe(0)
    expect(res.memory.userFeedback).toHaveLength(2)
    expect(res.memory.archived?.userFeedback ?? []).toHaveLength(0)
  })

  it("a pinned entry wins over a newer unpinned duplicate", () => {
    let m = mem()
    m.userFeedback.push(toMemoryEntry("Golden rule: validate inputs"))
    m = MemoryCurator.pin(m, "userFeedback", "golden rule")
    m.userFeedback.push(toMemoryEntry("golden rule validate inputs"))
    const res = MemoryCurator.consolidate(m, "userFeedback")
    expect(res.consolidated).toBe(1)
    const active = res.memory.userFeedback.map((e) => entryContent(e))
    expect(active).toContain("Golden rule: validate inputs")
    expect(active).not.toContain("golden rule validate inputs")
  })

  it("curateAll consolidates every bucket and reports state", () => {
    const m = mem()
    m.reviewSuggestions.push(toMemoryEntry("check imports"))
    m.reviewSuggestions.push(toMemoryEntry("Check imports"))
    m.goodExamples.push(toMemoryEntry("used a table for the schema diff"))
    m.goodExamples.push(toMemoryEntry("used a table for the schema diff"))
    const report = MemoryCurator.curateAll(m)
    expect(report.consolidated).toBe(2)
    expect(report.curatorState.totalConsolidated).toBe(2)
    expect(report.curatorState.lastRunAt).toBeTruthy()
  })

  it("curateProfile persists curator bookkeeping on the profile", () => {
    const profile = {
      id: "backend",
      role: "backend" as AgentRole,
      createdAt: new Date().toISOString(),
      memory: mem(),
    } as never
    // minimal shape exercise via AgentProfileSchema-free path
    const curated = MemoryCurator.curateProfile({
      ...(profile as object),
      memory: (() => {
        const m = mem()
        m.userFeedback.push(toMemoryEntry("same"))
        m.userFeedback.push(toMemoryEntry("same"))
        return m
      })(),
    } as never) as {
      memory: { userFeedback: unknown[] }
      curatorState: { totalConsolidated: number }
    }
    expect(curated.memory.userFeedback).toHaveLength(1)
    expect(curated.curatorState.totalConsolidated).toBe(1)
  })
})

describe("Frozen memory snapshots", () => {
  it("freeze() is stable while memory mutates afterwards", () => {
    let m = mem()
    m.userFeedback.push(toMemoryEntry("lesson one"))
    const frozen = AgentMemoryStore.freeze(m)
    expect(frozen.prelude).toContain("lesson one")
    expect(frozen.hash).toHaveLength(64)

    m = AgentMemoryStore.recordFeedback(m, "lesson two written mid-session")
    const refrozen = AgentMemoryStore.freeze(m)
    expect(refrozen.prelude).not.toBe(frozen.prelude)
    // The original snapshot object is unchanged — sessions holding it keep
    // a stable prompt prefix.
    expect(AgentMemoryStore.freeze(m).hash).toBe(refrozen.hash)
    expect(frozen.hash).not.toBe(refrozen.hash)
  })

  it("freeze() of empty memory yields empty prelude and stable hash", () => {
    const frozen = AgentMemoryStore.freeze(mem())
    expect(frozen.prelude).toBe("")
    expect(frozen.hash).toHaveLength(64)
  })
})

describe("defaultReflector + generalizeIncident", () => {
  const baseRecord: MetricRecord = {
    taskId: "t1",
    agentId: "a1",
    agentRole: "backend",
    provider: "p",
    model: "m",
    executionTime: 10,
    tokenInput: 1,
    tokenOutput: 1,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    retryCount: 0,
    timestamp: new Date().toISOString(),
  }

  it("generalizes ids, hashes, paths and numbers", () => {
    const out = generalizeIncident(
      "connect ECONNREFUSED 10.0.0.7:5432 at /var/lib/app/db.js after 3 retries (id 9b2f4c3a-1111-2222-3333-ccccdddd0000)",
    )
    expect(out).not.toContain("10.0.0.7")
    expect(out).not.toContain("/var/lib/app/db.js")
    expect(out).not.toContain("9b2f4c3a")
    expect(out).toContain("<id>")
    expect(out).toContain("<path>")
  })

  it("derives a lesson from an error and none from a neutral record", async () => {
    const lessons = await defaultReflector({
      record: {
        ...baseRecord,
        error: "TypeError: cannot read property 'id' of undefined at src/x.ts",
      },
    })
    expect(lessons).toHaveLength(1)
    expect(lessons[0]).toContain("Avoid repeating")
    expect(lessons[0]).not.toContain("src/x.ts")

    expect(await defaultReflector({ record: { ...baseRecord, reviewScore: 7 } })).toEqual([])
  })

  it("captures a high-scoring pattern", async () => {
    const lessons = await defaultReflector({
      record: { ...baseRecord, reviewScore: 9 },
      output: "Grouped migrations by table then applied in idempotent order.",
    })
    expect(lessons[0]).toContain("Pattern that worked")
  })
})

describe("BackgroundReflector", () => {
  it("drains serially and reports stats", async () => {
    const seen: string[][] = []
    const reflector = new BackgroundReflector({
      onLessons: async (_role, lessons) => {
        await new Promise((r) => setTimeout(r, 1))
        seen.push(lessons)
      },
    })
    reflector.schedule({
      record: { ...({} as MetricRecord), agentRole: "backend", error: "boom 42" },
    })
    reflector.schedule({
      record: { ...({} as MetricRecord), agentRole: "frontend", reviewScore: 9 },
      output: "nice output",
    })
    await reflector.drain()
    expect(seen).toHaveLength(2)
    expect(reflector.stats).toMatchObject({ scheduled: 2, completed: 2, lessonsEmitted: 2 })
  })

  it("survives reflector crashes and counts failures", async () => {
    const reflector = new BackgroundReflector({
      reflect: () => {
        throw new Error("llm down")
      },
      onLessons: async () => {
        throw new Error("should not be called")
      },
    })
    reflector.schedule({ record: { ...({} as MetricRecord), agentRole: "backend", error: "x" } })
    await reflector.drain()
    expect(reflector.stats.failed).toBe(1)
    expect(reflector.stats.completed).toBe(0)
  })

  it("drops jobs beyond maxQueue instead of growing unbounded", async () => {
    const reflector = new BackgroundReflector({
      onLessons: async () => {},
      maxQueue: 1,
    })
    reflector.schedule({ record: { ...({} as MetricRecord), agentRole: "backend", error: "1" } })
    reflector.schedule({ record: { ...({} as MetricRecord), agentRole: "backend", error: "2" } })
    reflector.schedule({ record: { ...({} as MetricRecord), agentRole: "backend", error: "3" } })
    await reflector.drain()
    expect(reflector.stats.dropped).toBeGreaterThanOrEqual(1)
  })
})

describe("EvolutionFacade reflection wiring", () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-evo-reflect-"))
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  function makeFacade(overrides: Record<string, unknown> = {}) {
    return new EvolutionFacade({
      rootDir: tmp,
      candidates: [],
      fallbackProvider: {} as never,
      defaultManifests: {},
      ...overrides,
    } as never)
  }

  const makeRecord = (over: Partial<MetricRecord>): MetricRecord => ({
    taskId: `t-${Math.random().toString(36).slice(2, 8)}`,
    agentId: "a1",
    agentRole: "backend",
    provider: "p",
    model: "m",
    executionTime: 10,
    tokenInput: 1,
    tokenOutput: 1,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    retryCount: 0,
    timestamp: new Date().toISOString(),
    ...over,
  })

  const taskLike = { id: "t1", agentRole: "backend" } as never
  const manifestLike = {
    role: "backend",
    displayName: "backend",
    goal: "backend",
    systemPrompt: "You are the backend agent.",
  } as never

  it("recordCompletion schedules reflection; lessons land in reviewSuggestions", async () => {
    const facade = makeFacade()
    await facade.recordCompletion({
      task: taskLike,
      error: "ECONNREFUSED 10.0.0.9:5432 after 4 attempts",
      provider: "p",
      model: "m",
      executionTimeMs: 5,
      tokenInput: 1,
      tokenOutput: 1,
      defaultManifest: manifestLike,
    })
    await facade.drainReflections()

    const profile = await facade.profiles.getOrCreate("backend", manifestLike)
    const lessons = profile.memory.reviewSuggestions.map((e) => entryContent(e))
    expect(lessons).toHaveLength(1)
    expect(lessons[0]).toContain("Avoid repeating")
    expect(lessons[0]).not.toContain("10.0.0.9")
  })

  it("incident-referencing lessons are dropped by the shape lint", async () => {
    const facade = makeFacade({
      reflector: () => ["See #1234 for the postmortem and fix the retry logic"],
    })
    await facade.recordCompletion({
      task: taskLike,
      error: "some failure",
      provider: "p",
      model: "m",
      executionTimeMs: 5,
      tokenInput: 1,
      tokenOutput: 1,
      defaultManifest: manifestLike,
    })
    await facade.drainReflections()

    const profile = await facade.profiles.getOrCreate("backend", manifestLike)
    expect(profile.memory.reviewSuggestions).toHaveLength(0)
  })

  it("duplicate lessons are stored once", async () => {
    const facade = makeFacade({ reflector: () => ["Always validate inputs at the boundary"] })
    for (let i = 0; i < 3; i++) {
      await facade.recordCompletion({
        task: taskLike,
        error: `failure ${i}`,
        provider: "p",
        model: "m",
        executionTimeMs: 5,
        tokenInput: 1,
        tokenOutput: 1,
        defaultManifest: manifestLike,
      })
      await facade.drainReflections()
    }
    const profile = await facade.profiles.getOrCreate("backend", manifestLike)
    expect(profile.memory.reviewSuggestions).toHaveLength(1)
  })

  it("reflector: false disables reflection entirely", async () => {
    const facade = makeFacade({ reflector: false })
    await facade.recordCompletion({
      task: taskLike,
      error: "boom",
      provider: "p",
      model: "m",
      executionTimeMs: 5,
      tokenInput: 1,
      tokenOutput: 1,
      defaultManifest: manifestLike,
    })
    await facade.drainReflections()
    expect(facade.reflector).toBeUndefined()
    const profile = await facade.profiles.getOrCreate("backend", manifestLike)
    expect(profile.memory.reviewSuggestions).toHaveLength(0)
  })

  it("recordCompletion runs the curator: duplicates collapse into archived", async () => {
    const facade = makeFacade()
    // Prime two duplicate lessons through applyLessons directly.
    const manifest = manifestLike
    const profile0 = await facade.profiles.getOrCreate("backend", manifest)
    await facade.profiles.save({
      ...profile0,
      memory: AgentMemoryStore.recordReviewSuggestions(profile0.memory, [
        "avoid skipping migrations",
      ]),
    })

    const reflector = () => ["avoid skipping migrations"]
    const facade2 = new EvolutionFacade({
      rootDir: tmp,
      candidates: [],
      fallbackProvider: {} as never,
      defaultManifests: {},
      reflector,
    } as never)

    // Wait: facade2 would re-apply the same lesson and dedupe prevents it.
    // Instead push a near-duplicate via a second, distinct phrasing.
    const profile1 = await facade.profiles.getOrCreate("backend", manifest)
    await facade.profiles.save({
      ...profile1,
      memory: AgentMemoryStore.recordReviewSuggestions(profile1.memory, [
        "avoid  skipping migrations",
      ]),
    })

    await facade2.recordCompletion({
      task: taskLike,
      provider: "p",
      model: "m",
      executionTimeMs: 5,
      tokenInput: 1,
      tokenOutput: 1,
      defaultManifest: manifest,
    })
    await facade2.drainReflections()

    const profile = await facade.profiles.getOrCreate("backend", manifest)
    const active = profile.memory.reviewSuggestions.map((e) => entryContent(e).toLowerCase())
    const dupes = active.filter((c) => c.replace(/[^a-z]+/g, "") === "avoidskippingmigrations")
    expect(dupes).toHaveLength(1)
    expect(profile.curatorState?.totalConsolidated).toBeGreaterThanOrEqual(1)
  })
})
