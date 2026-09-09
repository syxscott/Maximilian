// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SandboxProfile — 统一的沙箱配置抽象，借鉴 grok-build sandbox profiles
 *
 * grok-build 的设计:
 *   - ProfileName { Workspace, Devbox, ReadOnly, Strict, Off, Custom(String) }
 *   - 沙箱配置可层叠：~/.grok/sandbox.toml → workspace/.grok/sandbox.toml
 *   - 进程级全局状态: static SANDBOX: OnceLock<GlobalSandboxState>
 *   - apply() 然后 install() 的两阶段模式
 *
 * Maximilian 的 SandboxProfile:
 *   - 将现有的 Local/Docker/MacSandbox/Process 四种后端统一为 Profile 接口
 *   - 支持路径白名单/黑名单
 *   - 支持网络策略
 *   - 支持危险操作警告
 *
 * @see crates/codegen/xai-grok-sandbox/src/lib.rs SandboxManager
 * @see crates/codegen/xai-grok-sandbox/src/profiles.rs ProfileName
 */

// ── Profile Names ──────────────────────────────────────────────────────────────

/**
 * 预定义的沙箱 profile 名称
 */
export const SandboxProfileName = {
  /** 工作区沙箱 - 允许所有文件系统操作但限制危险命令 */
  Workspace: "workspace",
  /** 开发沙箱 - 更严格的限制，适合执行用户代码 */
  Devbox: "devbox",
  /** 只读沙箱 - 只允许读取，不允许写入或执行 */
  ReadOnly: "read-only",
  /** 严格沙箱 - 最小权限原则 */
  Strict: "strict",
  /** 关闭沙箱 - 不应用任何限制 */
  Off: "off",
} as const

export type SandboxProfileName =
  (typeof SandboxProfileName)[keyof typeof SandboxProfileName]

// ── Path Policy ────────────────────────────────────────────────────────────────

/**
 * 路径权限策略
 */
export interface PathPolicy {
  /** 允许的路径模式（glob）。空数组 = 无限制。 */
  allow?: string[]
  /** 拒绝的路径模式（优先于 allow）。 */
  deny?: string[]
  /** 是否允许访问父目录（../） */
  allowParentTraversal?: boolean
}

/**
 * 检查路径是否在允许列表中
 */
export function isPathAllowed(path: string, policy: PathPolicy): boolean {
  const { allow = [], deny = [], allowParentTraversal = false } = policy

  // 检查 deny 列表
  for (const pattern of deny) {
    if (matchGlob(pattern, path)) return false
  }

  // 如果没有 allow 限制，默认允许
  if (allow.length === 0) {
    return allowParentTraversal || !path.includes("..")
  }

  // 检查 allow 列表
  for (const pattern of allow) {
    if (matchGlob(pattern, path)) return true
  }

  return false
}

// 简化的 glob 匹配
function matchGlob(pattern: string, text: string): boolean {
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*")
  return new RegExp(`^${regexStr}$`).test(text)
}

// ── Network Policy ─────────────────────────────────────────────────────────────

/**
 * 网络访问策略
 */
export type NetworkPolicy =
  | { mode: "allow" }                           // 允许所有网络
  | { mode: "deny" }                            // 拒绝所有网络
  | { mode: "allow-list"; hosts: string[] }     // 只允许指定 hosts
  | { mode: "read-only" }                       // 只允许 HTTP GET

// ── SandboxProfile ────────────────────────────────────────────────────────────

/**
 * 沙箱 profile 配置
 */
export interface SandboxProfile {
  /** Profile 名称 */
  name: SandboxProfileName
  /** 描述 */
  description?: string
  /** 路径策略 */
  paths?: PathPolicy
  /** 网络策略 */
  network?: NetworkPolicy
  /** 允许执行的命令（空 = 全部允许） */
  allowedCommands?: string[]
  /** 禁止执行的命令（优先于 allowedCommands） */
  deniedCommands?: string[]
  /** 是否允许环境变量继承 */
  inheritEnv?: boolean
  /** 内存限制（MB） */
  memoryLimitMB?: number
  /** CPU 时间限制（秒） */
  cpuTimeLimit?: number
  /** 是否启用进程追踪 */
  enablePtrace?: boolean
}

// ── Profile Presets ────────────────────────────────────────────────────────────

/**
 * 内置沙箱 profile 预设
 */
export const SANDBOX_PROFILES: Record<SandboxProfileName, SandboxProfile> = {
  [SandboxProfileName.Off]: {
    name: SandboxProfileName.Off,
    description: "关闭沙箱 - 不应用任何限制",
    paths: { allow: [], deny: [] },
    network: { mode: "allow" },
  },

  [SandboxProfileName.ReadOnly]: {
    name: SandboxProfileName.ReadOnly,
    description: "只读沙箱 - 只允许读取文件，不允许写入或执行",
    paths: { allow: ["**"], deny: [] },
    network: { mode: "deny" },
    deniedCommands: ["bash", "sh", "node", "python", "python3", "ruby", "perl", "php"],
  },

  [SandboxProfileName.Workspace]: {
    name: SandboxProfileName.Workspace,
    description: "工作区沙箱 - 允许文件操作和构建命令",
    paths: { allow: ["**"], deny: ["/etc/**", "/root/**", "/sys/**", "/proc/**"] },
    network: { mode: "allow" },
    allowedCommands: ["git", "npm", "pnpm", "yarn", "node", "npm", "make", "gcc", "g++", "cargo", "rustc"],
    inheritEnv: true,
  },

  [SandboxProfileName.Devbox]: {
    name: SandboxProfileName.Devbox,
    description: "开发沙箱 - 适合执行用户代码，更严格限制",
    paths: { allow: ["**"], deny: ["/etc/**", "/root/**", "/sys/**", "/proc/**", "/bin/**", "/sbin/**"] },
    network: { mode: "allow-list", hosts: ["localhost", "127.0.0.1", "::1"] },
    deniedCommands: ["rm", "dd", "mkfs", "fdisk", "mount", "umount"],
    inheritEnv: false,
    memoryLimitMB: 2048,
    cpuTimeLimit: 300,
  },

  [SandboxProfileName.Strict]: {
    name: SandboxProfileName.Strict,
    description: "严格沙箱 - 最小权限原则",
    paths: { allow: [], deny: ["**"] },
    network: { mode: "deny" },
    deniedCommands: ["*"],  // 全部禁止再逐个允许
    inheritEnv: false,
    memoryLimitMB: 512,
    cpuTimeLimit: 60,
  },
}

// ── SandboxManager ─────────────────────────────────────────────────────────────

/**
 * 沙箱管理器
 *
 * 使用两阶段模式：
 * 1. apply(profile) - 应用 profile 配置到进程级全局状态
 * 2. install() - 在当前环境中安装沙箱限制
 *
 * @example
 * const manager = new SandboxManager()
 * manager.apply(SANDBOX_PROFILES.workspace)
 * await manager.install()
 */
export class SandboxManager {
  private currentProfile: SandboxProfile | null = null
  private installed = false
  private readonly violations: SandboxViolation[] = []

  /**
   * 应用沙箱 profile（不立即生效，需要调用 install()）
   */
  apply(profile: SandboxProfile): void {
    this.currentProfile = profile
    this.installed = false
  }

  /**
   * 获取当前应用的 profile
   */
  getProfile(): SandboxProfile | null {
    return this.currentProfile
  }

  /**
   * 获取当前 profile 是否已安装
   */
  isInstalled(): boolean {
    return this.installed
  }

  /**
   * 安装沙箱限制到当前环境
   *
   * 注意：此实现是简化版本，实际的 kernel-level 限制需要：
   * - Linux: Landlock/seccomp
   * - macOS: Sandbox Executive
   * - Windows: Windows Sandbox
   */
  async install(): Promise<void> {
    if (!this.currentProfile) {
      throw new Error("No profile applied. Call apply() first.")
    }

    if (this.installed) {
      return
    }

    const profile = this.currentProfile

    // 根据 profile 类型应用不同的沙箱策略
    switch (profile.name) {
      case SandboxProfileName.Off:
        // 不应用任何限制
        break

      case SandboxProfileName.ReadOnly:
        // 只读模式通过 Docker 或 path policy 实现
        break

      case SandboxProfileName.Workspace:
      case SandboxProfileName.Devbox:
      case SandboxProfileName.Strict:
        // 这些 profile 的限制在执行层实现
        break
    }

    this.installed = true
  }

  /**
   * 记录沙箱违规
   */
  logViolation(target: string, operation: string): void {
    this.violations.push({
      timestamp: Date.now(),
      target,
      operation,
      profile: this.currentProfile?.name ?? "unknown",
    })
  }

  /**
   * 获取所有违规记录
   */
  getViolations(): readonly SandboxViolation[] {
    return this.violations
  }

  /**
   * 检查操作是否允许
   */
  checkAllowed(operation: string, target?: string): boolean {
    if (!this.currentProfile) return true
    if (this.installed && this.currentProfile.name === SandboxProfileName.Off) return true

    const profile = this.currentProfile

    // 检查命令限制
    if (profile.deniedCommands) {
      for (const cmd of profile.deniedCommands) {
        if (cmd === "*") return false
        if (cmd === operation || operation.includes(cmd)) return false
      }
    }

    if (profile.allowedCommands && profile.allowedCommands.length > 0) {
      let allowed = false
      for (const cmd of profile.allowedCommands) {
        if (cmd === operation || operation.includes(cmd)) {
          allowed = true
          break
        }
      }
      if (!allowed) return false
    }

    // 检查路径限制
    if (target && profile.paths) {
      if (!isPathAllowed(target, profile.paths)) {
        return false
      }
    }

    return true
  }

  /**
   * 卸载沙箱
   */
  async uninstall(): Promise<void> {
    this.installed = false
    this.currentProfile = null
  }
}

/**
 * 沙箱违规记录
 */
export interface SandboxViolation {
  timestamp: number
  target: string
  operation: string
  profile: SandboxProfileName | "unknown"
}

// ── Process-global Sandbox State ─────────────────────────────────────────────

/**
 * 进程级沙箱状态（单例）
 *
 * 借鉴 grok-build 的 static SANDBOX: OnceLock<GlobalSandboxState>
 */
class GlobalSandboxState {
  readonly manager: SandboxManager
  readonly autoAllowBash: boolean
  private active = false

  constructor() {
    this.manager = new SandboxManager()
    this.autoAllowBash = false
  }

  activate(profile: SandboxProfile): void {
    this.manager.apply(profile)
    this.active = true
  }

  deactivate(): void {
    this.active = false
  }

  isActive(): boolean {
    return this.active
  }
}

// 全局沙箱状态（进程级单例）
const sandboxState: GlobalSandboxState = new GlobalSandboxState()

/**
 * 检查沙箱是否处于激活状态
 */
export function isSandboxActive(): boolean {
  return sandboxState.isActive()
}

/**
 * 检查沙箱是否应该自动允许 bash 执行
 */
export function shouldAutoAllowBash(): boolean {
  return sandboxState.autoAllowBash
}

/**
 * 获取全局沙箱管理器
 */
export function getSandboxManager(): SandboxManager {
  return sandboxState.manager
}

// ── Backend Factory ────────────────────────────────────────────────────────────

import type { SandboxBackend } from "./sandbox.js"

/**
 * 根据 profile 创建对应的沙箱后端
 *
 * @example
 * const backend = createSandboxBackend(profile, { cwd: "/project" })
 */
export function createSandboxBackend(
  profile: SandboxProfile,
  options?: { cwd?: string; dockerImage?: string; commandTimeout?: number },
): { backend: SandboxBackend; options: Record<string, unknown> } {
  const opts = options ?? {}

  switch (profile.name) {
    case SandboxProfileName.Off:
    case SandboxProfileName.Workspace:
      return { backend: "local", options: opts }

    case SandboxProfileName.Devbox:
      // Devbox 模式优先使用 Docker（如果可用）
      return { backend: "docker", options: { ...opts, dockerImage: opts.dockerImage ?? "ubuntu:22.04" } }

    case SandboxProfileName.ReadOnly:
      // 只读模式使用本地后端 + 路径限制
      return { backend: "local", options: opts }

    case SandboxProfileName.Strict:
      // 严格模式使用 process 后端 + cgroup 限制
      return {
        backend: "process",
        options: {
          ...opts,
          memoryLimit: profile.memoryLimitMB,
        },
      }

    default:
      return { backend: "local", options: opts }
  }
}
