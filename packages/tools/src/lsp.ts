// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * LSP Client (借鉴 opencode - lsp/client.ts + lsp/lsp.ts).
 *
 * 用 child_process 启动 LSP 服务器,通过 JSON-RPC over stdin/stdout 通信。
 * Maximilian 暂不内嵌 LSP server 启动(留给用户配置 serverCommand),
 * 只提供 client + diagnostics + symbols 基础能力。
 */

import { spawn, type ChildProcess } from "node:child_process"

export interface LspServerSpec {
  /** 启动命令,如 ["typescript-language-server", "--stdio"] */
  command: string[]
  /** 语言 id,如 "typescript" */
  languageId: string
}

export interface LspPosition {
  line: number
  character: number
}

export interface LspRange {
  start: LspPosition
  end: LspPosition
}

export interface LspDiagnostic {
  range: LspRange
  severity?: 1 | 2 | 3 | 4
  code?: string | number
  source?: string
  message: string
}

export interface LspSymbol {
  name: string
  kind: number
  location: { uri: string; range: LspRange }
}

let nextId = 1

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export class LSPClient {
  private proc: ChildProcess | undefined
  private readonly pending = new Map<number, Pending>()
  private buffer = ""
  private nextIdBase = 1

  constructor(private readonly spec: LspServerSpec) {}

  start(): void {
    if (this.proc) return
    const [cmd, ...args] = this.spec.command
    this.proc = spawn(cmd!, args, { stdio: ["pipe", "pipe", "pipe"] })
    this.proc.stdout!.setEncoding("utf8")
    this.proc.stdout!.on("data", (chunk: string) => this.onData(chunk))
    this.proc.stderr!.on("data", () => {
      // 借鉴 opencode - stderr 静默(交给 LSP server 自己控制日志)
    })
    this.proc.on("exit", () => this.rejectAll(new Error("LSP server exited")))
    this.sendRequest("initialize", { capabilities: {}, initializationOptions: {} })
  }

  stop(): void {
    this.proc?.kill()
    this.proc = undefined
  }

  /** 借鉴 opencode - textDocument/diagnostic */
  diagnostics(uri: string, content: string): Promise<LspDiagnostic[]> {
    this.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: this.spec.languageId, version: 1, text: content },
    })
    return this.sendRequest("textDocument/diagnostic", { textDocument: { uri } }) as Promise<
      LspDiagnostic[]
    >
  }

  /** 借鉴 opencode - textDocument/documentSymbol */
  documentSymbols(uri: string, content: string): Promise<LspSymbol[]> {
    this.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: this.spec.languageId, version: 1, text: content },
    })
    return this.sendRequest("textDocument/documentSymbol", {
      textDocument: { uri },
    }) as Promise<LspSymbol[]>
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextIdBase++
      this.pending.set(id, { resolve, reject })
      this.write({ jsonrpc: "2.0", id, method, params })
    })
  }

  private sendNotification(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params })
  }

  private write(msg: unknown): void {
    const data = JSON.stringify(msg)
    const frame = `Content-Length: ${Buffer.byteLength(data)}\r\n\r\n${data}`
    this.proc?.stdin!.write(frame)
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd < 0) return
      const header = this.buffer.slice(0, headerEnd)
      const m = /Content-Length:\s*(\d+)/i.exec(header)
      if (!m) return
      const len = Number(m[1])
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + len) return
      const body = this.buffer.slice(bodyStart, bodyStart + len)
      this.buffer = this.buffer.slice(bodyStart + len)
      try {
        const msg = JSON.parse(body)
        if (typeof msg.id === "number" && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          if (msg.error) p.reject(new Error(msg.error.message ?? "LSP error"))
          else p.resolve(msg.result)
        }
        // 借鉴 opencode - 处理 server→client request(如 workspace/configuration)忽略即可
      } catch {
        // 借鉴 opencode - parse error 静默
      }
    }
  }

  private rejectAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }
}

/** 借鉴 opencode - LSP SymbolKind enum(常用值) */
export const SymbolKind = {
  File: 1,
  Module: 2,
  Namespace: 3,
  Package: 4,
  Class: 5,
  Method: 6,
  Property: 7,
  Field: 8,
  Constructor: 9,
  Enum: 10,
  Interface: 11,
  Function: 12,
  Variable: 13,
  Constant: 14,
  String: 15,
  Number: 16,
  Boolean: 17,
  Array: 18,
  Object: 19,
} as const