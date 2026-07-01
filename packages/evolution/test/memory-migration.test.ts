/**
 * Regression test for the legacy-profile migration. Profile JSON written
 * before the MemoryEntry MIME refactor stored each bucket as a plain
 * string[]. `AgentProfileSchema.parse()` must accept either shape so a
 * deploy doesn't break every existing profile file on first read.
 */
import { describe, it, expect } from "vitest"
import { AgentProfileSchema } from "../src/types.js"

describe("Legacy AgentMemory migration", () => {
  it("parses a profile whose memory buckets are plain string arrays", () => {
    const legacy = {
      id: "backend",
      role: "backend",
      createdAt: "2025-01-01T00:00:00.000Z",
      totalTasks: 3,
      avgScore: 7,
      successRate: 1,
      avgExecutionTime: 1.2,
      strengths: [],
      weaknesses: [],
      memory: {
        userFeedback: ["use TypeScript", "add tests"],
        reviewSuggestions: ["trim logging"],
        commonErrors: ["timeout on cold start"],
        goodExamples: ["ok output"],
        totalEntries: 4,
      },
      currentVersion: "v1",
      versions: ["v1"],
    }
    const profile = AgentProfileSchema.parse(legacy)
    expect(profile.memory.userFeedback).toEqual([
      { mime: "text/plain", content: "use TypeScript", metadata: undefined },
      { mime: "text/plain", content: "add tests", metadata: undefined },
    ])
    expect(profile.memory.commonErrors[0]?.content).toBe("timeout on cold start")
    expect(profile.memory.totalEntries).toBe(4)
  })

  it("still parses a profile whose memory buckets are typed MemoryEntry arrays", () => {
    const modern = {
      id: "backend",
      role: "backend",
      createdAt: "2025-01-01T00:00:00.000Z",
      totalTasks: 0,
      avgScore: 0,
      successRate: 1,
      avgExecutionTime: 0,
      memory: {
        userFeedback: [{ mime: "application/json", content: '{"k":1}' }],
        reviewSuggestions: [],
        commonErrors: [],
        goodExamples: [],
      },
      currentVersion: "v1",
      versions: ["v1"],
    }
    const profile = AgentProfileSchema.parse(modern)
    expect(profile.memory.userFeedback[0]?.mime).toBe("application/json")
  })
})