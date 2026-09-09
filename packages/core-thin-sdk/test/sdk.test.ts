/**
 * Tests for the SDK surface in `./src/sdk.ts`.
 *
 * Each SDK function is exercised via a mocked `OpencodeHttpClient` that
 * captures the (method, path, body) tuple passed to `get` / `post` / `delete`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { OpencodeHttpClient } from "../src/client.js";
import * as Sdk from "../src/sdk.js";
import type { Session } from "../src/types.js";

interface Captured {
  method: string;
  path: string;
  body: unknown;
}

interface SdkMock {
  client: OpencodeHttpClient;
  captured: Captured[];
  /** Install a stub JSON response for the next matching call. */
  reply(body: unknown, status?: number): void;
  /** Install an error response for the next matching call. */
  failWith(status: number, body?: unknown): void;
  /** Run with all stubs cleared (useful between tests). */
  reset(): void;
}

function makeSdkMock(): SdkMock {
  const captured: Captured[] = [];
  const responses: Array<{ body?: unknown; status?: number; fail?: boolean }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn((url, init) => {
    const u = typeof url === "string" ? url : url.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = undefined;
    if (init?.body) {
      try {
        body = JSON.parse(init.body as string);
      } catch {
        body = init.body;
      }
    }
    captured.push({ method, path: u.replace(/^https?:\/\/[^/]+/, ""), body });

    const next = responses.shift();
    if (!next) {
      return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (next.fail || (next.status !== undefined && next.status >= 400)) {
      const status = next.status ?? 500;
      const payload = next.body ?? { message: "fail" };
      return Promise.resolve(
        new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    const payload = next.body ?? {};
    const status = next.status ?? 200;
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    // Node's Response constructor rejects status codes like 204/205/304 when
    // given a body string — pass `null` for those.
    const respInit: ResponseInit = {
      status,
      headers: { "Content-Type": "application/json" },
    };
    return Promise.resolve(
      status === 204 ? new Response(null, respInit) : new Response(text, respInit),
    );
  }) as unknown as typeof fetch;

  const client = new OpencodeHttpClient({ baseUrl: "http://api.test" });

  return {
    client,
    captured,
    reply(body, status) {
      responses.push({ body, status });
    },
    failWith(status, body) {
      responses.push({ status, body, fail: true });
    },
    reset() {
      responses.length = 0;
      captured.length = 0;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

const sampleSession: Session = {
  id: "ses_x",
  title: "t",
  projectID: "p",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
  parentID: undefined,
  agent: undefined,
  model: undefined,
  location: undefined,
  subpath: undefined,
  revert: undefined,
};

describe("SDK — health", () => {
  it("calls GET /api/health", async () => {
    const m = makeSdkMock();
    m.reply({ healthy: true });
    const res = await Sdk.health(m.client);
    expect(m.captured[0]).toEqual({ method: "GET", path: "/api/health", body: undefined });
    expect(res).toEqual({ healthy: true });
  });
});

describe("SDK — session CRUD", () => {
  it("createSession → POST /api/session with parentID/title/agent/model", async () => {
    const m = makeSdkMock();
    m.reply({ data: sampleSession });
    const out = await Sdk.createSession(m.client, {
      parentID: "ses_p",
      title: "Sub-task",
      agent: "build",
      model: { id: "m1", providerID: "anthropic" },
    });
    expect(m.captured[0].method).toBe("POST");
    expect(m.captured[0].path).toBe("/api/session");
    expect(m.captured[0].body).toEqual({
      parentID: "ses_p",
      title: "Sub-task",
      agent: "build",
      model: { id: "m1", providerID: "anthropic" },
    });
    expect(out.id).toBe("ses_x");
  });

  it("createSession without opts → POST /api/session with empty body", async () => {
    const m = makeSdkMock();
    m.reply({ data: sampleSession });
    await Sdk.createSession(m.client);
    expect(m.captured[0].body).toEqual({});
  });

  it("getSession → GET /api/session/{id} and unwraps {data}", async () => {
    const m = makeSdkMock();
    m.reply({ data: sampleSession });
    const out = await Sdk.getSession(m.client, "ses_x");
    expect(m.captured[0]).toEqual({ method: "GET", path: "/api/session/ses_x", body: undefined });
    expect(out.id).toBe("ses_x");
  });

  it("listSessions → GET /api/session", async () => {
    const m = makeSdkMock();
    m.reply({ data: [sampleSession] });
    const list = await Sdk.listSessions(m.client);
    expect(m.captured[0].path).toBe("/api/session");
    expect(Array.isArray(list)).toBe(true);
    expect(list[0]!.id).toBe("ses_x");
  });

  it("listSessions tolerates a bare array response", async () => {
    const m = makeSdkMock();
    m.reply([sampleSession]);
    const list = await Sdk.listSessions(m.client);
    expect(list).toHaveLength(1);
  });

  it("deleteSession → DELETE /api/session/{id}", async () => {
    const m = makeSdkMock();
    m.reply({}, 204);
    await Sdk.deleteSession(m.client, "ses_x");
    expect(m.captured[0]).toEqual({ method: "DELETE", path: "/api/session/ses_x", body: undefined });
  });
});

describe("SDK — session ops", () => {
  it("compactSession → POST /api/session/{id}/compact", async () => {
    const m = makeSdkMock();
    m.reply({}, 204);
    await Sdk.compactSession(m.client, "ses_x");
    expect(m.captured[0]).toEqual({ method: "POST", path: "/api/session/ses_x/compact", body: {} });
  });

  it("abortSession → POST /api/session/{id}/abort", async () => {
    const m = makeSdkMock();
    m.reply({}, 204);
    await Sdk.abortSession(m.client, "ses_x");
    expect(m.captured[0]).toEqual({ method: "POST", path: "/api/session/ses_x/abort", body: {} });
  });

  it("revertMessage → POST /api/session/{id}/revert with {messageID}", async () => {
    const m = makeSdkMock();
    m.reply({}, 204);
    await Sdk.revertMessage(m.client, "ses_x", "msg_y");
    expect(m.captured[0]).toEqual({
      method: "POST",
      path: "/api/session/ses_x/revert",
      body: { messageID: "msg_y" },
    });
  });

  it("waitSession → POST /api/session/{id}/wait", async () => {
    const m = makeSdkMock();
    m.reply({}, 204);
    await Sdk.waitSession(m.client, "ses_x");
    expect(m.captured[0].path).toBe("/api/session/ses_x/wait");
  });
});

describe("SDK — sendPrompt", () => {
  it("translates parts into the v2 prompt shape", async () => {
    const m = makeSdkMock();
    // First call: POST /prompt, Second call: POST /wait, Third call: GET /message
    m.reply({}); // prompt
    m.reply({}, 204); // wait
    m.reply({ data: [] }); // listMessages

    await Sdk.sendPrompt(m.client, "ses_x", {
      parts: [{ type: "text", text: "Hello" }],
    });
    const promptCall = m.captured[0];
    expect(promptCall.path).toBe("/api/session/ses_x/prompt");
    expect(promptCall.body).toEqual({ prompt: { text: "Hello" } });
  });

  it("aggregates file + agent parts into the v2 prompt shape", async () => {
    const m = makeSdkMock();
    m.reply({});
    m.reply({}, 204);
    m.reply({ data: [] });

    await Sdk.sendPrompt(m.client, "ses_x", {
      parts: [
        { type: "text", text: "Refactor foo" },
        { type: "file", mime: "image/png", url: "data:image/png;base64,xxx", filename: "f.png" },
        { type: "agent", name: "code-reviewer" },
      ],
    });

    const body = m.captured[0].body as { prompt: { text: string; files?: unknown[]; agents?: unknown[] } };
    expect(body.prompt.text).toBe("Refactor foo");
    expect(body.prompt.files).toEqual([
      { uri: "data:image/png;base64,xxx", mime: "image/png", name: "f.png" },
    ]);
    expect(body.prompt.agents).toEqual([{ name: "code-reviewer" }]);
  });

  it("forwards delivery + id + model opts", async () => {
    const m = makeSdkMock();
    m.reply({});
    m.reply({}, 204);
    m.reply({ data: [] });

    await Sdk.sendPrompt(m.client, "ses_x", {
      parts: [{ type: "text", text: "hi" }],
      id: "msg_1",
      delivery: "steer",
      resume: false,
      model: { providerID: "anthropic", modelID: "claude-3" },
    });
    const body = m.captured[0].body as Record<string, unknown>;
    expect(body.id).toBe("msg_1");
    expect(body.delivery).toBe("steer");
    expect(body.resume).toBe(false);
    expect(body.model).toEqual({ id: "claude-3", providerID: "anthropic" });
  });
});

describe("SDK — listMessages", () => {
  it("GET /api/session/{id}/message returns messages", async () => {
    const m = makeSdkMock();
    m.reply({ data: [sampleSession] });
    const messages = await Sdk.listMessages(m.client, "ses_x");
    expect(m.captured[0].path).toBe("/api/session/ses_x/message");
    expect(Array.isArray(messages)).toBe(true);
  });
});
