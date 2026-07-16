// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import type { AgentRegistry } from "../orchestration/agent-registry.js";
import type { EventBus } from "../event-bus.js";
import type { AcpA2AMessage, AcpA2AResponse } from "./index.js";

export class A2AHandler {
  constructor(
    private registry: AgentRegistry,
    private eventBus: EventBus<string>,
  ) {}

  /** Handle an incoming A2A message */
  async handle(msg: AcpA2AMessage): Promise<AcpA2AResponse> {
    const { id, method, params } = msg;
    const { from, to, content } = params;

    try {
      if (method === "agent/send" || method === "agent/notify") {
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

      if (method === "agent/send/resp") {
        const delivered = await this.registry.routeMessage(from, to, content);
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