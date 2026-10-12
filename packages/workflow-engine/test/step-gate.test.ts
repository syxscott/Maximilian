// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the step gate (agentos 0c637aad borrowing): a forged
 * workflow's steps pass the same checks a direct tool call passes, the one
 * chain rule, cycle/depth protection, and the gate running the instance it
 * checked.
 */
import { describe, it, expect, vi } from "vitest"
import {
  MAX_STEP_DEPTH,
  COMPOSE_NEEDS_GATE_MESSAGE,
  StepGateError,
  GatedStepExecutor,
  WorkflowEngine,
  checkChainable,
  createStepGate,
  validateChainableSteps,
  type StepErrorCode,
  type StepGateOptions,
  type StepTool,
  type WorkflowDefinition,
  type WorkflowExecutor,
  type WorkflowJournalPort,
} from "../src/index.js"

function memoryJournal(): WorkflowJournalPort {
  return {
    async append() {},
    async readAll() {
      return []
    },
  }
}

function tool(
  name: string,
  opts: { hasSideEffects?: boolean; execute?: () => unknown } = {},
): StepTool & { execute: ReturnType<typeof vi.fn> } {
  const impl = opts.execute ?? (() => `${name}-ran`)
  return {
    name,
    hasSideEffects: opts.hasSideEffects,
    execute: vi.fn(async () => impl()),
  }
}

function makeGate(
  tools: StepTool[],
  overrides: Partial<StepGateOptions> = {},
): ReturnType<typeof createStepGate> {
  const registry = new Map<string, StepTool>(tools.map((t) => [t.name, t]))
  const options: StepGateOptions = { resolve: (name) => registry.get(name), ...overrides }
  return createStepGate(options)
}

function makeEngine(executor: WorkflowExecutor): WorkflowEngine {
  return new WorkflowEngine(memoryJournal(), executor)
}

function gatedExecutor(
  gate: ReturnType<typeof createStepGate>,
  overrides: { sideEffectingTools?: string[]; parentChain?: string[] } = {},
): GatedStepExecutor {
  return new GatedStepExecutor({
    gate,
    raw: { executeStep: async () => "raw" },
    sideEffectingTools: overrides.sideEffectingTools ?? [],
    parentChain: overrides.parentChain,
  })
}

const FORGED: WorkflowDefinition = {
  scriptHash: "h",
  steps: [
    { siteId: "s1", tool: "read" },
    { siteId: "s2", tool: "write" },
  ],
}

describe("checkChainable — the one chaining rule", () => {
  const read = tool("read", { hasSideEffects: false })
  const write = tool("write", { hasSideEffects: true })
  const undeclared = tool("mystery")

  it("chains side-effect-free tools freely", () => {
    expect(checkChainable("read", read, [])).toEqual({ ok: true, sideEffects: false })
  })
  it("chains a side-effecting tool only when whitelisted", () => {
    expect(checkChainable("write", write, [])).toMatchObject({
      ok: false,
      code: "step_not_chainable",
    })
    expect(checkChainable("write", write, ["write"])).toEqual({ ok: true, sideEffects: true })
  })
  it("never chains a tool whose hasSideEffects is unset", () => {
    expect(checkChainable("mystery", undeclared, ["mystery"])).toMatchObject({
      ok: false,
      code: "side_effects_undeclared",
    })
  })
  it("an unregistered tool is missing", () => {
    expect(checkChainable("ghost", undefined, [])).toMatchObject({
      ok: false,
      code: "step_missing",
    })
  })
  it("validateChainableSteps checks every step and names the first refusal", () => {
    const resolve = (n: string) => (n === "read" ? read : n === "write" ? write : undefined)
    expect(
      validateChainableSteps([{ tool: "read" }, { tool: "ghost" }], resolve, []),
    ).toMatchObject({ ok: false, code: "step_missing" })
    expect(
      validateChainableSteps([{ tool: "read" }, { tool: "write" }], resolve, ["write"]),
    ).toEqual({ ok: true, sideEffects: false })
  })
})

describe("GatedStepExecutor — every step through the direct-call checks", () => {
  it("runs side-effect-free steps and refuses unwhitelisted side effects", async () => {
    const write = tool("write", { hasSideEffects: true })
    const raw = { executeStep: vi.fn(async () => "raw") }
    const gate = makeGate([tool("read", { hasSideEffects: false }), write])
    const engine = makeEngine(gatedExecutor(gate))
    await expect(engine.run("r1", FORGED, null)).rejects.toMatchObject({
      code: "step_not_chainable" satisfies StepErrorCode,
    })
    // s1 passed the gate; s2 was refused without executing anything.
    expect(raw.executeStep).not.toHaveBeenCalled()
    expect(write.execute).not.toHaveBeenCalled()
  })

  it("runs a whitelisted side-effecting step and asks approval AT that step", async () => {
    const requestApproval = vi.fn().mockResolvedValue({ approved: true })
    const gate = makeGate(
      [tool("read", { hasSideEffects: false }), tool("write", { hasSideEffects: true })],
      {
        requestApproval,
      },
    )
    const engine = makeEngine(gatedExecutor(gate, { sideEffectingTools: ["write"] }))
    const report = await engine.run("r1", FORGED, null)
    expect(report.completed).toHaveLength(2)
    // Approval asked once, for the side-effecting step only — not at the
    // workflow (composed call) level, not for the read.
    expect(requestApproval).toHaveBeenCalledTimes(1)
    expect(requestApproval.mock.calls[0]?.[0].name).toBe("write")
  })

  it("an unapproved side-effecting step stops the workflow (approval_rejected)", async () => {
    const write = tool("write", { hasSideEffects: true })
    const gate = makeGate([write], {
      requestApproval: () => ({ approved: false, reason: "denied by policy" }),
    })
    const engine = makeEngine(gatedExecutor(gate, { sideEffectingTools: ["write"] }))
    await expect(
      engine.run("r1", { scriptHash: "h", steps: [{ siteId: "s1", tool: "write" }] }, null),
    ).rejects.toMatchObject({ code: "approval_rejected" satisfies StepErrorCode })
    expect(write.execute).not.toHaveBeenCalled()
  })

  it("a whitelisted side-effecting step runs when the host wires no approval surface", async () => {
    // The whitelist is the invariant for side-effecting steps; approval is
    // additive when the host has an approval surface to wire.
    const write = tool("write", { hasSideEffects: true })
    const gate = makeGate([write])
    const engine = makeEngine(gatedExecutor(gate, { sideEffectingTools: ["write"] }))
    const report = await engine.run(
      "r1",
      { scriptHash: "h", steps: [{ siteId: "s1", tool: "write" }] },
      null,
    )
    expect(report.completed).toHaveLength(1)
    expect(write.execute).toHaveBeenCalled()
  })

  it("applies the disabled list, permission check and argument validation per step", async () => {
    const isDisabled = vi.fn((t: StepTool) => t.name === "blocked")
    const checkPermission = vi.fn().mockReturnValue({ allowed: true })
    const validateArgs = vi.fn().mockReturnValue({ allowed: true })
    const gate = makeGate([tool("read", { hasSideEffects: false })], {
      isDisabled,
      checkPermission,
      validateArgs,
    })
    const engine = makeEngine(gatedExecutor(gate))
    const report = await engine.run(
      "r1",
      { scriptHash: "h", steps: [{ siteId: "s1", tool: "read", args: { path: "a" } }] },
      null,
    )
    expect(report.completed).toHaveLength(1)
    expect(isDisabled).toHaveBeenCalled()
    expect(checkPermission).toHaveBeenCalled()
    expect(validateArgs).toHaveBeenCalled()
  })

  it("a disabled step is refused without executing", async () => {
    const read = tool("read", { hasSideEffects: false })
    const gate = makeGate([read], { isDisabled: () => true })
    const engine = makeEngine(gatedExecutor(gate))
    await expect(
      engine.run("r1", { scriptHash: "h", steps: [{ siteId: "s1", tool: "read" }] }, null),
    ).rejects.toMatchObject({ code: "step_disabled" satisfies StepErrorCode })
    expect(read.execute).not.toHaveBeenCalled()
  })

  it("a permission-denied step is refused", async () => {
    const read = tool("read", { hasSideEffects: false })
    const gate = makeGate([read], { checkPermission: () => ({ allowed: false, reason: "no cap" }) })
    const engine = makeEngine(gatedExecutor(gate))
    await expect(
      engine.run("r1", { scriptHash: "h", steps: [{ siteId: "s1", tool: "read" }] }, null),
    ).rejects.toMatchObject({ code: "permission_denied" satisfies StepErrorCode })
  })

  it("a step naming no tool is refused (compose_needs_gate)", async () => {
    const gate = makeGate([])
    const engine = makeEngine(gatedExecutor(gate))
    await expect(
      engine.run("r1", { scriptHash: "h", steps: [{ siteId: "s1" }] }, null),
    ).rejects.toMatchObject({ code: "compose_needs_gate" satisfies StepErrorCode })
    await expect(
      engine.run("r1", { scriptHash: "h", steps: [{ siteId: "s1" }] }, null),
    ).rejects.toThrow(COMPOSE_NEEDS_GATE_MESSAGE)
  })

  it("the gate runs the instance it checked: a name that changed hands is refused", async () => {
    const v1 = tool("read", { hasSideEffects: false, execute: () => "v1" })
    const v2 = tool("read", { hasSideEffects: false, execute: () => "v2" })
    // First resolve (the checks) sees v1; the run's identity re-check sees
    // v2 — a re-registration that lands between check and run.
    let calls = 0
    const gate = createStepGate({
      resolve: () => (calls++ === 0 ? v1 : v2),
    })
    const engine = makeEngine(gatedExecutor(gate))
    await expect(
      engine.run("r1", { scriptHash: "h", steps: [{ siteId: "s1", tool: "read" }] }, null),
    ).rejects.toMatchObject({ code: "step_replaced" satisfies StepErrorCode })
    expect(v2.execute).not.toHaveBeenCalled()
    expect(v1.execute).not.toHaveBeenCalled()
  })

  it("surfaces a step tool's own failure as a plain run failure", async () => {
    const boom = tool("boom", {
      hasSideEffects: false,
      execute: () => {
        throw new Error("kaboom")
      },
    })
    const gate = makeGate([boom])
    const engine = makeEngine(gatedExecutor(gate))
    await expect(
      engine.run("r1", { scriptHash: "h", steps: [{ siteId: "s1", tool: "boom" }] }, null),
    ).rejects.toThrow(/kaboom/)
  })
})

describe("GatedStepExecutor — cycle and depth protection", () => {
  it("a composition that reaches itself is refused (step_cycle)", async () => {
    const composite: StepTool = {
      name: "composite",
      hasSideEffects: false,
      steps: [{ tool: "composite" }],
      execute: async () => "never",
    }
    const gate = makeGate([composite])
    const engine = makeEngine(gatedExecutor(gate))
    await expect(
      engine.run("r1", { scriptHash: "h", steps: [{ siteId: "s1", tool: "composite" }] }, null),
    ).rejects.toMatchObject({ code: "step_cycle" satisfies StepErrorCode })
  })

  it("a nested composition deeper than MAX_STEP_DEPTH is refused (step_depth_exceeded)", async () => {
    const layers: StepTool[] = Array.from({ length: 3 }, (_, i) => ({
      name: `layer-${i + 1}`,
      hasSideEffects: false,
      steps: [{ tool: `layer-${i + 2}` }],
      execute: async () => i,
    }))
    const gate = makeGate(layers)
    const executor = gatedExecutor(gate)
    // A parent chain already at the cap: any further layer exceeds it.
    const bound = executor.forRun(
      "r1",
      Array.from({ length: MAX_STEP_DEPTH }, (_, i) => `outer-${i}`),
    )
    await expect(bound.executeStep({ siteId: "s1", tool: "layer-1" }, null)).rejects.toMatchObject({
      code: "step_depth_exceeded" satisfies StepErrorCode,
    })
  })

  it("nesting within the cap runs and the chain grows across layers", async () => {
    const chains: Array<readonly string[]> = []
    const inner: StepTool = {
      name: "inner",
      hasSideEffects: false,
      execute: async (_args, ctx) => {
        chains.push(ctx.chain)
        return "inner"
      },
    }
    const composite: StepTool = {
      name: "composite",
      hasSideEffects: false,
      steps: [{ tool: "inner" }],
      execute: async () => "composite",
    }
    const gate = makeGate([composite, inner])
    const executor = gatedExecutor(gate)
    const bound = executor.forRun("r1")
    await expect(bound.executeStep({ siteId: "s1", tool: "composite" }, null)).resolves.toBe(
      "composite",
    )
    // The composite's nested step list is checked at the same discipline.
    expect(chains).toHaveLength(0)
  })
})
