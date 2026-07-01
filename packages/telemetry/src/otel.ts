/**
 * OpenTelemetry initialization.
 *
 * Boots the OTel SDK with:
 *   - OTLP/HTTP trace exporter (endpoint configurable via OTEL_EXPORTER_OTLP_ENDPOINT)
 *   - Auto-instrumentations for http/https/express/fetch/dns/etc.
 *
 * Guarded by config.OTEL_ENABLED so tests/dev can opt out.
 *
 * Usage: import { initOtel } from "@max/telemetry"; initOtel({ serviceName, ... });
 * Call once at process start, BEFORE other imports that touch network/IO.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { context, trace, SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";
import { getLogger } from "./logger.js";

let _sdk: NodeSDK | undefined;
let _tracer: Tracer | undefined;

export interface OtelOptions {
  serviceName: string;
  serviceVersion?: string;
  otlpEndpoint?: string;
  enabled?: boolean;
}

export function initOtel(opts: OtelOptions): void {
  if (opts.enabled === false) {
    getLogger("otel").info("OTel SDK: disabled (OTEL_ENABLED=false)");
    return;
  }
  if (_sdk) return;

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: opts.serviceName,
    [ATTR_SERVICE_VERSION]: opts.serviceVersion ?? "0.1.0",
  });

  const exporter = new OTLPTraceExporter({
    url: opts.otlpEndpoint
      ? `${opts.otlpEndpoint.replace(/\/$/, "")}/v1/traces`
      : undefined,
  });

  _sdk = new NodeSDK({
    resource,
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  _sdk.start();
  _tracer = trace.getTracer(opts.serviceName, opts.serviceVersion ?? "0.1.0");

  getLogger("otel").info(
    { endpoint: opts.otlpEndpoint ?? "default" },
    "OTel SDK: started",
  );

  // Flush spans on shutdown but DO NOT call process.exit() — the host
  // application owns shutdown and may need to close DB / server first.
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      _sdk?.shutdown().catch(() => {});
    });
  }
}

/**
 * Returns the tracer. Callers should treat `undefined` as "tracing disabled".
 */
export function getTracer(): Tracer | undefined {
  return _tracer;
}

/**
 * Wrap an async function with an active span. No-op when OTel is disabled.
 *
 * The span records duration, error status, and any attributes you set.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span | undefined) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  const tracer = getTracer();
  if (!tracer) return fn(undefined);

  return tracer.startActiveSpan(name, async (span) => {
    if (attributes) {
      for (const [k, v] of Object.entries(attributes)) span.setAttribute(k, v);
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Re-export the active context for callers that need it. */
export { context, trace };
