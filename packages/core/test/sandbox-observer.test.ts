/**
 * Phase E — SandboxService (借鉴 OpenHands) + PlannerObserver (借鉴 crewAI).
 */
import { describe, it, expect } from "vitest"
import { LocalSandboxService } from "../src/sandbox.js"
import { observeStep } from "../src/planner-observer.js"
import type { Task, Result } from "../src/types.js"

describe("LocalSandboxService (借鉴 OpenHands)", () => {
  it("start returns a sandbox with status=running", async () => {
    const svc = new LocalSandboxService()
    const sb = await svc.start()
    expect(sb.status).toBe("running")
    expect(sb.id).toMatch(/^sb-/)
  })

  it("get returns the sandbox info", async () => {
    const svc = new LocalSandboxService()
    const sb = await svc.start({ metadata: { workingDir: "/tmp" } })
    const got = await svc.get(sb.id)
    expect(got?.id).toBe(sb.id)
    expect(got?.status).toBe("running")
    expect(got?.metadata?.workingDir).toBe("/tmp")
  })

  it("get returns null for unknown id", async () => {
    const svc = new LocalSandboxService()
    expect(await svc.get("sb-unknown")).toBeNull()
  })

  it("pause/resume flips status", async () => {
    const svc = new LocalSandboxService()
    const sb = await svc.start()
    expect(await svc.pause(sb.id)).toBe(true)
    expect((await svc.get(sb.id))?.status).toBe("paused")
    expect(await svc.resume(sb.id)).toBe(true)
    expect((await svc.get(sb.id))?.status).toBe("running")
  })

  it("pause returns false when not running", async () => {
    const svc = new LocalSandboxService()
    const sb = await svc.start()
    await svc.pause(sb.id)
    expect(await svc.pause(sb.id)).toBe(false)
  })

  it("stop removes the sandbox", async () => {
    const svc = new LocalSandboxService()
    const sb = await svc.start()
    expect(await svc.stop(sb.id)).toBe(true)
    expect(await svc.get(sb.id)).toBeNull()
  })

  it("exec runs a command and returns stdout/stderr", async () => {
    const svc = new LocalSandboxService()
    const sb = await svc.start()
    const result = await svc.exec(sb.id, "echo hello")
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("hello")
  })

  it("exec returns error for unknown sandbox", async () => {
    const svc = new LocalSandboxService()
    const result = await svc.exec("sb-unknown", "echo")
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("not found")
  })

  it("exec refuses when sandbox is paused", async () => {
    const svc = new LocalSandboxService()
    const sb = await svc.start()
    await svc.pause(sb.id)
    const result = await svc.exec(sb.id, "echo x")
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("not running")
  })
})

describe("PlannerObserver.observeStep (借鉴 crewAI)", () => {
  function makeTask(id: string): Task {
    return { id, agentRole: "general", description: "x", status: "pending", dependsOn: [] }
  }
  function makeResult(taskId: string, output: string): Result {
    return {
      id: `r-${taskId}`,
      taskId,
      agentRole: "general",
      agentId: "stub",
      output,
      metadata: {},
      createdAt: new Date().toISOString(),
    }
  }

  it("returns all-tasks-completed when no remaining tasks", () => {
    const obs = observeStep(0, 3, [], [])
    expect(obs.reason).toBe("all-tasks-completed")
    expect(obs.stepSuccess).toBe(true)
    expect(obs.goalAchievedEarly).toBe(true)
  })

  it("returns progress when completed count increased", () => {
    const obs = observeStep(2, 3, [makeTask("t1")], [makeResult("t0", "ok")])
    expect(obs.reason).toBe("progress")
    expect(obs.stepSuccess).toBe(true)
    expect(obs.replanSuggested).toBe(false)
  })

  it("returns stall when no progress and no loop", () => {
    const obs = observeStep(3, 3, [makeTask("t1")], [makeResult("t0", "ok")])
    expect(obs.reason).toBe("stall")
    expect(obs.stepSuccess).toBe(false)
    expect(obs.replanSuggested).toBe(true)
  })

  it("returns loop when last 3 outputs are identical", () => {
    const results = [
      makeResult("a", "the same thing"),
      makeResult("b", "the same thing"),
      makeResult("c", "the same thing"),
    ]
    const obs = observeStep(0, 0, [makeTask("t1")], results)
    expect(obs.reason).toBe("loop")
    expect(obs.replanSuggested).toBe(true)
  })

  it("returns loop when last 3 outputs differ only by whitespace/case", () => {
    const results = [
      makeResult("a", "The   Same   Output"),
      makeResult("b", "the same output"),
      makeResult("c", "THE SAME OUTPUT"),
    ]
    const obs = observeStep(0, 0, [makeTask("t1")], results)
    expect(obs.reason).toBe("loop")
  })

  it("does not flag loop when outputs differ", () => {
    const results = [
      makeResult("a", "step 1 output"),
      makeResult("b", "step 2 output"),
      makeResult("c", "step 3 output"),
    ]
    const obs = observeStep(0, 0, [makeTask("t1")], results)
    expect(obs.reason).not.toBe("loop")
  })

  it("does not flag loop with fewer than 3 results", () => {
    const results = [makeResult("a", "same"), makeResult("b", "same")]
    const obs = observeStep(0, 0, [makeTask("t1")], results)
    expect(obs.reason).toBe("stall")
  })
})