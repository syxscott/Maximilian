// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Runtime interrupt mechanism (借鉴 LangGraph interrupt + AutoGPT pause).
 *
 * When `runtime.interrupt()` is called, it throws a `RuntimeInterrupt`
 * exception that can be caught by the caller's outer loop. The interrupt
 * carries a reason and optional payload so the caller can decide whether
 * and how to resume (via `runtime.resume()`).
 *
 * Usage:
 *   try {
 *     runtime.interrupt("awaiting approval", { requestId: "abc" });
 *   } catch (e) {
 *     if (isRuntimeInterrupt(e)) {
 *       const { reason, payload } = getInterruptInfo(e);
 *       // park and wait for user, then call runtime.resume(...)
 *     }
 *   }
 */

/**
 * Thrown by `runtime.interrupt()`. Carries the interrupt reason and
 * an optional opaque payload that the caller can use to resume.
 */
export class RuntimeInterrupt extends Error {
  constructor(
    /** Human-readable reason for the interrupt. */
    public readonly reason: string,
    /** Optional payload attached to the interrupt (e.g. requestId, nodeId). */
    public readonly payload?: unknown,
  ) {
    super(`interrupt: ${reason}`);
    this.name = "RuntimeInterrupt";
    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RuntimeInterrupt);
    }
  }
}

/**
 * Type guard: returns true if the given value is a RuntimeInterrupt.
 */
export function isRuntimeInterrupt(error: unknown): error is RuntimeInterrupt {
  return error instanceof RuntimeInterrupt;
}

/**
 * Extract the interrupt reason and payload from a RuntimeInterrupt.
 * Throws if the value is not a RuntimeInterrupt.
 */
export function getInterruptInfo(error: RuntimeInterrupt): {
  reason: string;
  payload?: unknown;
} {
  if (!isRuntimeInterrupt(error)) {
    throw new Error("getInterruptInfo requires a RuntimeInterrupt");
  }
  return {
    reason: error.reason,
    payload: error.payload,
  };
}
