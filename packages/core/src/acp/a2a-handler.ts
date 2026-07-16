// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import type { AgentRegistry } from "../orchestration/agent-registry.js";
import type { EventBus } from "../event-bus.js";
import type { AcpA2AMessage, AcpA2AResponse } from "./index.js";

export class A2AHandler {
  constructor(
    private registry: AgentRegistry,
    private eventBus: EventBus<any>,
  ) {}

  /** Handle an incoming A2A message */
  async handle(msg: AcpA2AMessage): Promise<AcpA2AResponse> {
    const { id, method, params } = msg;
    const { from, to, content } = params;

    try {
      if (method === "agent/send") {
        const delivered = await this.registry.routeMessage(from, to, content);

        this.eventBus.publish({
          type: "agent/a2a/received",
          payload: { from, to, content },
        } as any);

        return {
          jsonrpc: "2.0",
          id,
          result: { delivered },
        };
      }

      if (method === "agent/notify") {
        // fire-and-forget: 不等待 receiver 完成
        this.registry.routeMessage(from, to, content); // 注意：不 await
        this.eventBus.publish({
          type: "agent/a2a/received",
          payload: { from, to, content },
        } as any);
        return { jsonrpc: "2.0", id, result: { delivered: true } };
      }

      if (method === "agent/send/resp") {
        const delivered = await this.registry.routeMessage(from, to, content);

        // 与 agent/send 和 agent/notify 保持一致
        this.eventBus.publish({
          type: "agent/a2a/received",
          payload: { from, to, content },
        } as any);

        return {
          jsonrpc: "2.0",
          id,
          result: { delivered },
        };
      }

      return {
        jsonrpc: "2.0",
        id,
        result: { delivered: false, error: `Unknown method: ${method}` },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        result: { delivered: false, error: String(err) },
      };
    }
  }
}
