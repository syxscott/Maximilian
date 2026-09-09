/**
 * Tests for AgentRegistry — message routing and receiver delivery.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { AgentRegistry } from "./agent-registry.js"

describe("AgentRegistry", () => {
  let registry: AgentRegistry

  beforeEach(() => {
    registry = new AgentRegistry()
  })

  describe("register / unregister / get / list", () => {
    it("registers and retrieves an agent", () => {
      registry.register({ id: "a1", type: "test", status: "active" })
      expect(registry.get("a1")?.id).toBe("a1")
    })

    it("throws on duplicate id", () => {
      registry.register({ id: "a1", type: "test" })
      expect(() => registry.register({ id: "a1", type: "test" })).toThrow()
    })

    it("unregisters an agent", async () => {
      registry.register({ id: "a1", type: "test" })
      expect(await registry.unregister("a1")).toBe(true)
      expect(registry.get("a1")).toBeUndefined()
    })

    it("list() returns all agents", () => {
      registry.register({ id: "a1", type: "t1" })
      registry.register({ id: "a2", type: "t2" })
      expect(registry.list()).toHaveLength(2)
    })

    it("listByType returns agents of a type", () => {
      registry.register({ id: "a1", type: "t1" })
      registry.register({ id: "a2", type: "t2" })
      registry.register({ id: "a3", type: "t1" })
      expect(registry.listByType("t1")).toHaveLength(2)
    })
  })

  describe("routeMessage", () => {
    it("routeMessage delivers payload to recipient receiver", async () => {
      const received: unknown[] = []
      registry.register({ id: "A", type: "test", status: "active" })
      registry.register({
        id: "B",
        type: "test",
        status: "active",
        receiver: async (from, payload) => {
          received.push({ from, payload })
        },
      })

      const ok = await registry.routeMessage("A", "B", { msg: "hello" })
      expect(ok).toBe(true)
      expect(received).toEqual([{ from: "A", payload: { msg: "hello" } }])
    })

    it("routeMessage returns true even when recipient has no receiver", async () => {
      registry.register({ id: "A", type: "test", status: "active" })
      registry.register({ id: "B", type: "test", status: "active" }) // 无 receiver
      const ok = await registry.routeMessage("A", "B", { msg: "hello" })
      expect(ok).toBe(true) // 历史仍写入，但无投递
    })

    it("routeMessage returns false when recipient receiver throws", async () => {
      registry.register({ id: "A", type: "test", status: "active" })
      registry.register({
        id: "B",
        type: "test",
        status: "active",
        receiver: async () => {
          throw new Error("delivery failed")
        },
      })
      const ok = await registry.routeMessage("A", "B", { msg: "hello" })
      expect(ok).toBe(false)
    })

    it("routeMessage returns false when sender not registered", async () => {
      registry.register({ id: "B", type: "test", status: "active" })
      const ok = await registry.routeMessage("A", "B", { msg: "hello" })
      expect(ok).toBe(false)
    })

    it("routeMessage returns false when recipient not registered", async () => {
      registry.register({ id: "A", type: "test", status: "active" })
      const ok = await registry.routeMessage("A", "B", { msg: "hello" })
      expect(ok).toBe(false)
    })

    it("routeMessage records message in history", async () => {
      registry.register({ id: "A", type: "test", status: "active" })
      registry.register({ id: "B", type: "test", status: "active" })
      await registry.routeMessage("A", "B", { msg: "hello" })
      const recent = registry.recentMessages(1)
      expect(recent).toHaveLength(1)
      expect(recent[0].from).toBe("A")
      expect(recent[0].to).toBe("B")
      expect(recent[0].payload).toEqual({ msg: "hello" })
    })
  })

  describe("getSystemHealth", () => {
    it("returns counts by type and status", () => {
      registry.register({ id: "a1", type: "t1", status: "active" })
      registry.register({ id: "a2", type: "t1", status: "idle" })
      registry.register({ id: "a3", type: "t2", status: "active" })
      const health = registry.getSystemHealth()
      expect(health.totalAgents).toBe(3)
      expect(health.byType).toEqual({ t1: 2, t2: 1 })
      expect(health.byStatus).toEqual({ active: 2, idle: 1 })
    })
  })

  describe("clear", () => {
    it("removes all agents and history", () => {
      registry.register({ id: "a1", type: "t1" })
      registry.register({ id: "a2", type: "t2" })
      registry.clear()
      expect(registry.size()).toBe(0)
      expect(registry.recentMessages()).toHaveLength(0)
    })
  })
})

// 借鉴 opencode - subagent-permissions 派生
import type { PermissionScope } from "@max/tools/permission"

describe("AgentRegistry (借鉴 opencode - subagent scope)", () => {
  it("root agent registers without scope (inherits parent's if any)", async () => {
    const reg = new AgentRegistry()
    reg.register({ id: "root", type: "orchestrator" })
    const r = reg.get("root")
    expect(r?.id).toBe("root")
    expect(r?.scope).toBeUndefined()
  })

  it("child agent derives scope from parent on register", () => {
    const reg = new AgentRegistry()
    const parentScope: PermissionScope = {
      allowedTools: ["read", "bash"],
      forbiddenPaths: ["/etc"],
      requireApproval: false,
    }
    reg.register({
      id: "parent",
      type: "orchestrator",
      scope: parentScope,
    })
    reg.register({
      id: "child",
      type: "executor",
      parentId: "parent",
      narrowScope: { forbiddenPaths: ["/var"], requireApproval: true },
    })
    const child = reg.get("child")
    expect(child?.scope).toBeDefined()
    expect(child?.scope!.parentId).toBeUndefined() // 父级本身是 root
    expect(child?.scope!.allowedTools).toEqual(["read", "bash"]) // 继承
    expect([...child!.scope!.forbiddenPaths].sort()).toEqual(["/etc", "/var"]) // 并集
    expect(child?.scope!.requireApproval).toBe(true) // 子可要求审批
  })

  it("child can narrow allowed tools explicitly", () => {
    const reg = new AgentRegistry()
    reg.register({
      id: "parent",
      type: "orchestrator",
      scope: { allowedTools: ["*"], forbiddenPaths: [], requireApproval: false },
    })
    reg.register({
      id: "child",
      type: "worker",
      parentId: "parent",
      narrowScope: { allowedTools: ["read"] },
    })
    expect(reg.get("child")?.scope!.allowedTools).toEqual(["read"])
  })

  it("register with missing parent throws", () => {
    const reg = new AgentRegistry()
    expect(() => reg.register({ id: "child", type: "worker", parentId: "ghost" })).toThrow(
      /Parent agent ghost not found/,
    )
  })

  it("child without narrowScope inherits parent verbatim", () => {
    const reg = new AgentRegistry()
    const parentScope: PermissionScope = {
      allowedTools: ["read"],
      forbiddenPaths: ["/etc"],
      requireApproval: true,
    }
    reg.register({ id: "p", type: "o", scope: parentScope })
    reg.register({ id: "c", type: "w", parentId: "p" })
    const childScope = reg.get("c")?.scope!
    expect(childScope.allowedTools).toEqual(parentScope.allowedTools)
    expect(childScope.forbiddenPaths).toEqual(parentScope.forbiddenPaths)
    expect(childScope.requireApproval).toBe(true)
  })
})
