/**
 * `withSpan` distributed-tracing helper for ACP / A2A (borrowed from
 * kourai-khryseai/shared/src/kourai_common/tracing.py).
 *
 * Kourai wraps every network op with `with create_span(name, ...)`. Each
 * span is attached to a parent `traceId` and an `EventBus` is used to
 * broadcast span lifecycle (`agent/a2a/span`).
 *
 * Maximilian's adaptation: a `withSpan(name, attrs, fn)` helper that:
 *   - Generates a `traceId` (or accepts one for nested spans).
 *   - Emits `agent/a2a/span` open + close events on the supplied `EventBus`.
 *   - Measures duration in `performance.now()` ms.
 *   - Captures errors and re-throws, with the error message attached as a
 *     span attribute.
 *
 * No external OpenTelemetry dependency — Maximilian already has its own
 * telemetry package; this helper is a lightweight scope-local instrumentation
 * that publishes events for the A2A mesh to observe.
 */

import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import type { EventBus } from "../event-bus.js";
import type { AcpEvent } from "./index.js";

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

export interface SpanContext {
  traceId: string;
  spanId: string;
  /** Wall-clock time the span opened (ms since epoch). */
  startMs: number;
  /** perf_hooks-relative start (for duration math). */
  startPerf: number;
  attributes: SpanAttributes;
}

export interface SpanOptions {
  /** Reuse an existing trace (for nested spans). */
  parent?: SpanContext;
  attributes?: SpanAttributes;
}

export type SpanHandler = (ctx: SpanContext) => Promise<void> | void;

/**
 * Run `fn` inside a span. The span opens, the bus gets an `agent/a2a/span`
 * event, then `fn` runs, then a close event with `durationMs`.
 *
 * On error, the bus gets a third event with `status=error` and the error
 * message, and the error is re-thrown.
 */
export async function withSpan<T>(
  name: string,
  bus: EventBus<AcpEvent> | undefined,
  opts: SpanOptions,
  fn: (ctx: SpanContext) => Promise<T>,
): Promise<T> {
  const traceId = opts.parent?.traceId ?? randomUUID();
  const spanId = randomUUID();
  const startMs = Date.now();
  const startPerf = performance.now();
  const attributes: SpanAttributes = { ...(opts.attributes ?? {}) };

  const ctx: SpanContext = {
    traceId,
    spanId,
    startMs,
    startPerf,
    attributes,
  };

  bus?.publish({
    type: "agent/a2a/span",
    payload: { name, status: "open", ...attributes },
    timestamp: startMs,
    traceId,
    spanId,
  });

  try {
    const result = await fn(ctx);
    const durationMs = performance.now() - startPerf;
    bus?.publish({
      type: "agent/a2a/span",
      payload: { name, status: "ok", durationMs, ...attributes },
      timestamp: Date.now(),
      traceId,
      spanId,
    });
    return result;
  } catch (err) {
    const durationMs = performance.now() - startPerf;
    const message = err instanceof Error ? err.message : String(err);
    bus?.publish({
      type: "agent/a2a/span",
      payload: {
        name,
        status: "error",
        durationMs,
        error: message,
        ...attributes,
      },
      timestamp: Date.now(),
      traceId,
      spanId,
    });
    throw err;
  }
}

/** Convenience: run `fn` outside any span, but yield the span attributes. */
export function makeNoopSpan(name: string): SpanContext {
  return {
    traceId: "noop",
    spanId: "noop",
    startMs: Date.now(),
    startPerf: performance.now(),
    attributes: { name },
  };
}
