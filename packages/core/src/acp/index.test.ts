// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import { AgentRegistry } from "../orchestration/agent-registry.js";
import { EventBus } from "../event-bus.js";
import { A2AHandler } from "./a2a-handler.js";

describe("A2A Handler", () => {
  let registry: AgentRegistry;
  let bus: EventBus<string>;
  let handler: A2AHandler;

  beforeEach(() => {
    registry = new AgentRegistry();
    bus = new EventBus<string>();
    handler = new A2AHandler(registry, bus);
  });

  it("delivers message via AgentRegistry", async () => {
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
      params: { from: "A", to: "B", content: { text: "hello" } },
    });

    expect(resp.result?.delivered).toBe(true);
    expect(received).toEqual([{ text: "hello" }]);
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
      params: { from: "A", to: "B", content: "ping" },
    });

    expect(received).toBe(true);
  });

  it("returns error for unknown method", async () => {
    registry.register({ id: "A", type: "test", status: "active" });
    registry.register({ id: "B", type: "test", status: "active" });

    const resp = await handler.handle({
      jsonrpc: "2.0",
      id: "1",
      method: "agent/unknown",
      params: { from: "A", to: "B", content: {} },
    });

    expect(resp.result?.delivered).toBe(false);
    expect(resp.result?.error).toContain("Unknown method");
  });
});