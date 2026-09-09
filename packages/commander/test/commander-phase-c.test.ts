/**
 * Phase C tests — Commander schema extensions + preflight validation.
 *
 * Borrowings:
 *   - 借鉴 #1 (parallel-feature-development): task.ownedFiles in PlannerOutput
 *   - 借鉴 #14 (autogen DiGraph): task.condition in PlannerOutput
 *   - 借鉴 #9 (conductor tracks.md): top-level tracks metadata
 *   - 借鉴 #3 (wshobson preflight): Commander.preflight() validation
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ChatResponse, Provider } from "@max/providers"
import { Commander } from "../src/index.js"

function stubProvider(id: string, fn: (system: string, user: string) => string): Provider {
  return {
    id,
    name: `Stub ${id}`,
    defaultModel: "stub-model",
    isConfigured: () => true,
    async chat(messages) {
      const system = messages.find((m) => m.role === "system")?.content ?? ""
      const user = messages.find((m) => m.role === "user")?.content ?? ""
      const content = fn(system, user)
      const response: ChatResponse = {
        content,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        finishReason: "stop",
      }
      return response
    },
    async stream() {
      throw new Error("not used in tests")
    },
  }
}

describe("Phase C — PlannerOutput schema (借鉴 #1 #14 #9)", () => {
  it("propagates ownedFiles from planner JSON into task.metadata", async () => {
    const provider = stubProvider("stub", () =>
      JSON.stringify({
        rationale: "Parallel work with disjoint file ownership.",
        tasks: [
          {
            agentRole: "backend",
            description: "Build the API.",
            dependsOn: [],
            ownedFiles: ["src/api/users.ts", "src/api/auth.ts"],
          },
          {
            agentRole: "frontend",
            description: "Build the UI.",
            dependsOn: [],
            ownedFiles: ["src/ui/users.tsx", "src/ui/auth.tsx"],
          },
        ],
      }),
    )
    const commander = new Commander(() => provider)
    const { plan } = await commander.plan("Build a users feature")
    expect(plan.tasks[0]!.metadata?.ownedFiles).toEqual(["src/api/users.ts", "src/api/auth.ts"])
    expect(plan.tasks[1]!.metadata?.ownedFiles).toEqual(["src/ui/users.tsx", "src/ui/auth.tsx"])
  })

  it("propagates condition from planner JSON into task.metadata", async () => {
    const provider = stubProvider("stub", () =>
      JSON.stringify({
        rationale: "Conditional execution.",
        tasks: [
          {
            agentRole: "backend",
            description: "Setup the database.",
            dependsOn: [],
          },
          {
            agentRole: "backend",
            description: "Run migration.",
            dependsOn: ["task-1"],
            condition: "schema defined",
          },
        ],
      }),
    )
    const commander = new Commander(() => provider)
    const { plan } = await commander.plan("Setup DB then migrate")
    expect(plan.tasks[1]!.metadata?.condition).toBe("schema defined")
    expect(plan.tasks[0]!.metadata?.condition).toBeUndefined()
  })

  it("propagates tracks metadata to plan.metadata", async () => {
    const provider = stubProvider("stub", () =>
      JSON.stringify({
        rationale: "Multi-track plan.",
        tasks: [
          { agentRole: "backend", description: "API", dependsOn: [] },
        ],
        tracks: [
          { id: "track-1", name: "Foundation", description: "Build core", phases: ["design", "implement", "review"] },
          { id: "track-2", name: "Polish", description: "Final touches", phases: ["test", "deploy"] },
        ],
      }),
    )
    const commander = new Commander(() => provider)
    const { plan } = await commander.plan("Build with tracks")
    expect(plan.metadata?.tracks).toBeDefined()
    expect((plan.metadata!.tracks as Array<{ id: string }>).map((t) => t.id)).toEqual(["track-1", "track-2"])
  })

  it("does not set plan.metadata when tracks are absent", async () => {
    const provider = stubProvider("stub", () =>
      JSON.stringify({
        rationale: "No tracks.",
        tasks: [{ agentRole: "general", description: "x", dependsOn: [] }],
      }),
    )
    const commander = new Commander(() => provider)
    const { plan } = await commander.plan("simple")
    expect(plan.metadata).toBeUndefined()
  })
})

describe("Phase C — Commander.preflight (借鉴 #3)", () => {
  let provider: Provider
  let commander: Commander

  beforeEach(() => {
    provider = {
      id: "stub",
      name: "Stub",
      defaultModel: "m",
      isConfigured: () => true,
      async chat() {
        throw new Error("preflight doesn't call the LLM")
      },
      async stream() {
        throw new Error("nope")
      },
    }
    vi.spyOn(console, "warn").mockImplementation(() => {})
    commander = new Commander(() => provider)
  })

  it("returns no warnings for a valid plan", () => {
    const plan = {
      id: "plan-1",
      workspaceId: "ws-1",
      userRequest: "x",
      rationale: "",
      tasks: [
        { id: "task-1", agentRole: "backend" as const, description: "x", status: "pending" as const, dependsOn: [] },
        { id: "task-2", agentRole: "review" as const, description: "review", status: "pending" as const, dependsOn: ["task-1"] },
      ],
      createdAt: new Date().toISOString(),
    }
    expect(commander.preflight(plan)).toEqual([])
  })

  it("warns when plan has no tasks", () => {
    const plan = {
      id: "plan-1",
      workspaceId: "ws-1",
      userRequest: "x",
      rationale: "",
      tasks: [],
      createdAt: new Date().toISOString(),
    }
    expect(commander.preflight(plan)).toContain("Plan has no tasks")
  })

  it("warns when plan has no review task", () => {
    const plan = {
      id: "plan-1",
      workspaceId: "ws-1",
      userRequest: "x",
      rationale: "",
      tasks: [
        { id: "task-1", agentRole: "backend" as const, description: "x", status: "pending" as const, dependsOn: [] },
      ],
      createdAt: new Date().toISOString(),
    }
    expect(commander.preflight(plan)).toContain("Plan is missing a review task")
  })

  it("warns when dependsOn references unknown task", () => {
    const plan = {
      id: "plan-1",
      workspaceId: "ws-1",
      userRequest: "x",
      rationale: "",
      tasks: [
        { id: "task-1", agentRole: "backend" as const, description: "x", status: "pending" as const, dependsOn: ["task-99"] },
        { id: "task-2", agentRole: "review" as const, description: "review", status: "pending" as const, dependsOn: ["task-1"] },
      ],
      createdAt: new Date().toISOString(),
    }
    const warnings = commander.preflight(plan)
    expect(warnings.some((w) => w.includes("unknown task"))).toBe(true)
  })

  it("warns when ownedFiles overlap between tasks", () => {
    const plan = {
      id: "plan-1",
      workspaceId: "ws-1",
      userRequest: "x",
      rationale: "",
      tasks: [
        { id: "task-1", agentRole: "backend" as const, description: "x", status: "pending" as const, dependsOn: [], metadata: { ownedFiles: ["src/shared.ts"] } },
        { id: "task-2", agentRole: "frontend" as const, description: "y", status: "pending" as const, dependsOn: [], metadata: { ownedFiles: ["src/shared.ts"] } },
        { id: "task-3", agentRole: "review" as const, description: "review", status: "pending" as const, dependsOn: ["task-1", "task-2"] },
      ],
      createdAt: new Date().toISOString(),
    }
    const warnings = commander.preflight(plan)
    expect(warnings.some((w) => w.includes("disjoint ownership violated"))).toBe(true)
  })

  it("does not warn when ownedFiles are disjoint", () => {
    const plan = {
      id: "plan-1",
      workspaceId: "ws-1",
      userRequest: "x",
      rationale: "",
      tasks: [
        { id: "task-1", agentRole: "backend" as const, description: "x", status: "pending" as const, dependsOn: [], metadata: { ownedFiles: ["src/api/x.ts"] } },
        { id: "task-2", agentRole: "frontend" as const, description: "y", status: "pending" as const, dependsOn: [], metadata: { ownedFiles: ["src/ui/x.tsx"] } },
        { id: "task-3", agentRole: "review" as const, description: "review", status: "pending" as const, dependsOn: ["task-1", "task-2"] },
      ],
      createdAt: new Date().toISOString(),
    }
    expect(commander.preflight(plan)).toEqual([])
  })
})