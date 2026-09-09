// errors.ts — typed HTTP error classes for the opencode client
// 借鉴 opencode: error tags mirror packages/protocol/src/errors.ts

/**
 * Base class for any HTTP error returned by the opencode server.
 *
 * Every error carries the offending HTTP `statusCode`, the request `path`
 * (so callers can correlate with logs), and the raw response `body` (which
 * for opencode errors is typically a JSON object with a `_tag` discriminator
 * per `packages/protocol/src/errors.ts`).
 */
export class OpencodeError extends Error {
  readonly statusCode: number;
  readonly path: string;
  readonly body?: unknown;

  constructor(opts: {
    statusCode: number;
    message: string;
    path: string;
    body?: unknown;
  }) {
    super(opts.message);
    this.name = "OpencodeError";
    this.statusCode = opts.statusCode;
    this.path = opts.path;
    this.body = opts.body;
  }
}

/** HTTP 401. Mirrors `UnauthorizedError` in packages/protocol/src/errors.ts. */
export class UnauthorizedError extends OpencodeError {
  constructor(opts: { message: string; path: string; body?: unknown }) {
    super({ statusCode: 401, message: opts.message, path: opts.path, body: opts.body });
    this.name = "UnauthorizedError";
  }
}

/**
 * HTTP 404 generic not-found. Specific 404s
 * (`SessionNotFoundError`, `MessageNotFoundError`, `PermissionNotFoundError`,
 * `QuestionNotFoundError`, `ProviderNotFoundError`, `PtyNotFoundError`) all
 * collapse to this base class to keep the SDK surface narrow.
 */
export class NotFoundError extends OpencodeError {
  constructor(opts: { message: string; path: string; body?: unknown }) {
    super({ statusCode: 404, message: opts.message, path: opts.path, body: opts.body });
    this.name = "NotFoundError";
  }
}

/** HTTP 400 (or any 4xx other than 401/404/403/409). */
export class InvalidRequestError extends OpencodeError {
  constructor(opts: { message: string; path: string; statusCode?: number; body?: unknown }) {
    super({
      statusCode: opts.statusCode ?? 400,
      message: opts.message,
      path: opts.path,
      body: opts.body,
    });
    this.name = "InvalidRequestError";
  }
}

/** HTTP 503. Raised by `/compact`, `/wait`, etc. when an op is unavailable. */
export class ServiceUnavailableError extends OpencodeError {
  constructor(opts: { message: string; path: string; body?: unknown }) {
    super({ statusCode: 503, message: opts.message, path: opts.path, body: opts.body });
    this.name = "ServiceUnavailableError";
  }
}

/** Map an HTTP status + body to the most specific error class we ship.
 *
 * `body` may be:
 *   - an already-parsed object (caller ran `response.json()`),
 *   - a JSON string (we attempt to parse it before falling back),
 *   - or a non-JSON string / undefined (we synthesize a message).
 */
export function errorFromResponse(
  status: number,
  path: string,
  body: unknown,
): OpencodeError {
  // 借鉴 opencode: prefer the structured message from the JSON body if present
  let parsed: unknown = body;
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (trimmed && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = undefined;
      }
    }
  }

  const message =
    typeof parsed === "object" && parsed !== null && "message" in parsed &&
    typeof (parsed as { message: unknown }).message === "string"
      ? ((parsed as { message: string }).message)
      : `opencode HTTP ${status} on ${path}`;

  if (status === 401) return new UnauthorizedError({ message, path, body });
  if (status === 404) return new NotFoundError({ message, path, body });
  if (status === 503) return new ServiceUnavailableError({ message, path, body });
  return new InvalidRequestError({ message, path, statusCode: status, body });
}
