# `@max/commander` — Request Decomposition

Commander is the entry point that turns a **user request** into an
executable **Plan of Tasks**. It does not run the plan itself — that's
`@max/core`'s `AgentRuntime`.

## What Commander owns

- **Planner LLM call** — send the user request (plus capability
  descriptions of each `AgentRole`) to a model and parse a structured
  JSON plan out of the response.
- **Capability-aware decomposition** — the planner prompt describes
  what each role can do, so the LLM picks the right `AgentRole` per task
  (借鉴 Magentic-One / AutoGen SelectorGroupChat).
- **Default / fallback plan** — if the LLM call fails or returns
  malformed JSON, Commander produces a hard-coded 3-task plan
  (backend → frontend → review) so the runtime never starves.
- **Final Review task** — every plan is appended with a reviewer task
  that gates the output quality.
- **`replan()`** — when the runtime detects a stall, Commander can
  re-decompose the remaining tasks given the results so far.

## What Commander does NOT own

The actual **planning algorithm** lives elsewhere:

| Concern | Where |
|---|---|
| Per-step self-refinement after each wave | `@max/core/src/planner-observer.ts` |
| Wave-based parallel execution + semaphore | `@max/core/src/runtime.ts` |
| Stall detection (idle / loop / progress) | `@max/core/src/stall-detection.ts` |
| Plan validator (5-dim quality gate) | `@max/core/src/validation/plan-reviewer.ts` |

So Commander is the **shell**: it calls the LLM, parses JSON, falls back
to a default. The **deep planning logic** (observing progress, refining
remaining tasks, deciding when to replan) is in `@max/core`. The reason
for the split: `@max/core` is consumed by many call sites (TUI, API,
worker, SDK); keeping the hot path there avoids forcing every consumer
to pull in `@max/commander` and its LLM dependency.

## Public surface

```ts
import { Commander } from "@max/commander";

const commander = new Commander({ provider, plannerModel, ... });

// First-pass planning
const plan = await commander.plan(userRequest, workspaceContext);

// Replan after a stall
const replan = await commander.replan(userRequest, completedResults, remainingTasks);
```

See [`src/index.ts`](./src/index.ts) for the full API and the embedded
`PLANNER_SYSTEM_PROMPT` template.

## Why a dedicated package?

`@max/commander` exists as its own package (not buried in `@max/core`)
because:

1. **Prompt engineering is a separate concern.** The capability
   descriptions, JSON schema, and fallback heuristic evolve independently
   of the runtime.
2. **Easy to swap planner back-ends.** A future "no-LLM" deterministic
   planner (template-based) can live here without touching `@max/core`.
3. **Testability.** All planner logic is mockable via the `provider`
   port, with no runtime dependencies.

## Borrowed from

- **Magentic-One / AutoGen SelectorGroupChat** — capability-driven
  task decomposition (each `AgentRole` advertises what it can do; the
  planner picks based on that).
- **crewAI** — PlannerObserver hook (the per-step refinement after each
  wave — but implemented in `@max/core/planner-observer.ts`).
- **AutoGen Magentic-One Orchestrator.loop()** — replan on stall.