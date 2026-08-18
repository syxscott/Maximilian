// @deprecated — Legacy in-process provider implementations (OpenAI / Anthropic
// / OpenRouter / DeepSeek APIs invoked directly from Node). The runtime now
// routes every agent task through `opencode serve` (see `@max/core-thin-sdk`
// and `OpencodeExecutor`). Exports here stay in place because the LLM
// presets, retry, circuit-breaker and format helpers are still consumed by
// test stubs and the meta-system's preset module — but new code should
// target the opencode kernel. Phase 4a will remove the runtime's
// in-process paths entirely; this package will be deleted in a subsequent
// release once the test stubs migrate to a thin shim or pure fakes.

export * from "./base.js";
export * from "./openai.js";
export * from "./anthropic.js";
export * from "./openrouter.js";
export * from "./deepseek.js";
export * from "./usage.js";
export * from "./registry.js";
export * from "./retry.js";
export * from "./circuit-breaker.js";
export * from "./router.js";
export * from "./presets/index.js";
export * from "./formats/index.js";