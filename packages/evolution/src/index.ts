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
export { Leaderboard, aggregate } from "./leaderboard.js";
export { ModelSelector, DEFAULT_SELECTOR_CONFIG } from "./selector.js";
export { AgentMemoryStore, COMPRESSION_THRESHOLD } from "./memory.js";
export { EvolutionEngine, DEFAULT_EVOLUTION_CONFIG } from "./evolution.js";
export { EvolutionFacade } from "./facade.js";
export { evolutionAwareFactory } from "./factory.js";
