// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import { AgentRegistry } from "../orchestration/agent-registry.js";
import { EventBus } from "../event-bus.js";
import { A2AHandler } from "./a2a-handler.js";
import type { AcpA2AMessage, AcpA2AMessageType, AcpA2AResponse } from "./index.js";

describe("A2A Handler", () => {
  let registry: AgentRegistry;
  let bus: EventBus<{ type: string }>;
  let handler: A2AHandler;

  beforeEach(() => {
    registry = new AgentRegistry();
    bus = new EventBus<{ type: string }>();
    handler = new A2AHandler(registry, bus as EventBus<any>, { trustedSenders: ["A"] });
  });

  it("delivers message via AgentRegistry", async () => {
    const received: unknown[] = [];
    registry.register({ id: "A", type: "test", status: "active" });
    registry.register({
      id: "B", type: "test", status: "active",
      receiver: async (_from, payload) => { received.push(payload); }
    });

    const resp: AcpA2AResponse = await handler.handle({
      jsonrpc: "2.0",
      id: "1",
      method: "agent/send",
      params: { from: "A", to: "B", content: { parts: [{ kind: "text", text: "hello" }] } },
    });

    expect(resp.result?.delivered).toBe(true);
    expect(received.length).toBe(1);
    expect((received[0] as { parts: unknown[] }).parts).toEqual([{ kind: "text", text: "hello" }]);
  });

  it("fires a2a/received event on bus", async () => {
    let received = false;
    bus.subscribe(
      () => { received = true; },
      { types: ["agent/a2a/received"] }
    );

    registry.register({ id: "A", type: "test", status: "active" });
    registry.register({ id: "B", type: "test", status: "active" });

    await handler.handle({
      jsonrpc: "2.0",
      id: "1",
      method: "agent/notify",
      params: { from: "A", to: "B", content: { parts: [{ kind: "text", text: "ping" }] } },
    });

    expect(received).toBe(true);
  });

  it("returns error for unknown method", async () => {
    registry.register({ id: "A", type: "test", status: "active" });
    registry.register({ id: "B", type: "test", status: "active" });

    const resp = await handler.handle({
      jsonrpc: "2.0",
      id: "1",
      method: "agent/unknown" as AcpA2AMessageType,
      params: { from: "A", to: "B", content: { parts: [] } },
    });

    expect(resp.error?.message).toContain("Unknown method");
  });

  it("quick-classifies noop content and skips routing", async () => {
    const received: unknown[] = [];
    registry.register({ id: "A", type: "test", status: "active" });
    registry.register({
      id: "B", type: "test", status: "active",
      receiver: async (_from, payload) => { received.push(payload); }
    });

    const resp = await handler.handle({
      jsonrpc: "2.0",
      id: "1",
      method: "agent/send",
      params: { from: "A", to: "B", content: { parts: [{ kind: "text", text: "ok" }] } },
    });

    expect(resp.result?.classified).toBe("noop");
    expect(received).toHaveLength(0);
  });

  it("returns card for agent/card method", async () => {
    registry.register({ id: "A", type: "worker", status: "active" });
    registry.register({ id: "B", type: "worker", status: "active" });

    const resp = await handler.handle({
      jsonrpc: "2.0",
      id: "1",
      method: "agent/card",
      params: { from: "A", to: "B", content: { parts: [] } },
    });

    expect(resp.result?.delivered).toBe(true);
    expect(resp.result?.card).toBeDefined();
    expect(resp.result?.card?.protocolVersion).toBe("0.3.0");
  });

  it("returns agents for agent/list method", async () => {
    registry.register({ id: "A", type: "worker", status: "active" });
    registry.register({ id: "B", type: "worker", status: "active" });
    registry.register({ id: "C", type: "planner", status: "active" });

    const resp = await handler.handle({
      jsonrpc: "2.0",
      id: "1",
      method: "agent/list",
      params: { from: "A", to: "worker", content: { parts: [] } },
    });

    expect(resp.result?.delivered).toBe(true);
    expect(resp.result?.agents?.length).toBe(2);
  });

  it("returns input-required for agent/clarify", async () => {
    registry.register({ id: "A", type: "test", status: "active" });
    registry.register({ id: "B", type: "test", status: "active" });

    const resp = await handler.handle({
      jsonrpc: "2.0",
      id: "1",
      method: "agent/clarify",
      params: { from: "A", to: "B", content: { parts: [{ kind: "text", text: "need more info" }] } },
    });

    expect(resp.result?.status).toBe("input-required");
    expect(resp.result?.awaiting).toBe("user-response");
  });
});
