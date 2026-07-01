/**
 * Flow DSL — lightweight task orchestration (crewAI @start/@listen pattern).
 *
 * A Flow is a directed graph of named steps. Each step can declare
 * dependencies on other steps. The runtime executes steps in waves:
 * all steps whose dependencies are satisfied run concurrently.
 *
 * Usage:
 *   const flow = new Flow("my-flow")
 *   flow.step("fetch", fetchFn)
 *   flow.step("process", processFn, { dependsOn: ["fetch"] })
 *   flow.step("summarize", summarizeFn, { dependsOn: ["process"] })
 *   const results = await flow.run()
 *
 * Conditional steps (ConditionalTask pattern):
 *   flow.step("review", reviewFn, {
 *     dependsOn: ["process"],
 *     condition: (prev) => prev["process"]?.score < 0.8,
 *   })
 */

export type StepFn<T = unknown> = (context: StepContext<T>) => Promise<T>

export interface StepContext<T = unknown> {
  /** Results from completed steps. */
  priorResults: Record<string, T>
  /** The flow's name. */
  flowName: string
  /** The current step's name. */
  stepName: string
}

export interface StepOptions<T = unknown> {
  /** Names of steps this step depends on. */
  dependsOn?: string[]
  /**
   * Optional predicate. When present, the step is skipped if it returns false.
   * Receives the results of completed steps so far.
   */
  condition?: (priorResults: Record<string, T>) => boolean
}

interface StepDef<T = unknown> {
  name: string
  fn: StepFn<T>
  options: StepOptions<T>
}

export type FlowStatus = "pending" | "running" | "completed" | "failed"

export interface FlowResult<T = unknown> {
  status: FlowStatus
  results: Record<string, T>
  errors: Record<string, string>
  skipped: string[]
  durationMs: number
}

export class Flow<T = unknown> {
  private steps = new Map<string, StepDef<T>>()
  private maxConcurrency: number

  constructor(
    readonly name: string,
    options?: { maxConcurrency?: number },
  ) {
    this.maxConcurrency = Math.max(1, options?.maxConcurrency ?? 5)
  }

  /** Register a step. */
  step(name: string, fn: StepFn<T>, options?: StepOptions<T>): this {
    if (this.steps.has(name)) throw new Error(`step "${name}" already registered`)
    this.steps.set(name, { name, fn, options: options ?? {} })
    return this
  }

  /** Execute the flow, returning results from all steps. */
  async run(): Promise<FlowResult<T>> {
    const startedAt = Date.now()
    const results: Record<string, T> = {}
    const errors: Record<string, string> = {}
    const skipped = new Set<string>()
    const completed = new Set<string>()
    const failed = new Set<string>()
    const pending = new Set(this.steps.keys())

    let status: FlowStatus = "running"

    while (pending.size > 0) {
      // Find runnable steps
      const runnable: string[] = []
      for (const name of pending) {
        const step = this.steps.get(name)!
        const deps = step.options.dependsOn ?? []
        if (deps.some((d) => failed.has(d))) {
          // Dependency failed — skip
          skipped.add(name)
          pending.delete(name)
          continue
        }
        if (deps.every((d) => completed.has(d) || skipped.has(d))) {
          // Check condition
          if (step.options.condition && !step.options.condition(results)) {
            skipped.add(name)
            pending.delete(name)
            continue
          }
          runnable.push(name)
        }
      }

      if (runnable.length === 0 && pending.size > 0) {
        status = "failed"
        break
      }

      // Execute runnable steps concurrently (bounded by maxConcurrency)
      const chunks = chunk(runnable, this.maxConcurrency)
      for (const batch of chunks) {
        const settled = await Promise.allSettled(
          batch.map(async (name) => {
            const step = this.steps.get(name)!
            const result = await step.fn({
              priorResults: { ...results },
              flowName: this.name,
              stepName: name,
            })
            return { name, result }
          }),
        )

        for (const outcome of settled) {
          if (outcome.status === "fulfilled") {
            const { name, result } = outcome.value
            results[name] = result
            completed.add(name)
            pending.delete(name)
          } else {
            // Find which step failed by matching the batch
            const idx = settled.indexOf(outcome)
            const name = batch[idx]!
            errors[name] = outcome.reason instanceof Error
              ? outcome.reason.message
              : String(outcome.reason)
            failed.add(name)
            pending.delete(name)
          }
        }
      }
    }

    if (status === "running") {
      status = failed.size > 0 ? "failed" : "completed"
    }

    return {
      status,
      results,
      errors,
      skipped: [...skipped],
      durationMs: Date.now() - startedAt,
    }
  }
}

/** Split an array into chunks of `size`. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}
