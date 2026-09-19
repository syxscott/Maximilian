/**
 * @max/credential-lease — credential lifecycle for Maximilian's provider layer:
 * login state machine, capability-protected local token lease protocol over a
 * Unix socket, and revocation handling.
 *
 * Ported from the minimax-code repository (https://github.com/MiniMax-AI, MIT):
 *   - packages/oauth-lease-protocol/src  → contracts.ts, codec.ts, endpoints.ts,
 *     capability.ts, node-server.ts, node-client.ts
 *   - packages/oauth-core/src/auth-core.ts + fs/atomic-write.ts
 *     → auth-machine.ts, auth-state.ts, atomic-write.ts
 *   - packages/mcode-tools-host/src/lease-broker.ts → lease-broker.ts
 *
 * Zero runtime dependencies, per the source protocol's design constraint.
 */

export * from "./atomic-write.js"
export * from "./auth-machine.js"
export * from "./auth-state.js"
export * from "./capability.js"
export * from "./codec.js"
export * from "./contracts.js"
export * from "./endpoints.js"
export * from "./file-lock.js"
export * from "./lease-broker.js"
export * from "./node-client.js"
export * from "./node-server.js"
export * from "./token-provider.js"
