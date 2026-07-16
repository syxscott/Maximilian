// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for DelegationManager — concurrent task executor with retry + routing.
 */
import { describe, it, expect } from "vitest";
import { DelegationManager } from "./delegation-manager.js";

describe("DelegationManager", () => {
  describe("execute", () => {
    it("results preserve input task order even with staggered completion", async () => {
      // Create DelegationManager with maxParallel=3
      const dm = new DelegationManager({ maxParallel: 3 });

      // Create tasks with different completion times
      // task-1 (index 1) completes first at 10ms
      // task-0 (index 0) completes second at 30ms
      // task-2 (index 2) completes last at 50ms
      const tasks = [
        { id: "task-0", type: "handler-0" },
        { id: "task-1", type: "handler-1" },
        { id: "task-2", type: "handler-2" },
      ];

      const delays = [30, 10, 50]; // staggered: task-1 finishes first, task-2 last
      const handlers = new Map<string, (task: { id: string }) => Promise<{ output: string }>>([
        ["handler-0", async () => {
          await new Promise(r => setTimeout(r, delays[0]));
          return { output: "task-0" };
        }],
        ["handler-1", async () => {
          await new Promise(r => setTimeout(r, delays[1]));
          return { output: "task-1" };
        }],
        ["handler-2", async () => {
          await new Promise(r => setTimeout(r, delays[2]));
          return { output: "task-2" };
        }],
      ]);

      const { results } = await dm.execute(tasks, handlers);

      // Results must be in input order regardless of completion order
      expect(results.map(r => r.result?.output)).toEqual(["task-0", "task-1", "task-2"]);
      expect(results.map(r => r.taskId)).toEqual(["task-0", "task-1", "task-2"]);
    });

    it("handles empty task list", async () => {
      const dm = new DelegationManager({ maxParallel: 3 });
      const { results, summary } = await dm.execute([], new Map());
      expect(results).toHaveLength(0);
      expect(summary.totalTasks).toBe(0);
    });

    it("reports correct counts in summary", async () => {
      const dm = new DelegationManager({ maxParallel: 3 });
      const tasks = [
        { id: "t1", type: "success" },
        { id: "t2", type: "fail" },
      ];
      const handlers = new Map<string, (task: { id: string }) => Promise<{ ok: boolean }>>([
        ["success", async () => ({ ok: true })],
        ["fail", async () => { throw new Error("intentional"); }],
      ]);
      const { summary } = await dm.execute(tasks, handlers);
      expect(summary.completedTasks).toBe(1);
      expect(summary.failedTasks).toBe(1);
      expect(summary.totalTasks).toBe(2);
    });
  });
});
