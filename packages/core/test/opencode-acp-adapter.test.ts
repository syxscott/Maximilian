// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for OpencodeAcpAdapter — ACP `agent/send` ↔ opencode SDK bridge.
 *
 * 借鉴 opencode: event shape from `docs/opencode-sdk-spec.md` §5.3 + §6.4;
 * SessionMessage schema from `packages/core-thin-sdk/src/types.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpencodeHttpClient } from "@max/core-thin-sdk";
import { EventBus } from "../src/event-bus.js";
import {
  OpencodeAcpAdapter,
  type AcpSendTranslation,
  type AcpTaskStatus,
} from "../src/opencode-acp-adapter.js";
import type {
  AcpA2AMessage,
  AcpEvent,
} from "../src/acp/index.js";

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeSendMsg(overrides: Partial<AcpA2AMessage> = {}): AcpA2AMessage {
  return {
    jsonrpc: "2.0",
    id: "req-1",
    method: "agent/send",
    params: {
      from: "agent-a",
      to: "agent-b",
      content: {
        parts: [{ kind: "text", text: "hello world" }],
      },
      taskId: "task-1",
      contextId: "ctx-1",
      messageId: "msg-1",
    },
    ...overrides,
  };
}

describe("OpencodeAcpAdapter", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: OpencodeHttpClient;
  let bus: EventBus<AcpEvent>;
  let adapter: OpencodeAcpAdapter;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    client = new OpencodeHttpClient({ baseUrl: "http://opencode.test" });
    bus = new EventBus<AcpEvent>();
    adapter = new OpencodeAcpAdapter({ client, eventBus: bus });
  });
  afterEach(() => vi.restoreAllMocks());

  // ── translateSend ──────────────────────────────────────────────────

  it("translateSend converts an agent/send message to SDK parts", () => {
    const msg = makeSendMsg();
    const translation = adapter.translateSend(msg);

    expect(translation.agent).toBe("agent-b");
    expect(translation.title).toBe("acp-task-1");
    expect(translation.contextId).toBe("ctx-1");
    expect(translation.messageId).toBe("msg-1");
    expect(translation.textParts).toEqual([{ type: "text", text: "hello world" }]);
    expect(translation.fileParts).toEqual([]);
  });

  it("translateSend lifts file-like data parts and folds other data into text", () => {
    const msg = makeSendMsg({
      params: {
        from: "a",
        to: "b",
        content: {
          parts: [
            {
              kind: "data",
              mimeType: "application/json",
              value: {
                uri: "file:///report.pdf",
                mime: "application/pdf",
                name: "report.pdf",
              },
            },
            {
              kind: "data",
              mimeType: "application/json",
              value: { foo: "bar" },
            },
          ],
        },
        taskId: "task-2",
      },
    });
    const translation = adapter.translateSend(msg);

    expect(translation.fileParts).toEqual([
      {
        type: "file",
        mime: "application/pdf",
        url: "file:///report.pdf",
        filename: "report.pdf",
      },
    ]);
    expect(translation.textParts).toEqual([
      { type: "text", text: `[data] {"foo":"bar"}` },
    ]);
  });

  it("translateSend rejects non agent/send messages", () => {
    expect(() => adapter.translateSend({ ...makeSendMsg(), method: "agent/notify" })).toThrow(
      /agent\/send/,
    );
  });

  it("translateSend rejects empty parts", () => {
    const msg = makeSendMsg();
    msg.params.content.parts = [];
    expect(() => adapter.translateSend(msg)).toThrow(/parts/);
  });

  // ── runSend (dry run) ───────────────────────────────────────────────

  it("runSend in dry-run mode never touches fetch and tracks task/session bindings", async () => {
    const dryAdapter = new OpencodeAcpAdapter({ client, eventBus: bus, dryRun: true });
    const msg = makeSendMsg();

    const result = await dryAdapter.runSend(msg);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.sessionID).toMatch(/^ses_dry_task-1$/);
    expect(result.response.result?.delivered).toBe(true);
    expect(result.response.result?.status).toBe("submitted");
    expect(dryAdapter.bindings()).toEqual([{ taskId: "task-1", sessionID: result.sessionID }]);
  });

  it("runSend in dry-run emits a submitted task.status event", async () => {
    const dryAdapter = new OpencodeAcpAdapter({ client, eventBus: bus, dryRun: true });
    const events: AcpEvent[] = [];
    bus.subscribe((e) => events.push(e));

    await dryAdapter.runSend(makeSendMsg());

    const status = events.find((e) => e.type === "agent/status");
    expect(status).toBeDefined();
    const payload = status?.payload as AcpTaskStatus;
    expect(payload.state).toBe("submitted");
    expect(payload.taskId).toBe("task-1");
  });

  // ── runSend (live, mocked) ──────────────────────────────────────────

  it("runSend creates a session, sends the prompt, and reports completed status", async () => {
    let created = false;
    let prompted = false;
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "");
      const method = init?.method ?? "GET";
      if (path === "/api/session" && method === "POST" && !created) {
        created = true;
        return makeJsonResponse({
          data: {
            id: "ses_live",
            title: "acp-task-1",
            projectID: "p",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 1 },
          },
        });
      }
      if (path === "/api/session/ses_live/prompt" && method === "POST" && !prompted) {
        prompted = true;
        return makeJsonResponse({ data: null });
      }
      if (path === "/api/session/ses_live/wait" && method === "POST") {
        return new Response(null, { status: 204 });
      }
      if (path === "/api/session/ses_live/message" && method === "GET") {
        return makeJsonResponse({
          data: [
            {
              id: "msg_1",
              role: "assistant",
              sessionID: "ses_live",
              parentID: "msg_0",
              agent: "agent-b",
              model: { id: "m", providerID: "anthropic" },
              parts: [{ id: "p1", messageID: "msg_1", sessionID: "ses_live", type: "text", text: "all done" }],
              cost: 0,
              tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: 1, completed: 2 },
            },
          ],
        });
      }
      return makeJsonResponse({ data: null }, 404);
    });

    const liveAdapter = new OpencodeAcpAdapter({ client, eventBus: bus });
    const events: AcpEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const result = await liveAdapter.runSend(makeSendMsg());

    expect(result.sessionID).toBe("ses_live");
    expect(result.assistant).toBeDefined();
    expect(result.response.result?.status).toBe("completed");

    const statusEvents = events.filter((e) => e.type === "agent/status");
    expect(statusEvents.map((e) => (e.payload as AcpTaskStatus).state)).toEqual([
      "working",
      "completed",
    ]);

    expect(liveAdapter.latestStateFor("ses_live")).toBe("completed");
    expect(liveAdapter.bindings()).toEqual([{ taskId: "task-1", sessionID: "ses_live" }]);
  });

  it("runSend reports failure when sendPrompt throws", async () => {
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "");
      const method = init?.method ?? "GET";
      if (path === "/api/session" && method === "POST") {
        return makeJsonResponse({
          data: {
            id: "ses_err",
            title: "t",
            projectID: "p",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 1 },
          },
        });
      }
      if (path === "/api/session/ses_err/prompt" && method === "POST") {
        return makeJsonResponse({ message: "bad request" }, 400);
      }
      return makeJsonResponse({}, 500);
    });

    const liveAdapter = new OpencodeAcpAdapter({ client, eventBus: bus });
    const events: AcpEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const result = await liveAdapter.runSend(makeSendMsg());

    expect(result.response.result?.delivered).toBe(false);
    expect(result.response.result?.status).toBe("failed");
    expect(liveAdapter.latestStateFor("ses_err")).toBe("failed");

    const failed = events
      .filter((e) => e.type === "agent/status")
      .map((e) => (e.payload as AcpTaskStatus).state);
    expect(failed).toContain("failed");
  });

  it("runSend reuses an existing session for repeated sends with the same taskId", async () => {
    let sessionCreateCount = 0;
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "");
      const method = init?.method ?? "GET";
      if (path === "/api/session" && method === "POST") {
        sessionCreateCount++;
        return makeJsonResponse({
          data: {
            id: `ses_${sessionCreateCount}`,
            title: "t",
            projectID: "p",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 1 },
          },
        });
      }
      if (path.startsWith("/api/session/ses_") && path.endsWith("/prompt") && method === "POST") {
        return makeJsonResponse({ data: null });
      }
      if (path.startsWith("/api/session/ses_") && path.endsWith("/wait") && method === "POST") {
        return new Response(null, { status: 204 });
      }
      if (path.startsWith("/api/session/ses_") && path.endsWith("/message") && method === "GET") {
        return makeJsonResponse({
          data: [
            {
              id: "m",
              role: "assistant",
              sessionID: path.split("/")[3],
              parentID: "0",
              agent: "a",
              model: { id: "m", providerID: "p" },
              parts: [{ id: "p", messageID: "m", sessionID: "x", type: "text", text: "ok" }],
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: 1, completed: 2 },
            },
          ],
        });
      }
      return makeJsonResponse({}, 404);
    });

    const liveAdapter = new OpencodeAcpAdapter({ client, eventBus: bus });
    const msg = makeSendMsg();
    const r1 = await liveAdapter.runSend(msg);
    const r2 = await liveAdapter.runSend({ ...msg, params: { ...msg.params, messageId: "msg-2" } });

    expect(r1.sessionID).toBe("ses_1");
    expect(r2.sessionID).toBe("ses_1");
    expect(sessionCreateCount).toBe(1);
  });

  // ── mapSessionStatus ────────────────────────────────────────────────

  it("mapSessionStatus returns null for unknown events without sessionID", () => {
    expect(adapter.mapSessionStatus({ type: "session.idle" })).toBeNull();
    expect(adapter.mapSessionStatus({ type: "something.else" })).toBeNull();
  });

  it("mapSessionStatus maps session.idle / session.status to completed state", () => {
    // Pre-bind a taskId so the adapter can resolve it from sessionID.
    const sess = "ses_xyz";
    (adapter as unknown as { sessionTaskMap: Map<string, string> }).sessionTaskMap.set(
      sess,
      "task-xyz",
    );

    const idle = adapter.mapSessionStatus({
      type: "session.idle",
      sessionID: sess,
      data: { sessionID: sess },
      timestamp: 1234,
    });
    expect(idle?.state).toBe("completed");
    expect(idle?.taskId).toBe("task-xyz");
    expect(idle?.timestamp).toBe(1234);

    const status = adapter.mapSessionStatus({
      type: "session.status",
      sessionID: sess,
      data: { sessionID: sess, status: { type: "idle", message: "all good" } },
      timestamp: 5678,
    });
    expect(status?.state).toBe("completed");
    expect(status?.message).toBe("all good");
  });

  it("mapSessionStatus maps session.error to failed state", () => {
    const sess = "ses_err";
    (adapter as unknown as { sessionTaskMap: Map<string, string> }).sessionTaskMap.set(
      sess,
      "task-err",
    );

    const out = adapter.mapSessionStatus({
      type: "session.error",
      sessionID: sess,
      data: {
        sessionID: sess,
        error: { type: "provider_error", message: "LLM down" },
      },
    });

    expect(out?.state).toBe("failed");
    expect(out?.message).toBe("LLM down");
    expect(out?.taskId).toBe("task-err");
  });

  it("mapSessionStatus handles session.updated / session.created gracefully", () => {
    const sess = "ses_upd";
    (adapter as unknown as { sessionTaskMap: Map<string, string> }).sessionTaskMap.set(
      sess,
      "task-upd",
    );
    adapter.latestStateFor(sess); // noop
    (adapter as unknown as { latestState: Map<string, string> }).latestState.set(
      sess,
      "working",
    );

    const out = adapter.mapSessionStatus({
      type: "session.updated",
      sessionID: sess,
      data: { sessionID: sess, info: { id: sess } },
    });

    expect(out?.state).toBe("working");
    expect(out?.message).toBe("session updated");
  });

  it("mapMessagesToStatuses emits one completed status per assistant message", () => {
    const sess = "ses_msg";
    (adapter as unknown as { sessionTaskMap: Map<string, string> }).sessionTaskMap.set(
      sess,
      "task-msg",
    );

    const messages = [
      {
        id: "m1",
        sessionID: sess,
        role: "user" as const,
        parts: [{ type: "text" as const, text: "hi" }],
        time: { created: 1 },
      },
      {
        id: "m2",
        sessionID: sess,
        role: "assistant" as const,
        parentID: "m1",
        agent: "a",
        model: { id: "m", providerID: "p" },
        parts: [{ id: "p", messageID: "m2", sessionID: sess, type: "text" as const, text: "hi back" }],
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 2, completed: 3 },
      },
    ];

    const out = adapter.mapMessagesToStatuses(sess, messages);
    expect(out).toHaveLength(1);
    expect(out[0]?.state).toBe("completed");
    expect(out[0]?.message).toBe("hi back");
    expect(out[0]?.taskId).toBe("task-msg");
    expect(adapter.latestStateFor(sess)).toBe("completed");
  });

  // ── introspection / lifecycle ───────────────────────────────────────

  it("reset clears all bindings", () => {
    const dryAdapter = new OpencodeAcpAdapter({ client, eventBus: bus, dryRun: true });
    return dryAdapter.runSend(makeSendMsg()).then(() => {
      expect(dryAdapter.bindings()).toHaveLength(1);
      dryAdapter.reset();
      expect(dryAdapter.bindings()).toHaveLength(0);
      expect(dryAdapter.latestStateFor("anything")).toBeUndefined();
    });
  });

  it("requires a client at construction", () => {
    expect(() => new OpencodeAcpAdapter({ client: undefined as unknown as OpencodeHttpClient })).toThrow(
      /client/,
    );
  });

  it("preserves translation shape for snapshot-style consumers", () => {
    const translation: AcpSendTranslation = adapter.translateSend(makeSendMsg());
    // Frozen-style structural checks — no internal state should leak.
    expect(Object.keys(translation).sort()).toEqual(
      [
        "agent",
        "contextId",
        "fileParts",
        "messageId",
        "textParts",
        "title",
      ].sort(),
    );
    expect(translation.textParts).toHaveLength(1);
    expect(translation.fileParts).toHaveLength(0);
  });
});