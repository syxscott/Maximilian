/**
 * Tests for AgentRegistry — message routing and receiver delivery.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { AgentRegistry } from "./agent-registry.js";

describe("AgentRegistry", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  describe("register / unregister / get / list", () => {
    it("registers and retrieves an agent", () => {
      registry.register({ id: "a1", type: "test", status: "active" });
      expect(registry.get("a1")?.id).toBe("a1");
    });

    it("throws on duplicate id", () => {
      registry.register({ id: "a1", type: "test" });
      expect(() => registry.register({ id: "a1", type: "test" })).toThrow();
    });

    it("unregisters an agent", () => {
      registry.register({ id: "a1", type: "test" });
      expect(registry.unregister("a1")).toBe(true);
      expect(registry.get("a1")).toBeUndefined();
    });

    it("list() returns all agents", () => {
      registry.register({ id: "a1", type: "t1" });
      registry.register({ id: "a2", type: "t2" });
      expect(registry.list()).toHaveLength(2);
    });

    it("listByType returns agents of a type", () => {
      registry.register({ id: "a1", type: "t1" });
      registry.register({ id: "a2", type: "t2" });
      registry.register({ id: "a3", type: "t1" });
      expect(registry.listByType("t1")).toHaveLength(2);
    });
  });

  describe("routeMessage", () => {
    it("routeMessage delivers payload to recipient receiver", async () => {
      const received: unknown[] = [];
      registry.register({ id: "A", type: "test", status: "active" });
      registry.register({
        id: "B", type: "test", status: "active",
        receiver: async (from, payload) => { received.push({ from, payload }); }
      });

      const ok = await registry.routeMessage("A", "B", { msg: "hello" });
      expect(ok).toBe(true);
      expect(received).toEqual([{ from: "A", payload: { msg: "hello" } }]);
    });

    it("routeMessage returns true even when recipient has no receiver", async () => {
      registry.register({ id: "A", type: "test", status: "active" });
      registry.register({ id: "B", type: "test", status: "active" }); // 无 receiver
      const ok = await registry.routeMessage("A", "B", { msg: "hello" });
      expect(ok).toBe(true); // 历史仍写入，但无投递
    });

    it("routeMessage returns false when recipient receiver throws", async () => {
      registry.register({ id: "A", type: "test", status: "active" });
      registry.register({
        id: "B", type: "test", status: "active",
        receiver: async () => { throw new Error("delivery failed"); }
      });
      const ok = await registry.routeMessage("A", "B", { msg: "hello" });
      expect(ok).toBe(false);
    });

    it("routeMessage returns false when sender not registered", async () => {
      registry.register({ id: "B", type: "test", status: "active" });
      const ok = await registry.routeMessage("A", "B", { msg: "hello" });
      expect(ok).toBe(false);
    });

    it("routeMessage returns false when recipient not registered", async () => {
      registry.register({ id: "A", type: "test", status: "active" });
      const ok = await registry.routeMessage("A", "B", { msg: "hello" });
      expect(ok).toBe(false);
    });

    it("routeMessage records message in history", async () => {
      registry.register({ id: "A", type: "test", status: "active" });
      registry.register({ id: "B", type: "test", status: "active" });
      await registry.routeMessage("A", "B", { msg: "hello" });
      const recent = registry.recentMessages(1);
      expect(recent).toHaveLength(1);
      expect(recent[0].from).toBe("A");
      expect(recent[0].to).toBe("B");
      expect(recent[0].payload).toEqual({ msg: "hello" });
    });
  });

  describe("getSystemHealth", () => {
    it("returns counts by type and status", () => {
      registry.register({ id: "a1", type: "t1", status: "active" });
      registry.register({ id: "a2", type: "t1", status: "idle" });
      registry.register({ id: "a3", type: "t2", status: "active" });
      const health = registry.getSystemHealth();
      expect(health.totalAgents).toBe(3);
      expect(health.byType).toEqual({ t1: 2, t2: 1 });
      expect(health.byStatus).toEqual({ active: 2, idle: 1 });
    });
  });

  describe("clear", () => {
    it("removes all agents and history", () => {
      registry.register({ id: "a1", type: "t1" });
      registry.register({ id: "a2", type: "t2" });
      registry.clear();
      expect(registry.size()).toBe(0);
      expect(registry.recentMessages()).toHaveLength(0);
    });
  });
});
