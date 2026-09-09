// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for reminder.ts
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
  ReminderCollector,
  ReminderCollector,
  DEFAULT_REMINDER_POLICY,
  createDefaultSystemReminders,
  createRepeatedCommandReminder,
  createSecurityReminder,
  createBuildTestReminder,
  formatReminder,
  formatReminders,
  toReminderInjection,
  type Reminder,
} from "../src/reminder.js"

describe("ReminderCollector", () => {
  let collector: ReminderCollector

  beforeEach(() => {
    collector = new ReminderCollector()
  })

  it("starts empty", () => {
    const reminders = collector.collect("bash", {}, {})
    expect(reminders).toHaveLength(0)
  })

  it("registers and collects tool reminders", () => {
    collector.registerToolReminders("bash", {
      collectReminders(input, output) {
        return [{
          type: "tool-tip",
          content: "Custom reminder",
          source: "bash",
          priority: "medium",
          timestamp: Date.now(),
        }]
      },
    })

    const reminders = collector.collect("bash", {}, {})
    expect(reminders).toHaveLength(1)
    expect(reminders[0].content).toBe("Custom reminder")
  })

  it("returns empty when disabled", () => {
    collector.updatePolicy({ enabled: false })

    collector.registerToolReminders("bash", {
      collectReminders() {
        return [{
          type: "tool-tip",
          content: "Should not appear",
          source: "bash",
          priority: "medium",
          timestamp: Date.now(),
        }]
      },
    })

    const reminders = collector.collect("bash", {}, {})
    expect(reminders).toHaveLength(0)
  })

  it("limits max reminders", () => {
    collector.updatePolicy({ maxReminders: 2 })

    // Add more than max system reminders
    collector.addSystemReminder(createBuildTestReminder())
    collector.addSystemReminder(createBuildTestReminder())
    collector.addSystemReminder(createBuildTestReminder())

    // Force some system reminders to fire
    collector.addSystemReminder({
      name: "test",
      type: "info",
      priority: "low",
      check() { return "Test reminder" },
    })
    collector.addSystemReminder({
      name: "test2",
      type: "info",
      priority: "low",
      check() { return "Test reminder 2" },
    })

    const reminders = collector.collect("bash", { command: "npm build" }, {})
    expect(reminders.length).toBeLessThanOrEqual(2)
  })

  it("unregisters tool reminders", () => {
    collector.registerToolReminders("bash", {
      collectReminders() {
        return [{
          type: "tool-tip",
          content: "Reminder",
          source: "bash",
          priority: "medium",
          timestamp: Date.now(),
        }]
      },
    })

    collector.unregisterToolReminders("bash")

    const reminders = collector.collect("bash", {}, {})
    expect(reminders).toHaveLength(0)
  })

  it("updates policy", () => {
    collector.updatePolicy({ enabled: false, throttleAfter: 5 })
    const policy = collector.getPolicy()
    expect(policy.enabled).toBe(false)
    expect(policy.throttleAfter).toBe(5)
  })
})

describe("System Reminders", () => {
  describe("createRepeatedCommandReminder", () => {
    it("triggers after 3 repeated commands", () => {
      const reminder = createRepeatedCommandReminder()
      const collector = new ReminderCollector()
      collector.addSystemReminder(reminder)

      // First 2 times - no reminder
      collector.collect("bash", { command: "ls" }, {})
      collector.collect("bash", { command: "ls" }, {})

      // Third time - triggers reminder
      const reminders = collector.collect("bash", { command: "ls" }, {})
      expect(reminders.length).toBe(1)
      expect(reminders[0].content).toContain("3 times")
    })

    it("tracks different commands separately", () => {
      const reminder = createRepeatedCommandReminder()
      const collector = new ReminderCollector()
      collector.addSystemReminder(reminder)

      collector.collect("bash", { command: "ls" }, {})
      collector.collect("bash", { command: "ls" }, {})
      // ls triggered (2 times, no reminder yet)
      collector.collect("bash", { command: "cat" }, {})
      collector.collect("bash", { command: "cat" }, {})
      // cat triggered on 3rd call
      const reminders = collector.collect("bash", { command: "cat" }, {})
      expect(reminders.length).toBe(1)
    })
  })

  describe("createSecurityReminder", () => {
    it("detects potential secrets", () => {
      const reminder = createSecurityReminder()

      const result = reminder.check("bash", { command: "echo $PASSWORD" }, null)
      expect(result).toBeTruthy()
      expect(result).toContain("secret")
    })

    it("detects curl with data flag", () => {
      const reminder = createSecurityReminder()

      const result = reminder.check("bash", { command: "curl -X POST --data 'hello' url" }, null)
      expect(result).toBeTruthy()
      expect(result).toContain("curl")
    })

    it("detects data-raw flag", () => {
      const reminder = createSecurityReminder()

      // Using a command that doesn't trigger the secret pattern
      const result = reminder.check("bash", { command: "curl url --data-raw 'hello'" }, null)
      expect(result).toBeTruthy()
      expect(result).toContain("curl")
    })

    it("passes safe commands", () => {
      const reminder = createSecurityReminder()

      const result = reminder.check("bash", { command: "ls -la" }, null)
      expect(result).toBeNull()
    })
  })

  describe("createBuildTestReminder", () => {
    it("detects npm build", () => {
      const reminder = createBuildTestReminder()

      const result = reminder.check("bash", { command: "npm run build" }, null)
      expect(result).toBeTruthy()
      expect(result).toContain("Build command")
    })

    it("detects cargo build", () => {
      const reminder = createBuildTestReminder()

      const result = reminder.check("bash", { command: "cargo build --release" }, null)
      expect(result).toBeTruthy()
      expect(result).toContain("Build command")
    })

    it("ignores non-build commands", () => {
      const reminder = createBuildTestReminder()

      const result = reminder.check("bash", { command: "ls -la" }, null)
      expect(result).toBeNull()
    })
  })

  describe("createDefaultSystemReminders", () => {
    it("creates all default reminders", () => {
      const reminders = createDefaultSystemReminders()
      expect(reminders.length).toBe(4)
    })
  })
})

describe("formatReminder", () => {
  it("formats reminder with icon and content", () => {
    const reminder: Reminder = {
      type: "warning",
      content: "Test content",
      source: "test-source",
      priority: "high",
      timestamp: 1000,
    }

    const formatted = formatReminder(reminder)
    expect(formatted).toContain("⚠️")
    expect(formatted).toContain("test-source")
    expect(formatted).toContain("Test content")
  })
})

describe("formatReminders", () => {
  it("returns empty string for no reminders", () => {
    expect(formatReminders([])).toBe("")
  })

  it("formats multiple reminders", () => {
    const reminders: Reminder[] = [
      {
        type: "warning",
        content: "First",
        source: "src1",
        priority: "high",
        timestamp: 1000,
      },
      {
        type: "info",
        content: "Second",
        source: "src2",
        priority: "low",
        timestamp: 1001,
      },
    ]

    const formatted = formatReminders(reminders)
    expect(formatted).toContain("Reminders:")
    expect(formatted).toContain("First")
    expect(formatted).toContain("Second")
  })
})

describe("toReminderInjection", () => {
  it("separates high priority from others", () => {
    const reminders: Reminder[] = [
      {
        type: "security",
        content: "Security warning",
        source: "security",
        priority: "high",
        timestamp: 1000,
      },
      {
        type: "info",
        content: "Low priority",
        source: "info",
        priority: "low",
        timestamp: 1001,
      },
    ]

    const injection = toReminderInjection(reminders)
    expect(injection.systemReminders).toHaveLength(1)
    expect(injection.userReminders).toHaveLength(1)
  })
})
