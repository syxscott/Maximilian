// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { TaskPrioritizer } from "../src/task-prioritizer.js"
import type { Task } from "../src/types.js"
import type { Provider, ChatResponse } from "@max/providers"

function mockProvider(response: unknown): Provider {
  return {
    id: "mock",
    name: "Mock",
    defaultModel: "mock-model",
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify(response),
      model: "mock-model",
    } as ChatResponse),
    stream: vi.fn(),
    isConfigured: () => true,
  }
}

function makeTask(id: string, agentRole: Task["agentRole"] = "frontend"): Task {
  return {
    id,
    agentRole,
    description: `Task ${id}`,
    status: "pending",
    dependsOn: [],
    metadata: {},
  }
}

describe("TaskPrioritizer", () => {
  describe("reRank", () => {
    it("returns re-ranked task priorities from LLM", async () => {
      const provider = mockProvider([
        { taskId: "task-2", priority: "high" },
        { taskId: "task-1", priority: "medium" },
      ])
      const prioritizer = new TaskPrioritizer({ llm: provider })
      const tasks = [makeTask("task-1"), makeTask("task-2")]
      const result = await prioritizer.reRank(tasks, {
        recentResults: [],
        goal: "Build a web app",
      })
      expect(result).toHaveLength(2)
      expect(result.find((r) => r.taskId === "task-2")?.priority).toBe("high")
      expect(result.find((r) => r.taskId === "task-1")?.priority).toBe("medium")
    })

    it("includes newScope when provided by LLM", async () => {
      const provider = mockProvider([
        { taskId: "task-1", priority: "high", newScope: "Revised scope for task 1" },
        { taskId: "task-2", priority: "medium" },
      ])
      const prioritizer = new TaskPrioritizer({ llm: provider })
      const tasks = [makeTask("task-1"), makeTask("task-2")]
      const result = await prioritizer.reRank(tasks, { recentResults: [], goal: "test" })
      const t1 = result.find((r) => r.taskId === "task-1")!
      expect(t1.priority).toBe("high")
      expect(t1.newScope).toBe("Revised scope for task 1")
    })

    it("falls back to medium priority for unparseable response", async () => {
      const provider = mockProvider("not json at all") as unknown as Provider
      const prioritizer = new TaskPrioritizer({ llm: provider })
      const tasks = [makeTask("task-1"), makeTask("task-2")]
      const result = await prioritizer.reRank(tasks, { recentResults: [], goal: "test" })
      // All tasks should be present with medium priority
      expect(result).toHaveLength(2)
      for (const r of result) {
        expect(r.priority).toBe("medium")
      }
    })

    it("falls back to medium priority for partial match (some ids missing)", async () => {
      const provider = mockProvider([
        { taskId: "task-1", priority: "high" },
        // task-2 is missing intentionally
      ])
      const prioritizer = new TaskPrioritizer({ llm: provider })
      const tasks = [makeTask("task-1"), makeTask("task-2")]
      const result = await prioritizer.reRank(tasks, { recentResults: [], goal: "test" })
      expect(result).toHaveLength(2)
      expect(result.find((r) => r.taskId === "task-1")?.priority).toBe("high")
      expect(result.find((r) => r.taskId === "task-2")?.priority).toBe("medium")
    })

    it("uses custom model when provided", async () => {
      const chatSpy = vi.fn().mockResolvedValue({
        content: JSON.stringify([{ taskId: "task-1", priority: "low" }]),
        model: "custom-model",
      } as ChatResponse)
      const provider = {
        id: "mock",
        name: "Mock",
        defaultModel: "default",
        chat: chatSpy,
        stream: vi.fn(),
        isConfigured: () => true,
      } as unknown as Provider

      const prioritizer = new TaskPrioritizer({ llm: provider, model: "custom-model" })
      await prioritizer.reRank([makeTask("task-1")], { recentResults: [], goal: "test" })
      expect(chatSpy).toHaveBeenCalled()
      const call = chatSpy.mock.calls[0]!
      expect(call[1]).toEqual(expect.objectContaining({ model: "custom-model" }))
    })

    it("passes goal and recent results to LLM", async () => {
      const chatSpy = vi.fn().mockResolvedValue({
        content: JSON.stringify([{ taskId: "task-1", priority: "high" }]),
        model: "mock-model",
      } as ChatResponse)
      const provider = {
        id: "mock",
        name: "Mock",
        defaultModel: "mock-model",
        chat: chatSpy,
        stream: vi.fn(),
        isConfigured: () => true,
      } as unknown as Provider

      const prioritizer = new TaskPrioritizer({ llm: provider })
      await prioritizer.reRank([makeTask("task-1")], {
        recentResults: [{ id: "r-1", taskId: "prev", agentRole: "frontend", agentId: "a1", output: "done", metadata: {}, createdAt: "" } as Parameters<typeof prioritizer.reRank>[1]["recentResults"][0]],
        goal: "Complex goal",
      })

      const callContent = chatSpy.mock.calls[0]![0]![0].content as string
      expect(callContent).toContain("Complex goal")
    })
  })
})
