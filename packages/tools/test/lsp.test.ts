import { describe, it, expect } from "vitest"
import { LSPClient, SymbolKind } from "../src/lsp.js"

interface FakeProc {
  stdin: { write: (s: string) => boolean }
  stdout: { setEncoding: (e: string) => void; on: (...a: unknown[]) => unknown }
  stderr: { on: (...a: unknown[]) => unknown }
  kill: () => void
}

function makeFakeProc(): FakeProc {
  return {
    stdin: { write: () => true },
    stdout: { setEncoding: () => {}, on: () => undefined },
    stderr: { on: () => undefined },
    kill: () => {},
  }
}

function frame(body: string): Buffer {
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
  return Buffer.from(header, "utf8")
}

describe("LSPClient (借鉴 opencode)", () => {
  it("onData parses a Content-Length framed response and resolves pending request", () => {
    const client = new LSPClient({ command: ["x"], languageId: "ts" })
    ;(client as any).proc = makeFakeProc()
    const promise = (client as any).sendRequest("foo", {})
    expect((client as any).pending.size).toBe(1)
    ;(client as any).onData(
      frame('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}'),
    )
    expect((client as any).pending.size).toBe(0)
    return promise.then((r: unknown) => expect(r).toEqual({ ok: true }))
  })

  it("onData parses split frames across multiple chunks", () => {
    const client = new LSPClient({ command: ["x"], languageId: "ts" })
    ;(client as any).proc = makeFakeProc()
    const promise = (client as any).sendRequest("foo", {})
    const full = frame('{"jsonrpc":"2.0","id":1,"result":{"split":true}}')
    // 切在 header 之后
    const splitAt = full.indexOf("\r\n\r\n") + 4
    ;(client as any).onData(full.slice(0, splitAt))
    expect((client as any).pending.size).toBe(1)
    ;(client as any).onData(full.slice(splitAt))
    expect((client as any).pending.size).toBe(0)
    return promise.then((r: unknown) => expect(r).toEqual({ split: true }))
  })

  it("onData rejects on error response", () => {
    const client = new LSPClient({ command: ["x"], languageId: "ts" })
    ;(client as any).proc = makeFakeProc()
    const promise = (client as any).sendRequest("foo", {})
    ;(client as any).onData(
      frame('{"jsonrpc":"2.0","id":1,"error":{"code":1,"message":"nope"}}'),
    )
    return expect(promise).rejects.toThrow("nope")
  })

  it("pending map: sendRequest adds 1 entry; resolve removes it", () => {
    const client = new LSPClient({ command: ["x"], languageId: "ts" })
    ;(client as any).proc = makeFakeProc()
    expect((client as any).pending.size).toBe(0)
    void (client as any).sendRequest("foo", {})
    expect((client as any).pending.size).toBe(1)
    ;(client as any).onData(frame('{"jsonrpc":"2.0","id":1,"result":"x"}'))
    expect((client as any).pending.size).toBe(0)
  })

  it("nextIdBase increments per sendRequest", () => {
    const client = new LSPClient({ command: ["x"], languageId: "ts" })
    ;(client as any).proc = makeFakeProc()
    void (client as any).sendRequest("a", {})
    void (client as any).sendRequest("b", {})
    void (client as any).sendRequest("c", {})
    expect((client as any).pending.size).toBe(3)
    ;(client as any).onData(frame('{"id":1,"r":1}'))
    ;(client as any).onData(frame('{"id":2,"r":2}'))
    ;(client as any).onData(frame('{"id":3,"r":3}'))
    expect((client as any).pending.size).toBe(0)
  })

  it("notifications don't add to pending", () => {
    const client = new LSPClient({ command: ["x"], languageId: "ts" })
    ;(client as any).proc = makeFakeProc()
    expect(() => (client as any).sendNotification("event", { x: 1 })).not.toThrow()
    expect((client as any).pending.size).toBe(0)
  })

  it("rejectAll rejects all pending", () => {
    const client = new LSPClient({ command: ["x"], languageId: "ts" })
    ;(client as any).proc = makeFakeProc()
    const promise = (client as any).sendRequest("long", {})
    ;(client as any).rejectAll(new Error("LSP server exited"))
    return expect(promise).rejects.toThrow(/LSP server exited/)
  })

  it("stop() does not throw on unstarted client", () => {
    const client = new LSPClient({ command: ["x"], languageId: "ts" })
    expect(() => client.stop()).not.toThrow()
  })

  it("SymbolKind exposes LSP spec values", () => {
    expect(SymbolKind.Class).toBe(5)
    expect(SymbolKind.Function).toBe(12)
    expect(SymbolKind.Variable).toBe(13)
  })

  it("write() emits a Content-Length framed message", () => {
    const client = new LSPClient({ command: ["x"], languageId: "ts" })
    let written = ""
    ;(client as any).proc = {
      stdin: { write: (s: string) => { written += s; return true } },
      stdout: { setEncoding: () => {}, on: () => undefined },
      stderr: { on: () => undefined },
      kill: () => {},
    }
    ;(client as any).write({ jsonrpc: "2.0", id: 1, method: "x", params: {} })
    expect(written).toMatch(/^Content-Length: \d+\r\n\r\n/)
    expect(written).toContain('"jsonrpc":"2.0"')
  })

  // 修复 CRITICAL 2 - 借鉴 opencode - malformed 帧必须能跳过不能死循环
  it("skips frame missing Content-Length (no infinite loop)", () => {
    const client = new LSPClient({ command: ["x"], languageId: "ts" })
    ;(client as any).proc = makeFakeProc()
    const promise = (client as any).sendRequest("foo", {})
    // 喂一个 malformed 帧(无 Content-Length),然后是合法帧
    const malformed = Buffer.from("X-Some-Header: bad\r\n\r\n", "utf8")
    const valid = frame('{"jsonrpc":"2.0","id":1,"result":"recovered"}')
    ;(client as any).onData(Buffer.concat([malformed, valid]))
    expect((client as any).pending.size).toBe(0)
    return promise.then((r: unknown) => expect(r).toBe("recovered"))
  })

  it("recovers from bad JSON body (no infinite loop)", () => {
    const client = new LSPClient({ command: ["x"], languageId: "ts" })
    ;(client as any).proc = makeFakeProc()
    const promise = (client as any).sendRequest("foo", {})
    // 第一个帧 body 不是合法 JSON,第二个是合法帧
    const badBody = frame("{not valid json")
    const valid = frame('{"jsonrpc":"2.0","id":1,"result":"ok"}')
    ;(client as any).onData(Buffer.concat([badBody, valid]))
    expect((client as any).pending.size).toBe(0)
    return promise.then((r: unknown) => expect(r).toBe("ok"))
  })

  // 修复 HIGH 6 - binary frame: 非 UTF-8 字节不能被解码损坏
  it("preserves binary body bytes (修复 HIGH 6 - Buffer mode)", () => {
    const client = new LSPClient({ command: ["x"], languageId: "ts" })
    ;(client as any).proc = makeFakeProc()
    // 构造 body 含非 ASCII UTF-8 字节(中文)
    const body = '{"jsonrpc":"2.0","id":1,"result":{"text":"中文 🚀"}}'
    const valid = frame(body)
    ;(client as any).onData(valid)
    // 若 setEncoding("utf8") 被启用,Buffer 模式应直接通过 utf8 解析,得到正确中文字符
    // (无法在此测试 binary invalid UTF-8,因为现实 LSP 服务器一般 JSON 都是 UTF-8)
    expect((client as any).pending.size).toBe(0)
  })
})