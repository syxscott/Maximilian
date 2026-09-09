// Barrel export — @max/llm
//
// @deprecated — This package is the legacy in-process LLM abstraction. The
// runtime now routes every agent task through `opencode serve` (see
// `@max/core-thin-sdk` and `OpencodeExecutor`). The exports here remain
// functional for tests and any consumer that hasn't migrated yet, but new
// code should target the opencode kernel via `OpencodeHttpClient` + the
// `@max/core` runtime instead. Phase 4a will remove the runtime's
// in-process paths entirely; the package itself will be deleted in a
// subsequent release once test stubs stop depending on it.

export * from "./types.js"
export * from "./options.js"
export * from "./messages.js"
export * from "./events.js"
export * from "./errors.js"
export * from "./tool.js"
export * from "./tool-kind.js"
export * from "./tool-context.js"
export * from "./tool-stream.js"
export * from "./provider.js"
export * from "./presets.js"
