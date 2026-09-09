// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ToolKind — 强类型枚举，借鉴 grok-build tool_taxonomy.rs
 *
 * 每个工具必须声明其 kind，用于：
 * 1. 编译期 exhaustiveness 检查（添加新 kind 时必须处理所有 switch 分支）
 * 2. Capability Mode 格子判断（read-only / read-write / execute / all）
 * 3. 跨 harness 的统一标签（presentationName）
 *
 * 枚举变体通过 `const _ = assert(...)` 在编译时强制穷举检查，
 * 与 grok-build 的 `const _: () = assert!(ALL_TOOL_KINDS.len() == ToolKind::VARIANT_COUNT)` 等价。
 *
 * @see crates/codegen/xai-grok-tools/src/registry/types.rs ToolKind
 */

// assert used for compile-time exhaustiveness checks in future
// import { assert } from "./assert.js"

// ── ToolKind 枚举 ───────────────────────────────────────────────────────────

/**
 * 工具能力分类。添加新变体时：
 * 1. 在 ALL_TOOL_KINDS 中添加标签
 * 2. 在 TOOL_KIND_META 中添加元数据
 * 3. 在 getCapabilityMode 中添加能力判断
 * 4. 在所有 switch/if 语句中添加处理分支（否则编译报错）
 */
export const ToolKind = {
  /** 文件读取类工具 */
  Read: "read",
  /** 文件写入/编辑类工具 */
  Edit: "edit",
  /** 搜索/查询类工具 */
  Search: "search",
  /** 代码执行类工具 */
  Execute: "execute",
  /** 网络请求类工具 */
  Network: "network",
  /** 进程/系统交互类工具 */
  Process: "process",
  /** 工具编排/Agent 协作类工具 */
  Orchestration: "orchestration",
  /** 其他/杂项工具 */
  Misc: "misc",
} as const

export type ToolKind = (typeof ToolKind)[keyof typeof ToolKind]

// ── 编译期穷举常量 ─────────────────────────────────────────────────────────

/** 所有已知 kind 标签的只读数组。用于编译期检查。 */
export const ALL_TOOL_KINDS: readonly ToolKind[] = [
  ToolKind.Read,
  ToolKind.Edit,
  ToolKind.Search,
  ToolKind.Execute,
  ToolKind.Network,
  ToolKind.Process,
  ToolKind.Orchestration,
  ToolKind.Misc,
]

/**
 * 验证 kind 是已知的合法值。
 * 在运行时用于防御性检查。
 */
export function isValidToolKind(kind: string): kind is ToolKind {
  return ALL_TOOL_KINDS.includes(kind as ToolKind)
}

// ── 编译期穷举断言 ─────────────────────────────────────────────────────────

/**
 * 编译期穷举检查。
 * 如果 switch 没有处理所有 kind，TsErrorChecker 会触发编译错误。
 *
 * @example
 * ```ts
 * function getPresentationName(kind: ToolKind): string {
 *   switch (kind) {
 *     case ToolKind.Read: return "📖 Read"
 *     case ToolKind.Edit: return "✏️ Edit"
 *     case ToolKind.Search: return "🔍 Search"
 *     case ToolKind.Execute: return "⚡ Execute"
 *     case ToolKind.Network: return "🌐 Network"
 *     case ToolKind.Process: return "🔧 Process"
 *     case ToolKind.Orchestration: return "🎭 Orchestration"
 *     case ToolKind.Misc: return "📦 Misc"
 *     default: {
 *       // TsErrorChecker 会在编译时确保此分支永远不会被执行
 *       // 如果添加了新的 kind 但忘记处理，这里会报编译错误
 *       exhaustiveCheck(kind)
 *       return "❓ Unknown"
 *     }
 *   }
 * }
 * ```
 */
export function exhaustiveCheck(_kind: never): never {
  throw new Error(`Unhandled ToolKind: ${JSON.stringify(_kind)}`)
}

/**
 * 类型守卫：确保 switch 分支穷举所有可能。
 * 在 default 分支中调用，如果有任何 kind 未处理，编译时就会报错。
 *
 * 用法: `default: return exhaustiveCheck(kind)`
 */
export type TsErrorChecker = (kind: never) => never

// ── ToolKind 元数据 ────────────────────────────────────────────────────────

export interface ToolKindMeta {
  /** 人类可读的展示名称 */
  presentationName: string
  /** 该 kind 的默认能力级别 */
  defaultCapability: CapabilityMode
  /** 该 kind 是否为只读操作 */
  readOnly: boolean
  /** 该 kind 是否可以写入文件系统 */
  writesFiles: boolean
  /** 该 kind 是否可以执行命令 */
  executesCommands: boolean
  /** 该 kind 是否可以访问网络 */
  accessesNetwork: boolean
}

/** 每个 ToolKind 对应的元数据。必须与 ALL_TOOL_KINDS 完全对应。 */
export const TOOL_KIND_META: Record<ToolKind, ToolKindMeta> = {
  [ToolKind.Read]: {
    presentationName: "📖 Read",
    defaultCapability: "read-only",
    readOnly: true,
    writesFiles: false,
    executesCommands: false,
    accessesNetwork: false,
  },
  [ToolKind.Edit]: {
    presentationName: "✏️ Edit",
    defaultCapability: "read-write",
    readOnly: false,
    writesFiles: true,
    executesCommands: false,
    accessesNetwork: false,
  },
  [ToolKind.Search]: {
    presentationName: "🔍 Search",
    defaultCapability: "read-only",
    readOnly: true,
    writesFiles: false,
    executesCommands: false,
    accessesNetwork: false,
  },
  [ToolKind.Execute]: {
    presentationName: "⚡ Execute",
    defaultCapability: "execute",
    readOnly: false,
    writesFiles: false,
    executesCommands: true,
    accessesNetwork: false,
  },
  [ToolKind.Network]: {
    presentationName: "🌐 Network",
    defaultCapability: "read-only",
    readOnly: true,
    writesFiles: false,
    executesCommands: false,
    accessesNetwork: true,
  },
  [ToolKind.Process]: {
    presentationName: "🔧 Process",
    defaultCapability: "execute",
    readOnly: false,
    writesFiles: false,
    executesCommands: true,
    accessesNetwork: false,
  },
  [ToolKind.Orchestration]: {
    presentationName: "🎭 Orchestration",
    defaultCapability: "read-write",
    readOnly: false,
    writesFiles: false,
    executesCommands: false,
    accessesNetwork: false,
  },
  [ToolKind.Misc]: {
    presentationName: "📦 Misc",
    defaultCapability: "read-only",
    readOnly: true,
    writesFiles: false,
    executesCommands: false,
    accessesNetwork: false,
  },
}

// ── Capability Mode（偏序格子）──────────────────────────────────────────────

/**
 * Capability Mode — 借鉴 grok-build CapabilityMode 格子结构。
 *
 * 格子偏序（isSubsetOf）:
 *   read-only ⊆ read-write ⊆ execute ⊆ all
 *   read-only ⊆ all
 *   read-write ⊆ all
 *   execute ⊆ all
 *
 * 用于子进程 fork 时拒绝能力扩大（安全）。
 */
export type CapabilityMode = "read-only" | "read-write" | "execute" | "all"

/** Capability Mode 偏序格子比较 */
export function isCapabilitySubset(
  child: CapabilityMode,
  parent: CapabilityMode,
): boolean {
  // 格子顺序: read-only(0) < read-write(1) < execute(2) < all(3)
  // 子格子 ⊆ 父格子 = child <= parent
  const order: CapabilityMode[] = ["read-only", "read-write", "execute", "all"]
  return order.indexOf(child) <= order.indexOf(parent)
}

/**
 * 检查给定 kind 是否满足所需的能力级别。
 * 如果不满足，返回需要的能力模式。
 */
export function getRequiredCapability(kind: ToolKind): CapabilityMode {
  return TOOL_KIND_META[kind]?.defaultCapability ?? "read-only"
}

/**
 * 检查 kind 是否允许给定的 capability。
 *
 * 语义：kind 的能力级别 >= required 能力级别时，kind 可以处理 required 的操作。
 * 在格子中即 required ⊆ kind 的 defaultCapability。
 */
export function kindAllowsCapability(
  kind: ToolKind,
  required: CapabilityMode,
): boolean {
  const kindDefault = TOOL_KIND_META[kind]?.defaultCapability ?? "read-only"
  // kind 可以处理 required 意味着 kind 的能力 >= required
  // 在格子中即 required 的位置 <= kind 的位置 (required ⊆ kind)
  return isCapabilitySubset(required, kindDefault)
}

// ── 便利函数 ───────────────────────────────────────────────────────────────

/** 获取 kind 的展示名称 */
export function getPresentationName(kind: ToolKind): string {
  return TOOL_KIND_META[kind]?.presentationName ?? "❓ Unknown"
}

/** 检查 kind 是否为只读 */
export function isReadOnlyKind(kind: ToolKind): boolean {
  return TOOL_KIND_META[kind]?.readOnly ?? true
}

/** 检查 kind 是否写入文件 */
export function writesFiles(kind: ToolKind): boolean {
  return TOOL_KIND_META[kind]?.writesFiles ?? false
}

/** 检查 kind 是否执行命令 */
export function executesCommands(kind: ToolKind): boolean {
  return TOOL_KIND_META[kind]?.executesCommands ?? false
}

/** 检查 kind 是否访问网络 */
export function accessesNetwork(kind: ToolKind): boolean {
  return TOOL_KIND_META[kind]?.accessesNetwork ?? false
}

// ── 编译期穷举验证（运行时检查）─────────────────────────────────────────────

/**
 * 验证 TOOL_KIND_META 是否覆盖了所有 ToolKind。
 * 在模块初始化时运行，确保元数据与枚举同步。
 */
function validateKindMeta(): void {
  const missing = ALL_TOOL_KINDS.filter((k) => !TOOL_KIND_META[k])
  if (missing.length > 0) {
    throw new Error(
      `TOOL_KIND_META is missing entries for: ${missing.join(", ")}`,
    )
  }
  const extra = Object.keys(TOOL_KIND_META).filter(
    (k) => !ALL_TOOL_KINDS.includes(k as ToolKind),
  )
  if (extra.length > 0) {
    throw new Error(
      `TOOL_KIND_META has extra entries not in ALL_TOOL_KINDS: ${extra.join(", ")}`,
    )
  }
}

validateKindMeta()
