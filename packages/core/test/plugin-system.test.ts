import { describe, it, expect, vi } from "vitest"
import { PluginManager } from "../src/plugin-system.js"

describe("PluginManager", () => {
  it("registers and dispatches to a plugin", async () => {
    const pm = new PluginManager()
    const handler = vi.fn()
    await pm.register({ name: "test", hooks: { "task-start": handler } })
    await pm.dispatch("task-start", { taskId: "t1" })
    expect(handler).toHaveBeenCalledWith({ taskId: "t1" })
  })

  it("calls onInit when registered", async () => {
    const pm = new PluginManager()
    const onInit = vi.fn()
    await pm.register({ name: "test", hooks: {}, onInit })
    expect(onInit).toHaveBeenCalledOnce()
  })

  it("calls onDispose when unregistered", async () => {
    const pm = new PluginManager()
    const onDispose = vi.fn()
    await pm.register({ name: "test", hooks: {}, onDispose })
    await pm.unregister("test")
    expect(onDispose).toHaveBeenCalledOnce()
  })

  it("dispatches to multiple plugins in order", async () => {
    const pm = new PluginManager()
    const order: string[] = []
    await pm.register({ name: "a", hooks: { "task-start": () => order.push("a") } })
    await pm.register({ name: "b", hooks: { "task-start": () => order.push("b") } })
    await pm.dispatch("task-start", {})
    expect(order).toEqual(["a", "b"])
  })

  it("skips plugins without the hook", async () => {
    const pm = new PluginManager()
    const handler = vi.fn()
    await pm.register({ name: "a", hooks: { "task-start": handler } })
    await pm.register({ name: "b", hooks: { "task-end": vi.fn() } })
    await pm.dispatch("task-start", {})
    expect(handler).toHaveBeenCalledOnce()
  })

  it("continues dispatching after a plugin error", async () => {
    const pm = new PluginManager()
    const handler = vi.fn()
    await pm.register({
      name: "bad",
      hooks: { "task-start": () => { throw new Error("boom") } },
    })
    await pm.register({ name: "good", hooks: { "task-start": handler } })
    await pm.dispatch("task-start", {})
    expect(handler).toHaveBeenCalledOnce()
  })

  it("throws on duplicate registration", async () => {
    const pm = new PluginManager()
    await pm.register({ name: "x", hooks: {} })
    await expect(pm.register({ name: "x", hooks: {} })).rejects.toThrow('plugin "x" already registered')
  })

  it("has() checks registration", async () => {
    const pm = new PluginManager()
    expect(pm.has("x")).toBe(false)
    await pm.register({ name: "x", hooks: {} })
    expect(pm.has("x")).toBe(true)
  })

  it("getNames returns all plugin names", async () => {
    const pm = new PluginManager()
    await pm.register({ name: "a", hooks: {} })
    await pm.register({ name: "b", hooks: {} })
    expect(pm.getNames()).toEqual(["a", "b"])
  })

  it("clear removes all plugins", async () => {
    const pm = new PluginManager()
    await pm.register({ name: "a", hooks: {} })
    await pm.clear()
    expect(pm.getNames()).toEqual([])
  })

  it("unregister is a no-op for unknown names", async () => {
    const pm = new PluginManager()
    await pm.unregister("nope") // should not throw
  })

  it("handles async hooks", async () => {
    const pm = new PluginManager()
    let resolved = false
    await pm.register({
      name: "async",
      hooks: { "task-start": async () => { await new Promise((r) => setTimeout(r, 5)); resolved = true } },
    })
    await pm.dispatch("task-start", {})
    expect(resolved).toBe(true)
  })
})
