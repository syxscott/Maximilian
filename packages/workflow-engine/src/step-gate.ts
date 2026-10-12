// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Step gate — where a step of a self-evolution-forged workflow meets the
 * checks a direct tool call meets (agentos 0c637aad borrowing, rewritten
 * for Maximilian's journal-based engine).
 *
 * A forged plan / workflow / composition produced by the evolution loop is
 * program-authored code by another name. `GatedStepExecutor` wraps any raw
 * `WorkflowExecutor` so EVERY step runs through the same gate a direct call
 * runs through: the disabled list, the caller's permission check, argument
 * validation, and approval — the approval asked at SIDE-EFFECTING steps,
 * not once per workflow.
 *
 * One rule decides which tools may be chained as steps at all:
 *   - `hasSideEffects: false` → chained freely,
 *   - `hasSideEffects: true`  → only when the host lists the tool's name
 *     in `sideEffectingTools`,
 *   - flag unset              → never (the host declares it first),
 *   - not registered          → nothing to chain.
 *
 * The gate runs THE INSTANCE IT CHECKED: the executor resolves a step's
 * tool once, checks that instance, and `createStepGate().run` refuses with
 * `step_replaced` if the name has changed hands between check and run.
 * A workflow that reaches itself is refused (`step_cycle`), and
 * compositions nest no deeper than {@link MAX_STEP_DEPTH}.
 */

import type { WorkflowExecutor, WorkflowStep } from "./index.js"

/** A tool a step may name. Structural — the runtime's registered tools fit. */
export interface StepTool {
  readonly name: string
  /**
   * Declared by the tool author. `false` chains freely, `true` chains only
   * when whitelisted, `undefined` never chains. See {@link checkChainable}.
   */
  readonly hasSideEffects?: boolean
  execute(args: unknown, context: StepRunContext): Promise<unknown>
}

/** Context handed to a step's execution. */
export interface StepRunContext {
  workflowRunId: string
  /** siteId of the step being run. */
  siteId: string
  /** Composition chain (tool names) that led here, outermost first. */
  chain: readonly string[]
}

export type StepRunResult =
  { ok: true; output: unknown } | { ok: false; error: string; code?: StepErrorCode }

export type StepErrorCode =
  | "step_disabled"
  | "permission_denied"
  | "approval_rejected"
  | "arg_validation_failed"
  | "step_replaced"
  | "step_missing"
  | "step_not_chainable"
  | "side_effects_undeclared"
  | "step_cycle"
  | "step_depth_exceeded"
  | "compose_needs_gate"
  | "step_failed"

export type ChainRefusalCode = "step_missing" | "step_not_chainable" | "side_effects_undeclared"

export type Chainability =
  { ok: true; sideEffects: boolean } | { ok: false; code: ChainRefusalCode; message: string }

export const COMPOSE_NEEDS_GATE_MESSAGE =
  "forging a composition requires a step gate; " +
  "build the executor with GatedStepExecutor (or pass createStepGate's gate) " +
  "so every step meets the checks a direct call meets"

/** Compositions nest no deeper than this at run time. */
export const MAX_STEP_DEPTH = 8

/**
 * The one rule for chaining a tool as a step. Checked at forge time
 * ({@link validateChainableSteps}) and again at every run.
 */
export function checkChainable(
  stepTool: string,
  tool: StepTool | undefined,
  sideEffectingTools: readonly string[],
): Chainability {
  if (!tool) {
    return { ok: false, code: "step_missing", message: `step tool "${stepTool}" is not registered` }
  }
  if (tool.hasSideEffects === false) {
    return { ok: true, sideEffects: false }
  }
  if (tool.hasSideEffects === undefined) {
    return {
      ok: false,
      code: "side_effects_undeclared",
      message:
        `step tool "${stepTool}" does not declare hasSideEffects; ` +
        "set it to true or false on the tool before a forged workflow can chain it",
    }
  }
  if (sideEffectingTools.includes(stepTool)) {
    return { ok: true, sideEffects: true }
  }
  return {
    ok: false,
    code: "step_not_chainable",
    message:
      `step tool "${stepTool}" has side effects and is not listed in ` +
      "the executor's sideEffectingTools",
  }
}

/**
 * Forge-time validation: every step of a forged workflow must be chainable.
 * Same rule as run time; this is the cheap refusal before anything runs.
 */
export function validateChainableSteps(
  steps: Array<{ tool: string }>,
  resolve: (name: string) => StepTool | undefined,
  sideEffectingTools: readonly string[],
): Chainability {
  for (const step of steps) {
    const verdict = checkChainable(step.tool, resolve(step.tool), sideEffectingTools)
    if (!verdict.ok) return verdict
  }
  return { ok: true, sideEffects: false }
}

/** A step tool that is itself a composition. */
export interface CompositionStepTool extends StepTool {
  readonly steps: Array<{ tool: string }>
}

/** The gate: resolve a step's tool, then run the instance you resolved. */
export interface StepGate {
  resolve(name: string): StepTool | undefined
  /**
   * Run one step as the caller. `tool` is the instance the checks were run
   * against; the gate refuses with `step_replaced` when the name now
   * resolves to a different instance.
   */
  run(tool: StepTool, args: unknown, context: StepRunContext): Promise<StepRunResult>
}

export interface StepPermissionVerdict {
  allowed: boolean
  reason?: string
}

export interface StepApprovalVerdict {
  approved: boolean
  reason?: string
}

export interface StepGateOptions {
  /** The step's tool as registered right now. */
  resolve: (name: string) => StepTool | undefined
  /** Tools the host has switched off; a step naming one is refused. */
  isDisabled?: (tool: StepTool) => boolean
  /**
   * Same permission check a direct tool call passes. Omit only in a host
   * that has no permission system for direct calls either.
   */
  checkPermission?: (
    tool: StepTool,
    args: unknown,
    context: StepRunContext,
  ) => Promise<StepPermissionVerdict> | StepPermissionVerdict
  /** Argument validation against the tool's schema; refuse before executing. */
  validateArgs?: (tool: StepTool, args: unknown) => StepPermissionVerdict
  /**
   * Approval for SIDE-EFFECTING steps, wired to the host's existing
   * permission/approval surface. Never asked for side-effect-free steps.
   * When absent, the sideEffectingTools whitelist is the only gate for
   * side-effecting steps — a host with a human-approval surface should
   * wire it here.
   */
  requestApproval?: (
    tool: StepTool,
    args: unknown,
    context: StepRunContext,
  ) => Promise<StepApprovalVerdict> | StepApprovalVerdict
}

/**
 * Build a gate for a host that owns its tool registry. Every step passes
 * the same checks in the same order a direct call passes: disabled →
 * permission → argument validation → approval (side effects only) →
 * instance-identity re-check → execute.
 */
export function createStepGate(options: StepGateOptions): StepGate {
  return {
    resolve: options.resolve,
    async run(tool, args, context) {
      const step = tool.name
      if (options.isDisabled?.(tool)) {
        return {
          ok: false,
          error: `step tool "${step}" is disabled`,
          code: "step_disabled",
        }
      }
      if (options.checkPermission) {
        const verdict = await options.checkPermission(tool, args, context)
        if (!verdict.allowed) {
          return {
            ok: false,
            error: verdict.reason ?? `permission denied for step tool "${step}"`,
            code: "permission_denied",
          }
        }
      }
      if (options.validateArgs) {
        const verdict = options.validateArgs(tool, args)
        if (!verdict.allowed) {
          return {
            ok: false,
            error: verdict.reason ?? `invalid arguments for step tool "${step}"`,
            code: "arg_validation_failed",
          }
        }
      }
      if (tool.hasSideEffects === true && options.requestApproval) {
        const verdict = await options.requestApproval(tool, args, context)
        if (!verdict.approved) {
          return {
            ok: false,
            error: verdict.reason ?? `step tool "${step}" was not approved`,
            code: "approval_rejected",
          }
        }
      }
      // The instance-identity check: the checks above ran against `tool`;
      // if the name has changed hands since, the checked instance is what
      // runs — or the step does not run at all.
      const current = options.resolve(step)
      if (current !== tool) {
        return {
          ok: false,
          error: `step tool "${step}" was re-registered between check and run`,
          code: "step_replaced",
        }
      }
      try {
        return { ok: true, output: await tool.execute(args, context) }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}

export interface GatedExecutorOptions {
  gate: StepGate
  /** The unguarded executor a step delegates to once the gate approves. */
  raw: WorkflowExecutor
  /** Tools with side effects a forged workflow may chain. */
  sideEffectingTools: readonly string[]
  /**
   * The composition chain that led to THIS workflow being forged (outermost
   * first) — a nested composition passes its parent's chain so self-
   * composition is caught across the whole stack.
   */
  parentChain?: readonly string[]
}

/**
 * A WorkflowExecutor that puts every step of a forged workflow through the
 * same gate a direct tool call passes. Compose it into the engine:
 *
 *   new WorkflowEngine(journal, new GatedStepExecutor({ gate, raw, sideEffectingTools }))
 *
 * Steps whose `tool` field is absent cannot be checked and are refused
 * (`compose_needs_gate`) — an unchecked step is exactly the hole this gate
 * exists to close.
 */
export class GatedStepExecutor implements WorkflowExecutor {
  constructor(private readonly opts: GatedExecutorOptions) {}

  /**
   * Bind this executor to a run so the step context carries the run id.
   * Compose per run: `new WorkflowEngine(journal, executor.forRun(runId))`.
   */
  forRun(runId: string, parentChain: readonly string[] = this.opts.parentChain ?? []) {
    return new BoundGatedExecutor(this.opts, runId, parentChain)
  }

  async executeStep(step: WorkflowStep, input: unknown) {
    return this.forRun("").executeStep(step, input)
  }
}

class BoundGatedExecutor implements WorkflowExecutor {
  constructor(
    private readonly opts: GatedExecutorOptions,
    private readonly runId: string,
    private readonly chain: readonly string[],
  ) {}

  async executeStep(step: WorkflowStep, input: unknown) {
    const name = step.tool
    if (!name) {
      throw new StepGateError("compose_needs_gate", COMPOSE_NEEDS_GATE_MESSAGE, step.siteId)
    }
    const tool = this.opts.gate.resolve(name)
    if (!tool) {
      throw new StepGateError("step_missing", `step tool "${name}" is not registered`, step.siteId)
    }
    const chainable = checkChainable(name, tool, this.opts.sideEffectingTools)
    if (!chainable.ok) {
      throw new StepGateError(chainable.code, chainable.message, step.siteId)
    }
    if (this.chain.includes(name)) {
      throw new StepGateError(
        "step_cycle",
        `step tool "${name}" already appears in the composition chain: ${this.chain.join(" → ")}`,
        step.siteId,
      )
    }
    const nextChain = [...this.chain, name]
    if (nextChain.length > MAX_STEP_DEPTH) {
      throw new StepGateError(
        "step_depth_exceeded",
        `composition nests deeper than ${MAX_STEP_DEPTH}: ${nextChain.join(" → ")}`,
        step.siteId,
      )
    }
    const context: StepRunContext = {
      workflowRunId: this.runId,
      siteId: step.siteId,
      chain: nextChain,
    }
    // A composite step's declared step graph is checked here too (forge
    // discipline): every named tool chainable, no self-reachability
    // (step_cycle), no nesting past the cap — the run-time gate re-checks
    // each step again when it actually executes.
    if (isComposition(tool)) {
      validateCompositionGraph(
        tool,
        nextChain,
        this.opts.gate.resolve,
        this.opts.sideEffectingTools,
      )
    }
    const result = await this.opts.gate.run(tool, step.args ?? input, context)
    if (!result.ok) {
      throw new StepGateError(result.code ?? "step_failed", result.error, step.siteId)
    }
    return result.output
  }
}

/**
 * Forge-time walk of a composition's declared step graph: chainability,
 * cycle freedom, and the depth cap — all against the same chain the run
 * will see.
 */
function validateCompositionGraph(
  composition: CompositionStepTool,
  chain: readonly string[],
  resolve: (name: string) => StepTool | undefined,
  sideEffectingTools: readonly string[],
): void {
  for (const step of composition.steps) {
    const verdict = checkChainable(step.tool, resolve(step.tool), sideEffectingTools)
    if (!verdict.ok) throw new StepGateError(verdict.code, verdict.message, step.tool)
    const next = [...chain, step.tool]
    if (chain.includes(step.tool)) {
      throw new StepGateError(
        "step_cycle",
        `composition "${composition.name}" reaches itself: ${next.join(" → ")}`,
        step.tool,
      )
    }
    if (next.length > MAX_STEP_DEPTH) {
      throw new StepGateError(
        "step_depth_exceeded",
        `composition nests deeper than ${MAX_STEP_DEPTH}: ${next.join(" → ")}`,
        step.tool,
      )
    }
    const nested = resolve(step.tool)
    if (nested && isComposition(nested)) {
      validateCompositionGraph(nested, next, resolve, sideEffectingTools)
    }
  }
}

export class StepGateError extends Error {
  constructor(
    readonly code: StepErrorCode,
    message: string,
    readonly siteId: string,
  ) {
    super(`workflow step ${siteId} refused by the step gate (${code}): ${message}`)
    this.name = "StepGateError"
  }
}

function isComposition(tool: StepTool): tool is CompositionStepTool {
  return Array.isArray((tool as Partial<CompositionStepTool>).steps)
}
