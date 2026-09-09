// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Simple assert helper — no external dependencies.
 * Used by tool-kind.ts for compile-time exhaustiveness checking patterns.
 */

/**
 * Type-safe assertion function.
 * Throws if the condition is false.
 */
export function assert(condition: boolean, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message ?? "Assertion failed")
  }
}

/**
 * Unreachable code marker.
 * Use in switch default cases to ensure exhaustiveness.
 */
export function unreachable(message?: string): never {
  throw new Error(message ?? "Unreachable code reached")
}
