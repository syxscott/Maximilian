/**
 * @max/evolution — Agent Evolution Engine
 *
 * Public surface. Six phases, six modules:
 *   - MetricsStore        (Phase 1) record per-task metrics
 *   - ProfileStore        (Phase 2) long-term per-role profile
 *   - Leaderboard         (Phase 3) per-(role, provider, model) ranking
 *   - ModelSelector       (Phase 4) auto-pick the best (provider, model)
 *   - AgentMemoryStore    (Phase 5) per-role memory with compression
 *   - EvolutionEngine     (Phase 6) A/B test new prompt versions
 *
 * Plus a high-level `EvolutionFacade` that wires them together and exposes
 * the operations the runtime / API layer needs.
 */

export * from "./types.js";
export { MetricsStore } from "./metrics-store.js";
export { ProfileStore } from "./profile-store.js";
export {
  Leaderboard,
  aggregate,
  MIN_DOMAINS_FOR_OVERALL,
  type AggregateOptions,
} from "./leaderboard.js";
export { ModelSelector, DEFAULT_SELECTOR_CONFIG } from "./selector.js";
export { AgentMemoryStore, COMPRESSION_THRESHOLD } from "./memory.js";
export { EvolutionEngine, DEFAULT_EVOLUTION_CONFIG, type EvolutionEngineOptions } from "./evolution.js";
export { EvolutionFacade } from "./facade.js";
export { evolutionAwareFactory } from "./factory.js";
export {
  SCORE_THRESHOLD,
  ACCEPTANCE_THRESHOLD,
  MIN_SAMPLES,
  AB_SAMPLE_SIZE,
  PROMOTE_MARGIN,
} from "./evolution.js";
export {
  validateCandidate,
  PROMPT_GROWTH_MAX,
  PROMPT_MIN_LEN,
  PROMPT_MAX_LEN,
  type GateResult,
  type GateCode,
  type CandidateLike,
} from "./constraint-gates.js";
export {
  containsSecret,
  findSecrets,
  scrubSecrets,
  type SecretMatch,
} from "./secret-scrub.js";
export {
  defaultJudge,
  toReviewScore,
  type Judge,
  type JudgeInput,
  type JudgeOutput,
} from "./llm-judge.js";
// Phase 3b — opencode trace + variant runner
export {
  OpencodeTraceCollector,
  TraceSchema,
  MessageSchema,
  ToolCallSchema,
  TokensSchema,
  type Trace,
  type Message,
  type ToolCall,
  type Tokens,
  type TraceCollectorSdk,
  type OpencodeTraceCollectorOptions,
} from "./opencode-trace-collector.js";
export {
  VariantRunner,
  identityMutator,
  type VariantMutator,
  type VariantJudge,
  type VariantScore,
  type VariantRun,
  type VariantRunOptions,
  type VariantRunReport,
  type LeaderboardRow,
  type VariantExecutor,
} from "./variant-runner.js";
