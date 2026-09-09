import { describe, it, expect, vi } from "vitest"
import { BackgroundJobRegistry } from "../src/background-job.js"

describe("BackgroundJobRegistry (借鉴 opencode)", () => {
  it("start() resolves done with output on success", async () => {
    const reg = new BackgroundJobRegistry()
    const { id, done } = reg.start({
      type: "test",
      run: async () => "ok",
    })
    const info = await done
    expect(info.id).toBe(id)
    expect(info.status).toBe("completed")
    expect(info.output).toBe("ok")
  })

  it("start() resolves done with error on throw", async () => {
    const reg = new BackgroundJobRegistry()
    const { done } = reg.start({
      type: "test",
      run: async () => {
        throw new Error("boom")
      },
    })
    const info = await done
    expect(info.status).toBe("error")
    expect(info.error).toContain("boom")
  })

  it("cancel() marks running job as cancelled", async () => {
    const reg = new BackgroundJobRegistry()
    const { id } = reg.start({
      type: "test",
      run: () => new Promise(() => {}), // never resolves
    })
    expect(reg.cancel(id)).toBe(true)
    expect(reg.get(id)?.status).toBe("cancelled")
  })

  it("cancel() returns false on missing id", () => {
    const reg = new BackgroundJobRegistry()
    expect(reg.cancel("nope")).toBe(false)
  })

  it("wait() returns undefined for unknown id", async () => {
    const reg = new BackgroundJobRegistry()
    expect(await reg.wait("ghost")).toBeUndefined()
  })

  it("wait() resolves when job completes", async () => {
    const reg = new BackgroundJobRegistry()
    const { id } = reg.start({
      type: "test",
      run: async () => {
        await new Promise((r) => setTimeout(r, 10))
        return "done"
      },
    })
    const info = await reg.wait(id)
    expect(info?.output).toBe("done")
  })

  it("wait() respects timeout", async () => {
    const reg = new BackgroundJobRegistry()
    const { id } = reg.start({
      type: "test",
      run: () => new Promise(() => {}),
    })
    const result = await reg.wait(id, 20)
    expect(result).toBeUndefined()
  })

  it("list() returns all tracked jobs", () => {
    const reg = new BackgroundJobRegistry()
    reg.start({ type: "a", run: async () => "x" })
    reg.start({ type: "b", run: async () => "y" })
    expect(reg.list()).toHaveLength(2)
  })

  it("extend() on same id continues with new run()", async () => {
    const reg = new BackgroundJobRegistry()
    const { id, done } = reg.start({
      type: "test",
      run: async () => {
        await new Promise((r) => setTimeout(r, 5))
        return "first"
      },
    })
    // 让 first 完成
    const firstInfo = await done
    expect(firstInfo.output).toBe("first")

    // 紧接着 start() 同一个 id + 不同的 run
    const { done: done2 } = reg.start({
      id,
      type: "test",
      run: async () => "second",
    })
    const info2 = await done2
    expect(info2.output).toBe("second")
  })

  it("metadata is preserved", async () => {
    const reg = new BackgroundJobRegistry()
    const { done } = reg.start({
      type: "test",
      metadata: { foo: "bar", n: 42 },
      run: async () => "ok",
    })
    const info = await done
    expect(info.metadata).toEqual({ foo: "bar", n: 42 })
  })

  it("completedAt is set after finish", async () => {
    const reg = new BackgroundJobRegistry()
    const before = Date.now()
    const { done } = reg.start({ type: "test", run: async () => "ok" })
    const info = await done
    expect(info.completedAt).toBeDefined()
    expect(info.completedAt!).toBeGreaterThanOrEqual(before)
  })

  // 修复 HIGH 4 - wait() 必须立即返回已完成结果(不再挂起)
  it("wait() returns immediately for already-completed job (no race)", async () => {
    const reg = new BackgroundJobRegistry()
    const { id, done } = reg.start({ type: "test", run: async () => "ok" })
    await done // 先等完成
    const waited = await reg.wait(id) // 现在调用 wait,不应该挂起
    expect(waited?.status).toBe("completed")
    expect(waited?.output).toBe("ok")
  })

  it("start() with same id extends to new run (after previous completes)", async () => {
    // 借鉴 opencode - extend 语义:同 id 再次 start 会开新 run
    const reg = new BackgroundJobRegistry()
    const { id, done } = reg.start({ type: "test", run: async () => "first" })
    await done
    // 再次 start() 同 id — extend,新 run
    const second = reg.start({ id, type: "test", run: async () => "second" })
    const result = await second.done
    expect(result.output).toBe("second")
  })

  it("wait() with timeout still works for running jobs", async () => {
    const reg = new BackgroundJobRegistry()
    const { id } = reg.start({
      type: "test",
      run: () => new Promise(() => {}), // 永不完成
    })
    const result = await reg.wait(id, 30)
    expect(result).toBeUndefined()
  })

  it("cancel() exposes result to wait()", async () => {
    const reg = new BackgroundJobRegistry()
    const { id } = reg.start({
      type: "test",
      run: () => new Promise(() => {}),
    })
    reg.cancel(id)
    const result = await reg.wait(id)
    expect(result?.status).toBe("cancelled")
  })
})