// health.ts — single-shot /api/health probe for the opencode server.
//
// Verifies reachability of `GET {baseUrl}/api/health` (per docs/opencode-sdk-spec.md §6.1).
// Returns a structured result with latency, suitable for metrics emission.

import type { HealthResponse } from "./types.js";

/** Structured result of a single health probe attempt. */
export interface HealthResult {
  /** Whether the server responded with `{ healthy: true }`. */
  ok: boolean;
  /** Round-trip latency in milliseconds (includes retries). */
  latencyMs: number;
  /** Error message on failure; absent on success. */
  error?: string;
  /** Number of attempts actually made (1..maxAttempts). */
  attempts: number;
  /** HTTP status code returned by the server, if any. */
  statusCode?: number;
}

/** Options for {@link healthCheck}. */
export interface HealthCheckOptions {
  /** Per-request timeout in ms. Default: 5000. */
  timeoutMs?: number;
  /** Maximum number of attempts for transient failures. Default: 3. */
  maxAttempts?: number;
  /** Initial backoff between retries in ms. Default: 100. Doubles each retry. */
  initialBackoffMs?: number;
  /** Optional abort signal to cancel in-flight probes. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 100;

/** True for network errors and 5xx; false for 4xx (which indicate the server is up). */
function isTransient(err: unknown, statusCode?: number): boolean {
  if (statusCode !== undefined) return statusCode >= 500;
  // AbortError from timeout is transient (server may just be slow to bind).
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

/** Sleep for `ms`, but resolve immediately if the abort signal fires. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new DOMException("aborted", "AbortError"));
    };
    const cleanup = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Probe `GET {baseUrl}/api/health` and return a structured result.
 *
 * Retries up to `maxAttempts` times (default 3) on transient failures
 * (timeouts, network errors, 5xx) with exponential backoff. 4xx
 * responses are NOT retried — if the server is returning 401 it is up;
 * flapping auth is the caller's problem.
 */
export async function healthCheck(
  baseUrl: string,
  options: HealthCheckOptions | number = {},
): Promise<HealthResult> {
  // Allow `healthCheck(url, 1500)` shorthand for the timeout.
  const opts: HealthCheckOptions =
    typeof options === "number" ? { timeoutMs: options } : options;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let backoffMs = opts.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;

  const url = `${stripTrailingSlash(baseUrl)}/api/health`;
  const start = Date.now();
  let lastError: string | undefined;
  let lastStatusCode: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.signal?.aborted) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: "aborted",
        attempts: attempt - 1,
      };
    }

    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), timeoutMs);
    const onAbort = () => ctl.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const res = await fetch(url, {
        method: "GET",
        signal: ctl.signal,
        headers: { Accept: "application/json" },
      });
      lastStatusCode = res.status;

      if (res.ok) {
        // Body should be `{ healthy: true }`; tolerate extra fields, ignore content.
        const body = (await res.json().catch(() => ({}))) as Partial<HealthResponse>;
        const healthy = (body as { healthy?: unknown }).healthy === true;
        if (healthy) {
          return {
            ok: true,
            latencyMs: Date.now() - start,
            attempts: attempt,
            statusCode: res.status,
          };
        }
        lastError = `unexpected health body: ${JSON.stringify(body).slice(0, 200)}`;
      } else {
        lastError = `HTTP ${res.status}`;
      }
    } catch (err) {
      lastError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    } finally {
      clearTimeout(timeout);
      opts.signal?.removeEventListener("abort", onAbort);
    }

    if (attempt < maxAttempts && isTransient(lastError, lastStatusCode)) {
      try {
        await delay(backoffMs, opts.signal);
      } catch {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: "aborted",
          attempts: attempt,
        };
      }
      backoffMs *= 2;
    }
  }

  return {
    ok: false,
    latencyMs: Date.now() - start,
    error: lastError ?? "unknown error",
    attempts: maxAttempts,
    statusCode: lastStatusCode,
  };
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
