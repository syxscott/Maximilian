// client.ts — OpencodeHttpClient (raw fetch wrapper)
// 借鉴 opencode: header conventions and `_tag`-style error wrapping lifted from
// packages/sdk/js/src/v2/client.ts and packages/server/src/middleware/authorization.ts

import { errorFromResponse, OpencodeError } from "./errors.js";
import type { EventEnvelope, StreamEvent } from "./types.js";

export interface OpencodeHttpClientOptions {
  baseUrl: string;
  auth?: { username: string; password: string };
  /** Absolute path → x-opencode-directory header. */
  directory?: string;
  /** Workspace id → x-opencode-workspace header. */
  workspace?: string;
}

const DEFAULT_USER_AGENT = "@max/core-thin-sdk/0.1.0";

/**
 * Thin HTTP client for `opencode serve`. Handles auth, location headers,
 * JSON encoding, error parsing, and SSE streaming.
 *
 * Construct one client per `opencode serve` endpoint. The same client may be
 * shared across many logical workspaces — `directory`/`workspace` can be
 * overridden per request via `requestWith` for callers that need to span
 * multiple worktrees.
 */
export class OpencodeHttpClient {
  readonly baseUrl: string;
  readonly auth: { username: string; password: string } | undefined;
  readonly directory: string | undefined;
  readonly workspace: string | undefined;
  readonly userAgent: string;

  constructor(opts: OpencodeHttpClientOptions) {
    if (!opts.baseUrl) {
      throw new Error("OpencodeHttpClient: `baseUrl` is required");
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.auth = opts.auth;
    this.directory = opts.directory;
    this.workspace = opts.workspace;
    this.userAgent = DEFAULT_USER_AGENT;
  }

  /**
   * Internal request core. Adds auth + location headers, sets Content-Type,
   * parses the response, and throws typed errors on non-2xx.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const init: RequestInit = {
      method,
      headers: this.headers(),
      signal,
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(this.url(path), init);
    } catch (err) {
      // Network / DNS / connection-refused — not a typed server response.
      throw new OpencodeError({
        statusCode: 0,
        message: err instanceof Error ? err.message : "network error",
        path,
        body: undefined,
      });
    }

    if (!response.ok) {
      const body: unknown = await response.text().catch(() => undefined);
      throw errorFromResponse(response.status, path, body);
    }

    return this.parse<T>(response, path);
  }

  /** GET helper. */
  get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>("GET", path, undefined, signal);
  }

  /** POST helper (JSON body). */
  post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>("POST", path, body, signal);
  }

  /** DELETE helper. */
  delete<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>("DELETE", path, undefined, signal);
  }

  /**
   * Stream a `text/event-stream` endpoint. Yields each parsed envelope
   * (`{ id, type, data, ... }`). Honors the supplied `AbortSignal`.
   *
   * Used by `OpencodeSdk.streamPrompt` and `OpencodeSdk.subscribeEvents`.
   */
  async *stream<T = StreamEvent>(
    path: string,
    signal?: AbortSignal,
  ): AsyncIterable<EventEnvelope<T>> {
    const response = await this.fetchStream(path, signal);
    yield* this.parseSse<T>(response, path, signal);
  }

  /** Internal stream fetch — splits response construction from parsing so it's testable. */
  async fetchStream(path: string, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(this.url(path), {
        method: "GET",
        headers: { ...this.headers(), Accept: "text/event-stream" },
        signal,
      });
    } catch (err) {
      throw new OpencodeError({
        statusCode: 0,
        message: err instanceof Error ? err.message : "network error",
        path,
      });
    }
    if (!response.ok || !response.body) {
      // 借鉴 opencode: consume body for error context before throwing
      const body: unknown = await response.text().catch(() => undefined);
      throw errorFromResponse(response.status, path, body);
    }
    return response;
  }

  /** Build the headers map for any request. */
  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": this.userAgent,
    };
    if (this.auth) {
      // 借鉴 opencode: Basic auth per packages/server/src/middleware/authorization.ts
      const token = Buffer.from(`${this.auth.username}:${this.auth.password}`).toString(
        "base64",
      );
      h["Authorization"] = `Basic ${token}`;
    }
    if (this.directory) {
      h["x-opencode-directory"] = encodeURIComponent(this.directory);
    }
    if (this.workspace) {
      h["x-opencode-workspace"] = this.workspace;
    }
    return h;
  }

  /** Resolve a server-relative path against `baseUrl`. */
  private url(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  /** Parse a 2xx response. Handles empty-body endpoints (204) and JSON bodies. */
  private async parse<T>(response: Response, path: string): Promise<T> {
    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return undefined as T;
    }
    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // Non-JSON body — return raw text for callers that need it.
      return text as unknown as T;
    }
  }

  /**
   * Parse an SSE response body into envelopes. Tolerates:
   *   - heartbeats (`: heartbeat`)
   *   - multi-line `data:` (joined with \n)
   *   - partial frames across `reader.read()` boundaries
   */
  private async *parseSse<T>(
    response: Response,
    path: string,
    signal: AbortSignal | undefined,
  ): AsyncIterable<EventEnvelope<T>> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    const aborted = new Promise<{ done: true; value: undefined }>(() => {
      if (!signal) return;
      signal.addEventListener(
        "abort",
        () => {
          reader.cancel().catch(() => {
            /* ignore */
          });
        },
        { once: true },
      );
    });

    while (!signal?.aborted) {
      const next = await Promise.race([reader.read(), aborted]);
      if (!next || next.done) break;
      buffer += decoder.decode(next.value, { stream: true });

      let frameEnd = buffer.indexOf("\n\n");
      while (frameEnd !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const evt = this.parseSseFrame(frame, path);
        if (evt) yield evt as EventEnvelope<T>;
        frameEnd = buffer.indexOf("\n\n");
      }
    }

    // Drain any remaining buffer (best-effort).
    if (buffer.trim()) {
      const evt = this.parseSseFrame(buffer, path);
      if (evt) yield evt as EventEnvelope<T>;
    }
  }

  /** Parse a single SSE frame (one or more `event:`/`data:` lines). */
  private parseSseFrame(frame: string, path: string): EventEnvelope<unknown> | null {
    let dataLine = "";
    const lines = frame.split("\n");
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line || line.startsWith(":")) continue; // comment / heartbeat
      if (line.startsWith("data:")) {
        const after = line.slice(5);
        dataLine += (dataLine ? "\n" : "") + (after.startsWith(" ") ? after.slice(1) : after);
      }
      // Other fields (`event:`, `id:`, `retry:`) intentionally ignored —
      // the server tags payloads by the JSON `type` field.
    }
    if (!dataLine) return null;
    let payload: { type?: unknown; data?: unknown; id?: unknown; [k: string]: unknown };
    try {
      payload = JSON.parse(dataLine);
    } catch (err) {
      throw new OpencodeError({
        statusCode: 200,
        message: `malformed SSE frame on ${path}: ${err instanceof Error ? err.message : String(err)}`,
        path,
        body: dataLine,
      });
    }
    return {
      id: typeof payload.id === "string" ? payload.id : "",
      type: typeof payload.type === "string" ? payload.type : "unknown",
      data: payload.data,
      metadata: typeof payload.metadata === "object" && payload.metadata !== null
        ? (payload.metadata as Record<string, unknown>)
        : undefined,
      durable:
        typeof payload.durable === "object" && payload.durable !== null
          ? (payload.durable as { aggregateID: string; seq: number; version: number })
          : undefined,
      location: typeof payload.location === "object" && payload.location !== null
        ? (payload.location as { directory: string; workspaceID?: string })
        : undefined,
    };
  }
}
