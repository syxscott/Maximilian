/**
 * High-level facade that composes the six evolution modules.
 *
 * This is what the runtime and API layer use. It hides the wiring:
 *   - one MetricsStore / ProfileStore / Leaderboard
 *   - one ModelSelector  that consumes the leaderboard
 *   - one EvolutionEngine that consults the metrics + profile
 *
 * It also exposes two operations the runtime needs without modifying it:
 *   - recordCompletion(...)   hook called after a task completes
 *   - selectForRole(role)     called by the agent factory wrapper
 */

import type { AgentRole, AgentManifest, Result, Task, Workspace } from "@max/core"
import type { Provider } from "@max/providers"
import { MetricsStore, type MetricsStoreLike } from "./metrics-store.js"
import { ProfileStore } from "./profile-store.js"
import { Leaderboard } from "./leaderboard.js"
import { ModelSelector } from "./selector.js"
import { AgentMemoryStore } from "./memory.js"
import { MemoryCurator, normalizeContentKey } from "./curator.js"
import { EvolutionEngine, SCORE_THRESHOLD } from "./evolution.js"
import { SealedFileVault } from "./sealed-files.js"
import { lintPromptShape } from "./artifact-lint.js"
import { containsSecret, scrubSecrets } from "./secret-scrub.js"
import { entryContent } from "./types.js"
import { BackgroundReflector, defaultReflector, type Reflector } from "./reflection.js"
import { isPolicyDeniedMessage } from "@max/core"
import type { AgentProfile, MetricRecord, ModelSelection } from "./types.js"

export interface CompletionInput {
  task: Task
  result?: Result
  error?: string
  provider: string
  model: string
  executionTimeMs: number
  tokenInput: number
  tokenOutput: number
  /** Tokens served from provider-side prompt cache. 0 if not reported. */
  cacheReadTokens?: number
  /** Tokens written into provider-side cache. 0 for OpenAI-style protocols. */
  cacheCreationTokens?: number
  reviewScore?: number
  userAccepted?: boolean
  defaultManifest: AgentManifest
}

export interface EvolutionFacadeOptions {
  rootDir: string
  candidates: Provider[]
  fallbackProvider: Provider
  defaultManifests: Partial<Record<AgentRole, AgentManifest>>
  /** Optional database-backed stores. When provided, overrides file-based defaults. */
  profileStore?: ProfileStore
  metricsStore?: MetricsStoreLike
  /**
   * Optional sealed-file vault (oh-my-claudecode self-improve). When set,
   * every evolution cycle runs under `guard()`: if any sealed file
   * (benchmark corpus, eval fixtures) changes while evolving, the cycle
   * aborts loudly instead of promoting a candidate measured against a
   * silently-moved target.
   */
  sealedVault?: SealedFileVault
  /**
   * Optional lesson extractor for the background reflector (hermes
   * reflection fork). When set, `recordCompletion` schedules a
   * fire-and-forget reflection job per completion; extracted lessons are
   * linted, deduplicated and appended to the role's reviewSuggestions.
   * Default: `defaultReflector` (generalizing heuristic). Pass `false` to
   * disable background reflection entirely.
   */
  reflector?: Reflector | false
}

export class EvolutionFacade {
  readonly metrics: MetricsStoreLike
  readonly profiles: ProfileStore
  readonly leaderboard: Leaderboard
  readonly selector: ModelSelector
  readonly evolution: EvolutionEngine
  readonly sealedVault?: SealedFileVault
  readonly reflector?: BackgroundReflector

  /**
   * Serializes the read-modify-write windows over a role's profile.
   * `recordCompletion` (task hot path) and `applyLessons` (background
   * reflector) both read a profile, mutate memory, and save; running two
   * of those windows interleaved would let the later save clobber the
   * earlier one's memory writes. Chain the windows — no await between a
   * profile read and its save inside a window.
   */
  private profileTxChain: Promise<unknown> = Promise.resolve()

  private profileTx<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.profileTxChain.then(fn, fn)
    this.profileTxChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  constructor(private opts: EvolutionFacadeOptions) {
    this.metrics = opts.metricsStore ?? new MetricsStore(opts.rootDir)
    this.profiles = opts.profileStore ?? new ProfileStore(opts.rootDir)
    this.leaderboard = new Leaderboard()
    this.selector = new ModelSelector(
      undefined,
      opts.candidates.map((p) => ({ provider: p })),
    )
    this.evolution = new EvolutionEngine(opts.rootDir, this.metrics, this.profiles)
    this.sealedVault = opts.sealedVault
    this.reflector =
      opts.reflector === false
        ? undefined
        : new BackgroundReflector({
            reflect: opts.reflector ?? defaultReflector,
            onLessons: (role, lessons) => this.applyLessons(role, lessons),
          })
  }

  async initialize(): Promise<void> {
    await this.leaderboard.rebuild(this.metrics)
  }

  /**
   * Hook called by the runtime after every task (success or failure).
   * Persists a metric, recomputes the leaderboard, and updates the profile.
   */
  async recordCompletion(input: CompletionInput): Promise<MetricRecord> {
    const record: MetricRecord = {
      taskId: input.task.id,
      agentId: input.result?.agentId ?? "unknown",
      agentRole: input.task.agentRole,
      provider: input.provider,
      model: input.model,
      executionTime: input.executionTimeMs,
      tokenInput: input.tokenInput,
      tokenOutput: input.tokenOutput,
      cacheReadTokens: input.cacheReadTokens ?? 0,
      cacheCreationTokens: input.cacheCreationTokens ?? 0,
      reviewScore: input.reviewScore,
      userAccepted: input.userAccepted,
      retryCount: 0,
      error: input.error,
      timestamp: new Date().toISOString(),
    }
    await this.metrics.record(record)

    await this.profileTx(async () => {
      const profile = await this.profiles.getOrCreate(input.task.agentRole, input.defaultManifest)
      const records = await this.metrics.listForRole(input.task.agentRole)
      const updated = ProfileStore.recompute(profile, records)

      let nextMemory = updated.memory
      // deny≠failure (crewAI borrowing): a governance rejection (permission
      // rules, capability gates) is a deliberate policy outcome — recording
      // it as a "common error" would teach the agent to avoid work a human
      // or a policy deliberately blocked. The metric is still recorded; only
      // the failure-learning path is skipped.
      const isPolicyDenial = isPolicyDeniedMessage(input.error)
      if (isPolicyDenial) {
        // skip failure memory
      } else if (
        input.error ||
        (input.reviewScore !== undefined && input.reviewScore < SCORE_THRESHOLD)
      ) {
        nextMemory = AgentMemoryStore.recordFailure(nextMemory, record)
      } else if (input.result) {
        nextMemory = AgentMemoryStore.recordSuccess(
          nextMemory,
          record,
          input.result.output.slice(0, 240),
        )
      }
      if (input.reviewScore !== undefined && input.result?.metadata?.review) {
        const suggestions =
          (input.result.metadata.review as { suggestions?: string[] }).suggestions ?? []
        nextMemory = AgentMemoryStore.recordReviewSuggestions(nextMemory, suggestions)
      }
      nextMemory = await AgentMemoryStore.maybeCompress(nextMemory)
      // Curator maintenance pass (hermes): collapse duplicates so the corpus
      // stays rules-not-noise. Cheap (buckets are capped at 50) and runs
      // inline with the profile save that is happening anyway.
      const curated = MemoryCurator.curateAll(nextMemory, updated.curatorState)
      nextMemory = curated.memory
      await this.profiles.save({
        ...updated,
        memory: nextMemory,
        curatorState: curated.curatorState,
      })
    })

    await this.leaderboard.rebuild(this.metrics)

    // Background reflection fork (hermes): schedule a fire-and-forget
    // lesson-extraction job. Never awaited — task completion latency is
    // unaffected, and reflector failures are counted, not raised.
    this.reflector?.schedule({ record, output: input.result?.output })

    return record
  }

  /**
   * Apply background-reflected lessons to a role's profile. Each lesson is
   * secret-scrubbed, shape-linted (incident references are dropped — the
   * corpus accumulates rules, not events) and deduplicated against what
   * the bucket already holds. Reads and writes the profile in one
   * synchronous pass to keep the read-modify-write window minimal.
   */
  private async applyLessons(role: AgentRole, lessons: string[]): Promise<void> {
    const fallback = this.opts.defaultManifests[role] ?? {
      role,
      displayName: role,
      goal: role,
      systemPrompt: `You are the ${role} agent.`,
    }
    return this.profileTx(async () => {
      const profile = await this.profiles.getOrCreate(role, fallback)
      const accepted: string[] = []
      const allBuckets = [
        ...profile.memory.reviewSuggestions,
        ...profile.memory.userFeedback,
        ...profile.memory.commonErrors,
        ...profile.memory.goodExamples,
        ...Object.values(profile.memory.archived ?? {}).flat(),
      ]
      const existing = new Set(allBuckets.map((e) => normalizeContentKey(entryContent(e))))
      for (const lesson of lessons) {
        const safe = (containsSecret(lesson) ? scrubSecrets(lesson) : lesson).trim()
        if (!safe) continue
        if (
          lintPromptShape({ text: safe }).some(
            (v) => v.code === "incident-reference" || v.code === "chat-reference",
          )
        ) {
          continue
        }
        const key = normalizeContentKey(safe)
        if (existing.has(key)) continue
        existing.add(key)
        accepted.push(safe)
      }
      if (accepted.length === 0) return
      const memory = AgentMemoryStore.recordReviewSuggestions(profile.memory, accepted)
      await this.profiles.save({ ...profile, memory })
    })
  }

  /** Resolves when all pending reflection jobs have drained. */
  async drainReflections(): Promise<void> {
    await this.reflector?.drain()
  }

  /**
   * Used by the agent factory wrapper to pick (provider, model) for a role.
   */
  selectForRole(role: AgentRole): ModelSelection {
    return this.selector.select(role, this.leaderboard, { provider: this.opts.fallbackProvider })
  }

  /**
   * Used by the agent factory wrapper to load the role's active profile
   * (so the manifest's systemPrompt includes the memory prelude).
   */
  async activeProfile(role: AgentRole): Promise<AgentProfile> {
    const fallback = this.opts.defaultManifests[role] ?? {
      role,
      displayName: role,
      goal: role,
      systemPrompt: `You are the ${role} agent.`,
    }
    return this.profiles.getOrCreate(role, fallback)
  }

  /**
   * Optional post-run trigger. If a profile is under-performing and has
   * enough history, run the evolution cycle.
   */
  async maybeEvolve(role: AgentRole): Promise<import("./types.js").EvolutionDecision | undefined> {
    const profile = await this.profiles.get(role)
    if (!profile) return undefined
    const recent = (await this.metrics.listForRole(role)).slice(-20)
    if (!EvolutionEngine.shouldEvolve(profile, recent)) return undefined
    if (!profile.manifest) return undefined
    const run = () => this.evolution.evolve(role, profile.manifest!)
    return this.sealedVault ? this.sealedVault.guard(run) : run()
  }

  /**
   * Convenience: when a workspace is fully complete (all tasks done),
   * walk the per-task metrics and persist any review scores that
   * weren't known at the time the worker task completed.
   */
  async attachReviewScores(workspace: Workspace): Promise<void> {
    const review = workspace.review
    if (!review) return
    for (const result of workspace.results) {
      if (result.agentRole === "review") continue
      const existing = await this.metrics.get(result.taskId)
      if (existing && existing.reviewScore === undefined) {
        await this.metrics.record({ ...existing, reviewScore: review.score })
      }
    }
    await this.leaderboard.rebuild(this.metrics)
  }
}
