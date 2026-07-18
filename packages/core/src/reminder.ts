// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Reminder — 工具执行后提醒系统，借鉴 grok-build Reminder trait
 *
 * grok-build 的设计:
 *   pub trait Reminder {
 *     fn collect_reminders(&self, resources, output) -> Vec<String>
 *   }
 *   可以是 per-tool 或 cross-cutting（跨工具）
 *
 * Maximilian 的实现:
 *   - Reminder 接口：工具可实现，执行后返回提醒文本
 *   - ReminderPolicy：配置何时触发提醒
 *   - ReminderCollector：收集并汇总所有提醒
 *   - 集成到 Agent execute 流程中
 *
 * @see crates/codegen/xai-grok-tools/src/types/tool.rs Reminder
 */

// ── Reminder Types ─────────────────────────────────────────────────────────────

/**
 * 提醒项
 */
export interface Reminder {
  /** 提醒类型 */
  readonly type: ReminderType
  /** 提醒内容（markdown 格式） */
  readonly content: string
  /** 来源（如工具名、角色名） */
  readonly source: string
  /** 优先级 */
  readonly priority: ReminderPriority
  /** 时间戳 */
  readonly timestamp: number
}

/**
 * 提醒类型
 */
export type ReminderType =
  | "tool-tip"           // 工具使用提示
  | "verification"      // 验证提醒
  | "performance"       // 性能提醒
  | "best-practice"      // 最佳实践
  | "security"           // 安全提醒
  | "todo"               // 待办事项
  | "warning"            // 警告
  | "info"               // 信息

/**
 * 提醒优先级
 */
export type ReminderPriority = "high" | "medium" | "low"

/**
 * Reminder 接口 — 工具可实现此接口以在执行后提供提醒
 *
 * @example
 * const myTool = {
 *   ...baseTool,
 *   collectReminders(input, output) {
 *     if (output.warnings?.length > 0) {
 *       return [{
 *         type: "warning",
 *         content: "Command produced warnings. Consider checking output.",
 *         source: this.name,
 *         priority: "medium",
 *         timestamp: Date.now(),
 *       }]
 *     }
 *     return []
 *   }
 * }
 */
export interface ReminderCollector<Input = unknown, Output = unknown> {
  /**
   * 收集提醒
   *
   * @param input 工具输入参数
   * @param output 工具执行结果
   * @returns 提醒列表
   */
  collectReminders(input: Input, output: Output): Reminder[]
}

// ── Built-in Reminders ────────────────────────────────────────────────────────

/**
 * 工具执行后自动触发的系统提醒策略
 */
export interface ReminderPolicy {
  /** 是否启用提醒 */
  enabled: boolean
  /** 同一类型的提醒在 N 次后触发（防刷） */
  throttleAfter?: number
  /** 最大提醒数 */
  maxReminders?: number
}

/**
 * 默认提醒策略
 */
export const DEFAULT_REMINDER_POLICY: ReminderPolicy = {
  enabled: true,
  throttleAfter: 3,
  maxReminders: 5,
}

// ── ReminderCollector ─────────────────────────────────────────────────────────

/**
 * 提醒收集器
 *
 * 收集来自以下来源的提醒：
 * 1. 工具自带的 ReminderCollector
 * 2. 系统级提醒（基于执行模式自动触发）
 * 3. 自定义的跨-cutting 提醒
 */
export class ReminderCollector {
  private readonly tools = new Map<string, ReminderCollector>()
  private readonly systemReminders: SystemReminder[] = []
  private readonly counts = new Map<string, number>()
  private policy: ReminderPolicy

  constructor(policy: ReminderPolicy = DEFAULT_REMINDER_POLICY) {
    this.policy = policy
  }

  /**
   * 注册一个工具的提醒收集器
   */
  registerToolReminders(
    toolName: string,
    collector: ReminderCollector,
  ): void {
    this.tools.set(toolName, collector)
  }

  /**
   * 注销工具提醒
   */
  unregisterToolReminders(toolName: string): void {
    this.tools.delete(toolName)
  }

  /**
   * 添加系统级提醒（跨工具生效）
   */
  addSystemReminder(reminder: SystemReminder): void {
    this.systemReminders.push(reminder)
  }

  /**
   * 移除所有系统级提醒
   */
  clearSystemReminders(): void {
    this.systemReminders.length = 0
  }

  /**
   * 更新提醒策略
   */
  updatePolicy(policy: Partial<ReminderPolicy>): void {
    this.policy = { ...this.policy, ...policy }
  }

  /**
   * 获取当前策略
   */
  getPolicy(): ReminderPolicy {
    return { ...this.policy }
  }

  /**
   * 收集给定工具执行的提醒
   */
  collect(
    toolName: string,
    input: unknown,
    output: unknown,
  ): Reminder[] {
    if (!this.policy.enabled) return []

    const reminders: Reminder[] = []
    const now = Date.now()

    // 1. 收集工具自带的提醒
    const toolCollector = this.tools.get(toolName)
    if (toolCollector) {
      const toolReminders = toolCollector.collectReminders(input, output)
      reminders.push(...toolReminders)
    }

    // 2. 收集系统级提醒
    for (const systemReminder of this.systemReminders) {
      const result = systemReminder.check(toolName, input, output)
      if (result) {
        // 节流检查
        const key = `${toolName}:${systemReminder.type}`
        const count = (this.counts.get(key) ?? 0) + 1
        this.counts.set(key, count)

        if (
          this.policy.throttleAfter &&
          count <= this.policy.throttleAfter
        ) {
          reminders.push({
            type: systemReminder.type,
            content: result,
            source: systemReminder.name,
            priority: systemReminder.priority,
            timestamp: now,
          })
        }
      }
    }

    // 3. 限流
    if (this.policy.maxReminders && reminders.length > this.policy.maxReminders) {
      // 按优先级排序，保留高优先级的
      reminders.sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 }
        return order[a.priority] - order[b.priority]
      })
      return reminders.slice(0, this.policy.maxReminders)
    }

    return reminders
  }

  /**
   * 重置节流计数
   */
  resetCounts(): void {
    this.counts.clear()
  }
}

// ── System Reminder ────────────────────────────────────────────────────────────

/**
 * 系统级提醒检查器
 */
export interface SystemReminder {
  /** 提醒名称 */
  name: string
  /** 提醒类型 */
  type: ReminderType
  /** 优先级 */
  priority: ReminderPriority
  /**
   * 检查是否应该触发提醒
   * @returns 提醒内容，如果不需要提醒则返回 null
   */
  check(toolName: string, input: unknown, output: unknown): string | null
}

// ── Built-in System Reminders ─────────────────────────────────────────────────

/**
 * 连续执行同一命令多次时提醒
 */
export function createRepeatedCommandReminder(): SystemReminder {
  const commandCounts = new Map<string, number>()

  return {
    name: "repeated-command",
    type: "tool-tip",
    priority: "low",
    check(toolName, input, _output) {
      if (toolName !== "bash") return null

      const cmd = (input as { command?: string })?.command
      if (!cmd) return null

      const trimmed = cmd.trim()
      const count = (commandCounts.get(trimmed) ?? 0) + 1
      commandCounts.set(trimmed, count)

      if (count === 3) {
        return `You ran this command 3 times: \`${trimmed}\`. Consider checking if it succeeded or if there's an issue.`
      }
      if (count === 5) {
        return `You've run this command 5 times: \`${trimmed}\`. This might indicate a problem.`
      }
      return null
    },
  }
}

/**
 * 大量文件修改后提醒验证
 */
export function createFileEditVerificationReminder(): SystemReminder {
  const recentEdits = new Map<string, number>()

  return {
    name: "file-edit-verification",
    type: "verification",
    priority: "medium",
    check(toolName, input, _output) {
      if (toolName !== "edit" && toolName !== "write") return null

      const target = (input as { path?: string })?.path
      if (!target) return null

      const count = (recentEdits.get(target) ?? 0) + 1
      recentEdits.set(target, count)

      if (count === 5) {
        return `You've edited ${target} 5 times. Consider running tests or verifying the changes work correctly.`
      }
      return null
    },
  }
}

/**
 * 安全敏感操作提醒
 */
export function createSecurityReminder(): SystemReminder {
  const sensitivePatterns = [
    { pattern: /password|secret|token|api[_-]?key/i, message: "Detected potential secret in input. Ensure it won't be committed to version control." },
    { pattern: /curl\s+.*\s+--data|--data-raw|--data-binary/i, message: "curl with data flag detected. Be careful not to send sensitive data in plaintext." },
    { pattern: /\|\s*bash|\|\s*sh|\|\s*python/i, message: "Pipe to shell detected. Verify the piped command is trusted." },
  ]

  return {
    name: "security",
    type: "security",
    priority: "high",
    check(toolName, input) {
      const inputStr = JSON.stringify(input)
      for (const { pattern, message } of sensitivePatterns) {
        if (pattern.test(inputStr)) {
          return message
        }
      }
      return null
    },
  }
}

/**
 * 构建命令后提醒测试
 */
export function createBuildTestReminder(): SystemReminder {
  const buildCommands = ["npm build", "pnpm build", "yarn build", "npm run build", "cargo build", "make build"]

  return {
    name: "build-test",
    type: "best-practice",
    priority: "low",
    check(toolName, input, _output) {
      if (toolName !== "bash") return null

      const cmd = (input as { command?: string })?.command
      if (!cmd) return null

      const trimmed = cmd.trim().toLowerCase()
      for (const buildCmd of buildCommands) {
        if (trimmed.includes(buildCmd)) {
          return `Build command detected: \`${trimmed}\`. Consider running tests afterward to verify the build succeeded.`
        }
      }
      return null
    },
  }
}

/**
 * 创建默认的系统提醒集合
 */
export function createDefaultSystemReminders(): SystemReminder[] {
  return [
    createRepeatedCommandReminder(),
    createFileEditVerificationReminder(),
    createSecurityReminder(),
    createBuildTestReminder(),
  ]
}

// ── Reminder Formatter ─────────────────────────────────────────────────────────

/**
 * 将提醒格式化为 markdown 文本
 */
export function formatReminder(reminder: Reminder): string {
  const icon = {
    high: "⚠️",
    medium: "💡",
    low: "ℹ️",
  }[reminder.priority]

  return `${icon} **[${reminder.source}]** ${reminder.content}`
}

/**
 * 将多个提醒格式化为单个 markdown 块
 */
export function formatReminders(reminders: Reminder[]): string {
  if (reminders.length === 0) return ""

  const lines = ["\n---\n**Reminders:**"]
  for (const reminder of reminders) {
    lines.push(`- ${formatReminder(reminder)}`)
  }
  return lines.join("\n")
}

// ── Reminder Injection ────────────────────────────────────────────────────────

/**
 * 提醒注入接口
 *
 * 用于将提醒注入到 LLM 的上下文中
 */
export interface ReminderInjection {
  /** 系统提示前缀中的提醒 */
  systemReminders: string[]
  /** 用户消息前缀中的提醒 */
  userReminders: string[]
}

/**
 * 将提醒转换为注入格式
 */
export function toReminderInjection(reminders: Reminder[]): ReminderInjection {
  const systemReminders: string[] = []
  const userReminders: string[] = []

  for (const reminder of reminders) {
    const formatted = formatReminder(reminder)
    if (reminder.priority === "high") {
      // 高优先级放入系统提示
      systemReminders.push(formatted)
    } else {
      // 其他放入用户消息
      userReminders.push(formatted)
    }
  }

  return { systemReminders, userReminders }
}
