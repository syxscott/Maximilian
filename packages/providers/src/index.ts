// @deprecated — Legacy in-process provider implementations (OpenAI / Anthropic
// / OpenRouter / DeepSeek APIs invoked directly from Node). The runtime now
// routes every agent task through `opencode serve` (see `@max/core-thin-sdk`
// and `OpencodeExecutor`). Exports here stay in place because the LLM
// presets, retry, circuit-breaker and format helpers are still consumed by
// test stubs and the meta-system's preset module — but new code should
// target the opencode kernel. Phase 4a will remove the runtime's
// in-process paths entirely; this package will be deleted in a subsequent
// release once the test stubs migrate to a thin shim or pure fakes.

export * from "./base.js"
export * from "./openai.js"
export * from "./anthropic.js"
export * from "./openrouter.js"
export * from "./deepseek.js"
export * from "./usage.js"
export * from "./registry.js"
export * from "./retry.js"
export * from "./aux-hardening.js"
export { guardSse, withSseGuard, SseTimeoutError, type SseGuardOptions } from "./sse-guard.js"
export * from "./circuit-breaker.js"
export * from "./router.js"
export * from "./presets/index.js"
export * from "./formats/index.js"
export {
  ModelCatalog,
  parseModelsDevCatalog,
  normalizeModelId,
  inferTierFromPrice,
  catalogSlugsFor,
  pickFrontierEntry,
  CATALOG_PROVIDER_ALIASES,
  type ModelCost,
  type ModelTier,
  type ModelStatus,
  type ModelCatalogEntry,
  type CatalogSource,
  type CatalogInfo,
  type ModelCatalogOptions,
} from "./model-catalog.js"
export * from "./catalog-sync.js"
export * from "./stream-watchdog.js"
export * from "./capability-predicates.js"
// Outbound error redaction (minimax-code 9a93560 borrowing). Cross-agent
// contract: apps/api imports `redactOutboundError` from this package —
// keep the export name and `(message: string, secrets: string[]): string`
// signature stable.
export { redactOutboundError } from "./redact.js"
// Body-aware error classification + trace-id capture (MiniMax-MCP-JS/cli
// borrowing). Re-exported from base.js too; listed here for direct import.
export {
  classifyProviderErrorBody,
  pickTraceId,
  extractVendorErrorCode,
  errorFactsFromUnknown,
  MINIMAX_ERROR_CODES,
} from "./error-classification.js"
export type {
  VendorErrorCodeEntry,
  VendorErrorCodeTable,
  ProviderErrorFacts,
  ClassifiedProviderError,
} from "./error-classification.js"
// Usage self-consistency gate (OpenAgentCore sessions/usage.go borrowing).
export { measuredUsage, gateUsageShape } from "./usage.js"
export type {
  MeasuredUsage,
  MeasuredUsageOptions,
  UsageCacheSemantics,
  GatedChatUsage,
} from "./usage.js"
// apiFormat-level capability Declaration (OpenAgentCore harnessconfig
// harness.go borrowing).
export * from "./format-capabilities.js"
