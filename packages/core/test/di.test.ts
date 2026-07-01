import { describe, it, expect } from "vitest"
import { Container, TOKENS } from "../src/di.js"

describe("Container (DI)", () => {
  it("resolves a singleton", () => {
    const c = new Container()
    let created = 0
    c.register("x", () => ({ n: ++created }), "singleton")
    const a = c.resolve("x")
    const b = c.resolve("x")
    expect(a).toBe(b)
    expect(created).toBe(1)
  })

  it("resolves a transient", () => {
    const c = new Container()
    let created = 0
    c.register("x", () => ({ n: ++created }), "transient")
    const a = c.resolve<{ n: number }>("x")
    const b = c.resolve<{ n: number }>("x")
    expect(a).not.toBe(b)
    expect(created).toBe(2)
  })

  it("throws on unregistered token", () => {
    const c = new Container()
    expect(() => c.resolve("nope")).toThrow('token "nope" not registered')
  })

  it("tryResolve returns undefined for missing token", () => {
    const c = new Container()
    expect(c.tryResolve("nope")).toBeUndefined()
  })

  it("has() checks registration", () => {
    const c = new Container()
    expect(c.has("x")).toBe(false)
    c.register("x", () => 1)
    expect(c.has("x")).toBe(true)
  })

  it("override replaces a registration", () => {
    const c = new Container()
    c.register("x", () => "old")
    c.override("x", () => "new")
    expect(c.resolve("x")).toBe("new")
  })

  it("child inherits parent registrations", () => {
    const parent = new Container()
    parent.register("shared", () => "from-parent")
    const child = parent.child()
    expect(child.resolve("shared")).toBe("from-parent")
  })

  it("child override does not affect parent", () => {
    const parent = new Container()
    parent.register("x", () => "parent")
    const child = parent.child()
    child.override("x", () => "child")
    expect(parent.resolve("x")).toBe("parent")
    expect(child.resolve("x")).toBe("child")
  })

  it("factories can resolve other dependencies", () => {
    const c = new Container()
    c.register("a", () => 10)
    c.register("b", (container) => container.resolve<number>("a") * 2)
    expect(c.resolve("b")).toBe(20)
  })

  it("clear removes all registrations", () => {
    const c = new Container()
    c.register("x", () => 1)
    c.clear()
    expect(c.has("x")).toBe(false)
  })

  it("TOKENS constants are defined", () => {
    expect(TOKENS.DB).toBe("db")
    expect(TOKENS.MODEL_ROUTER).toBe("modelRouter")
  })
})
