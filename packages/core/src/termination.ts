/**
 * TerminationCondition — composable predicates that decide when a workspace
 * execution should stop. Inspired by autogen's `TerminationCondition`
 * protocol: each predicate inspects the runtime state and returns a
 * `{ stop: true, reason }` verdict, then we AND/OR multiple conditions
 * together.
 *
 * Use cases:
 *   - Stop after N messages to bound cost.
 *   - Stop when total tokens exceed a budget.
 *   - Stop when the orchestrator emits a "handoff" signal.
 *   - Stop when the source field of the latest message matches a regex.
 */

export type TerminationContext = {
  workspaceId: string
  messagesEmitted: number
  tokensConsumed: { input: number; output: number; total: number }
  lastMessage?: { role: string; source?: string; content?: string }
  startedAt: number
  now: number
}

export type TerminationVerdict = { stop: false } | { stop: true; reason: string }

export type TerminationCondition = {
  /** Human-readable name for logging. */
  readonly name: string
  /** Evaluate the predicate. Pure: depends only on `ctx`. */
  check(ctx: TerminationContext): TerminationVerdict
}

const ok: TerminationVerdict = { stop: false }
const stop = (reason: string): TerminationVerdict => ({ stop: true, reason })

/**
 * Build a predicate from a name + boolean function. The function returns
 * `true` to stop with a default reason, or `{ stop: true, reason }` for
 * custom reasons.
 */
function predicate(
  name: string,
  fn: (ctx: TerminationContext) => boolean | { reason: string },
): TerminationCondition {
  return {
    name,
    check(ctx) {
      const result = fn(ctx)
      if (result === true) return stop(`${name} matched`)
      if (result === false) return ok
      return stop(result.reason)
    },
  }
}

// ── Standard predicates ─────────────────────────────────────────────────────

/**
 * Stop after the message count reaches `max`.
 */
export function MaxMessageTermination(max: number): TerminationCondition {
  return predicate("MaxMessageTermination", (ctx) =>
    ctx.messagesEmitted >= max ? { reason: `reached max messages ${max}` } : false,
  )
}

/**
 * Stop after total tokens exceed `max`.
 */
export function TokenUsageTermination(max: number): TerminationCondition {
  return predicate("TokenUsageTermination", (ctx) =>
    ctx.tokensConsumed.total >= max ? { reason: `token budget exhausted (${max})` } : false,
  )
}

/**
 * Stop when wall-clock duration exceeds `maxMs`.
 */
export function TimeoutTermination(maxMs: number): TerminationCondition {
  return predicate("TimeoutTermination", (ctx) =>
    ctx.now - ctx.startedAt >= maxMs ? { reason: `timed out after ${maxMs}ms` } : false,
  )
}

/**
 * Stop when the source of the last message matches a literal string.
 * Useful for "the planner agent emitted DONE" patterns.
 */
export function HandoffTermination(source: string): TerminationCondition {
  return predicate(`HandoffTermination(${source})`, (ctx) =>
    ctx.lastMessage?.source === source ? { reason: `handoff to ${source}` } : false,
  )
}

/**
 * Stop when the content of the last message matches a regex.
 */
export function TextMatchTermination(pattern: RegExp): TerminationCondition {
  const name = `TextMatchTermination(${pattern})`
  return predicate(name, (ctx) => {
    const text = ctx.lastMessage?.content
    if (!text) return false
    return pattern.test(text) ? { reason: `matched /${pattern.source}/` } : false
  })
}

// ── Combinators ────────────────────────────────────────────────────────────

/**
 * Stop if ANY inner condition triggers. The first inner verdict wins.
 */
export function OrTermination(...conditions: TerminationCondition[]): TerminationCondition {
  return {
    name: `Or(${conditions.map((c) => c.name).join(" | ")})`,
    check(ctx) {
      for (const c of conditions) {
        const v = c.check(ctx)
        if (v.stop) return v
      }
      return ok
    },
  }
}

/**
 * Stop only when ALL inner conditions trigger simultaneously. We compute
 * all verdicts first so we can return the most informative reason.
 */
export function AndTermination(...conditions: TerminationCondition[]): TerminationCondition {
  return {
    name: `And(${conditions.map((c) => c.name).join(" & ")})`,
    check(ctx) {
      const verdicts = conditions.map((c) => c.check(ctx))
      if (verdicts.every((v) => v.stop)) {
        return verdicts.find((v): v is { stop: true; reason: string } => v.stop)!
      }
      return ok
    },
  }
}

/**
 * Convenience: a condition that never terminates. Useful as a default.
 */
export const NeverTermination: TerminationCondition = {
  name: "NeverTermination",
  check: () => ok,
}