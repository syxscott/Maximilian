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

function frame(body: string): string {
  const len = Buffer.byteLength(body)
  return `Content-Length: ${len}\r\n\r\n${body}`
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
})