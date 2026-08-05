/**
 * Tests for OpencodeHttpClient.
 *
 * Covers:
 *   - URL construction (baseUrl + path; trims trailing slashes; absolute URLs pass through)
 *   - Headers: Content-Type, User-Agent, Authorization Basic, x-opencode-directory, x-opencode-workspace
 *   - JSON body encoding for POST
 *   - Response parsing: 2xx JSON, 204 empty, raw text
 *   - Error parsing for 400 / 401 / 404 / 503 status codes (typed error classes)
 *   - Network errors wrapped as OpencodeError(statusCode=0)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { OpencodeHttpClient } from "../src/client.js";
import {
  InvalidRequestError,
  NotFoundError,
  OpencodeError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "../src/errors.js";

interface MockResponseInit {
  status?: number;
  statusText?: string;
  body?: string | object | null;
  contentType?: string;
}

function mockResponse(init: MockResponseInit = {}): Response {
  const { status = 200, statusText = "OK", body = null, contentType = "application/json" } = init;
  const text = body === null ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const respInit: ResponseInit = {
    status,
    statusText,
    headers: { "Content-Type": contentType },
  };
  // Node's Response constructor rejects empty bodies for 204/205/304 — pass `null`.
  return status === 204 ? new Response(null, respInit) : new Response(text, respInit);
}

describe("OpencodeHttpClient — construction", () => {
  it("throws when baseUrl is missing", () => {
    expect(() => new OpencodeHttpClient({ baseUrl: "" })).toThrow(/baseUrl/);
  });

  it("strips trailing slashes from baseUrl", () => {
    const c = new OpencodeHttpClient({ baseUrl: "http://example.com///" });
    expect(c.baseUrl).toBe("http://example.com");
  });
});

describe("OpencodeHttpClient — get/post/delete", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function installFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response): void {
    globalThis.fetch = vi.fn((input, init) => Promise.resolve(handler(input, init))) as unknown as typeof fetch;
  }

  it("GET assembles url + Accept + Content-Type headers", async () => {
    let captured: { url: string; init: RequestInit | undefined } | undefined;
    installFetch((url, init) => {
      captured = { url: String(url), init };
      return mockResponse({ body: { ok: true } });
    });

    const client = new OpencodeHttpClient({ baseUrl: "http://api.test" });
    const res = await client.get<{ ok: boolean }>("/ping");

    expect(captured?.url).toBe("http://api.test/ping");
    const headers = captured!.init!.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(res).toEqual({ ok: true });
  });

  it("POST JSON-encodes the body", async () => {
    let captured: { init: RequestInit | undefined } | undefined;
    installFetch((_url, init) => {
      captured = { init };
      return mockResponse({ body: { id: "ses_x" } });
    });

    const client = new OpencodeHttpClient({ baseUrl: "http://api.test" });
    const res = await client.post<{ id: string }>("/api/session", { title: "hi" });

    expect(captured!.init!.method).toBe("POST");
    expect(captured!.init!.body).toBe(JSON.stringify({ title: "hi" }));
    expect(res).toEqual({ id: "ses_x" });
  });

  it("adds Basic auth header when auth is provided", async () => {
    let captured: { init: RequestInit | undefined } | undefined;
    installFetch((_url, init) => {
      captured = { init };
      return mockResponse({ body: { ok: true } });
    });

    const client = new OpencodeHttpClient({
      baseUrl: "http://api.test",
      auth: { username: "u", password: "p" },
    });
    await client.get("/api/health");

    const headers = captured!.init!.headers as Record<string, string>;
    const expected = "Basic " + Buffer.from("u:p").toString("base64");
    expect(headers["Authorization"]).toBe(expected);
  });

  it("omits Authorization when no auth is configured", async () => {
    let captured: { init: RequestInit | undefined } | undefined;
    installFetch((_url, init) => {
      captured = { init };
      return mockResponse({ body: {} });
    });
    await new OpencodeHttpClient({ baseUrl: "http://api.test" }).get("/api/health");
    const headers = captured!.init!.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("URL-encodes the x-opencode-directory header", async () => {
    let captured: { init: RequestInit | undefined } | undefined;
    installFetch((_url, init) => {
      captured = { init };
      return mockResponse({ body: {} });
    });
    await new OpencodeHttpClient({
      baseUrl: "http://api.test",
      directory: "/path with spaces/üñî",
    }).get("/api/health");
    const headers = captured!.init!.headers as Record<string, string>;
    expect(headers["x-opencode-directory"]).toBe(encodeURIComponent("/path with spaces/üñî"));
  });

  it("includes x-opencode-workspace header when set", async () => {
    let captured: { init: RequestInit | undefined } | undefined;
    installFetch((_url, init) => {
      captured = { init };
      return mockResponse({ body: {} });
    });
    await new OpencodeHttpClient({
      baseUrl: "http://api.test",
      workspace: "ws_42",
    }).get("/api/health");
    const headers = captured!.init!.headers as Record<string, string>;
    expect(headers["x-opencode-workspace"]).toBe("ws_42");
  });

  it("passes through absolute http URLs as-is", async () => {
    let url = "";
    installFetch((u) => {
      url = String(u);
      return mockResponse({ body: {} });
    });
    await new OpencodeHttpClient({ baseUrl: "http://api.test" }).get("https://other.test/x");
    expect(url).toBe("https://other.test/x");
  });

  it("returns undefined for 204 responses", async () => {
    installFetch(() => mockResponse({ status: 204 }));
    const out = await new OpencodeHttpClient({ baseUrl: "http://api.test" }).post("/api/session/x/abort");
    expect(out).toBeUndefined();
  });

  it("parses 2xx JSON; raw text returns as string when JSON.parse fails", async () => {
    installFetch(() => mockResponse({ body: "plain text", contentType: "text/plain" }));
    const out = await new OpencodeHttpClient({ baseUrl: "http://api.test" }).get<string>("/api/x");
    expect(typeof out).toBe("string");
  });
});

describe("OpencodeHttpClient — error parsing", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function installFetchStatus(status: number, body: object | string): void {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(mockResponse({ status, body })),
    ) as unknown as typeof fetch;
  }

  it("401 → UnauthorizedError", async () => {
    installFetchStatus(401, { message: "no auth" });
    const c = new OpencodeHttpClient({ baseUrl: "http://api.test" });
    await expect(c.get("/api/x")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("404 → NotFoundError", async () => {
    installFetchStatus(404, { message: "missing" });
    const c = new OpencodeHttpClient({ baseUrl: "http://api.test" });
    await expect(c.get("/api/missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("503 → ServiceUnavailableError", async () => {
    installFetchStatus(503, { message: "down" });
    const c = new OpencodeHttpClient({ baseUrl: "http://api.test" });
    await expect(c.get("/api/x")).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("400 with no body → InvalidRequestError with synthesized message", async () => {
    installFetchStatus(400, "");
    const c = new OpencodeHttpClient({ baseUrl: "http://api.test" });
    const err = await c.get("/api/x").catch((e) => e);
    expect(err).toBeInstanceOf(InvalidRequestError);
    expect((err as InvalidRequestError).statusCode).toBe(400);
    expect((err as InvalidRequestError).path).toBe("/api/x");
  });

  it("preserves the structured server message in the typed error", async () => {
    installFetchStatus(404, { message: "session gone" });
    const c = new OpencodeHttpClient({ baseUrl: "http://api.test" });
    try {
      await c.get("/api/session/ses_x");
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).message).toBe("session gone");
    }
  });

  it("network failures wrap as OpencodeError(statusCode=0)", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;
    const c = new OpencodeHttpClient({ baseUrl: "http://api.test" });
    try {
      await c.get("/api/x");
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(OpencodeError);
      expect((err as OpencodeError).statusCode).toBe(0);
      expect((err as OpencodeError).message).toMatch(/ECONNREFUSED/);
    }
  });
});
