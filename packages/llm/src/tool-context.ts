// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ToolCallContext + TypedExtensions — 借鉴 grok-build context.rs
 *
 * grok-build 的 ToolCallContext 携带:
 *   - call_id, session_id
 *   - extensions: TypedExtensions (TypeId → Any 的类型安全扩展袋)
 *
 * Maximilian 的 ToolExecuteContext 扩展为:
 *   - 原有基础字段 (sessionID, agent, assistantMessageID, toolCallID)
 *   - extensions: 扩展袋，支持任意类型安全的数据注入
 *
 * 扩展袋使用 Symbol 作为 key，避免与内置字段冲突，
 * 并提供类型安全的 get/set 接口。
 *
 * @see crates/common/xai-tool-runtime/src/context.rs
 */

// ── Extension Bag ───────────────────────────────────────────────────────────

/**
 * 扩展袋接口 — 使用 Symbol key 的类型安全 Map
 *
 * 使用 Symbol 而非 string 可以避免与未来内置字段名冲突。
 * 每个扩展值都带有一个 brand type 用于类型安全。
 *
 * 注意：Map 的 key 类型是 `symbol`（原始类型），而非 `Symbol`（包装对象）。
 * Symbol.for() 返回的是 global symbol，类型是 `symbol`。
 */
export class ExtensionBag {
  private readonly store = new Map<symbol, unknown>()

  /**
   * 设置一个扩展值
   */
  set<T>(key: symbol, value: T): void {
    this.store.set(key, value)
  }

  /**
   * 获取一个扩展值，如果不存在返回 undefined
   */
  get<T>(key: symbol): T | undefined {
    return this.store.get(key) as T | undefined
  }

  /**
   * 检查扩展是否存在
   */
  has(key: symbol): boolean {
    return this.store.has(key)
  }

  /**
   * 删除扩展
   */
  delete(key: symbol): boolean {
    return this.store.delete(key)
  }

  /**
   * 获取所有扩展的 Symbol keys
   */
  keys(): IterableIterator<symbol> {
    return this.store.keys()
  }

  /**
   * 获取扩展数量
   */
  get size(): number {
    return this.store.size
  }
}

// ── Well-known Extension Keys ────────────────────────────────────────────────

/**
 * 预定义的扩展 Key，确保在整个 codebase 中使用一致的 Symbol。
 * 使用 descriptive name 来创建 Symbol，避免 Symbol 重复。
 */
export const ExtensionKeys = {
  /** 当前工作目录 */
  cwd: Symbol.for("max.tool.context.cwd"),
  /** 沙箱后端实例 */
  sandbox: Symbol.for("max.tool.context.sandbox"),
  /** 取消令牌 */
  abortSignal: Symbol.for("max.tool.context.abortSignal"),
  /** 工具输出流 (用于 AsyncIterable 工具) */
  outputStream: Symbol.for("max.tool.context.outputStream"),
  /** 每次调用的唯一 ID */
  callId: Symbol.for("max.tool.context.callId"),
  /** 模型覆盖配置 */
  modelOverride: Symbol.for("max.tool.context.modelOverride"),
  /** 资源句柄 (文件句柄、连接等) */
  resources: Symbol.for("max.tool.context.resources"),
  /** 行为版本 (用于特性开关) */
  behaviorVersion: Symbol.for("max.tool.context.behaviorVersion"),
  /** 用户凭证 */
  credentials: Symbol.for("max.tool.context.credentials"),
} as const

/**
 * 常用扩展类型的 TypeScript 类型别名
 */
export interface CwdExtension {
  /** 当前工作目录路径 */
  readonly cwd: string
}

export interface AbortSignalExtension {
  /** 可取消的 AbortSignal */
  readonly signal: AbortSignal
}

export interface ModelOverrideExtension {
  /** 模型覆盖配置 */
  readonly model?: string
  readonly provider?: string
}

export interface BehaviorVersionExtension {
  /** 行为版本号，用于特性开关 */
  readonly version: number
}

export interface ResourcesExtension {
  /** 资源句柄映射 */
  readonly handles: Map<string, unknown>
}

// ── Context Builder ──────────────────────────────────────────────────────────

/**
 * ToolExecuteContext 的基础接口
 */
export interface ToolExecuteContext {
  readonly sessionID: string
  readonly agent: string
  readonly assistantMessageID: string
  readonly toolCallID: string
  /** 扩展袋，可存储任意类型安全的数据 */
  readonly extensions: ExtensionBag
}

/**
 * 构建 ToolExecuteContext 的 Builder
 *
 * @example
 * const ctx = new ToolExecuteContextBuilder()
 *   .sessionID("sess-123")
 *   .agent("backend")
 *   .toolCallID("call-456")
 *   .withCwd("/home/user/project")
 *   .withAbortSignal(abortController.signal)
 *   .build()
 */
export class ToolExecuteContextBuilder {
  private _sessionID = ""
  private _agent = ""
  private _assistantMessageID = ""
  private _toolCallID = ""
  private readonly _extensions = new ExtensionBag()

  sessionID(value: string): this {
    this._sessionID = value
    return this
  }

  agent(value: string): this {
    this._agent = value
    return this
  }

  assistantMessageID(value: string): this {
    this._assistantMessageID = value
    return this
  }

  toolCallID(value: string): this {
    this._toolCallID = value
    return this
  }

  /**
   * 设置工作目录扩展
   */
  withCwd(cwd: string): this {
    this._extensions.set(ExtensionKeys.cwd, { cwd } satisfies CwdExtension)
    return this
  }

  /**
   * 设置取消信号扩展
   */
  withAbortSignal(signal: AbortSignal): this {
    this._extensions.set(ExtensionKeys.abortSignal, { signal } satisfies AbortSignalExtension)
    return this
  }

  /**
   * 设置模型覆盖扩展
   */
  withModelOverride(model?: string, provider?: string): this {
    this._extensions.set(ExtensionKeys.modelOverride, { model, provider } satisfies ModelOverrideExtension)
    return this
  }

  /**
   * 设置行为版本扩展
   */
  withBehaviorVersion(version: number): this {
    this._extensions.set(ExtensionKeys.behaviorVersion, { version } satisfies BehaviorVersionExtension)
    return this
  }

  /**
   * 设置资源句柄扩展
   */
  withResources(handles: Map<string, unknown>): this {
    this._extensions.set(ExtensionKeys.resources, { handles } satisfies ResourcesExtension)
    return this
  }

  /**
   * 设置自定义扩展
   */
  withExtension<T>(key: symbol, value: T): this {
    this._extensions.set(key, value)
    return this
  }

  /**
   * 从已有 context 复制扩展
   */
  fromContext(ctx: ToolExecuteContext): this {
    for (const key of ctx.extensions.keys()) {
      this._extensions.set(key, ctx.extensions.get(key))
    }
    return this
  }

  /**
   * 构建不可变的 ToolExecuteContext
   */
  build(): ToolExecuteContext {
    if (!this._sessionID) throw new Error("sessionID is required")
    if (!this._toolCallID) throw new Error("toolCallID is required")
    return Object.freeze({
      sessionID: this._sessionID,
      agent: this._agent,
      assistantMessageID: this._assistantMessageID,
      toolCallID: this._toolCallID,
      extensions: this._extensions,
    })
  }
}

// ── Convenience Helpers ───────────────────────────────────────────────────────

/**
 * 从 context 获取 cwd，如果未设置则返回默认值
 */
export function getCwd(ctx: ToolExecuteContext, fallback = process.cwd()): string {
  return ctx.extensions.get<CwdExtension>(ExtensionKeys.cwd)?.cwd ?? fallback
}

/**
 * 从 context 获取取消信号
 */
export function getAbortSignal(ctx: ToolExecuteContext): AbortSignal | undefined {
  return ctx.extensions.get<AbortSignalExtension>(ExtensionKeys.abortSignal)?.signal
}

/**
 * 从 context 获取模型覆盖
 */
export function getModelOverride(ctx: ToolExecuteContext): ModelOverrideExtension | undefined {
  return ctx.extensions.get<ModelOverrideExtension>(ExtensionKeys.modelOverride)
}

/**
 * 从 context 获取行为版本
 */
export function getBehaviorVersion(ctx: ToolExecuteContext): number | undefined {
  return ctx.extensions.get<BehaviorVersionExtension>(ExtensionKeys.behaviorVersion)?.version
}
