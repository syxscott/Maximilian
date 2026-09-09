// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

import { describe, it, expect } from "vitest";
import { EventBus } from "../src/event-bus.js";

interface TestEvent {
  type: string;
  payload?: unknown;
}

describe("EventBus publishAsync", () => {
  it("publishAsync awaits async subscribers before resolving", async () => {
    const bus = new EventBus<TestEvent>();
    let completed = false;

    bus.subscribe(
      async () => {
        await new Promise((r) => setTimeout(r, 50));
        completed = true;
      },
      { types: ["test-event"] }
    );

    const result = await bus.publishAsync({ type: "test-event" });
    expect(result).toBe(1);
    expect(completed).toBe(true); // publishAsync resolves only after async subscriber finishes
  });

  it("publishAsync resolves when no subscribers", async () => {
    const bus = new EventBus<TestEvent>();
    const result = await bus.publishAsync({ type: "orphan-event" });
    expect(result).toBe(0);
  });

  it("publishAsync awaits multiple async subscribers concurrently", async () => {
    const bus = new EventBus<TestEvent>();
    let firstDone = false;
    let secondDone = false;

    bus.subscribe(
      async () => {
        await new Promise((r) => setTimeout(r, 30));
        firstDone = true;
      },
      { types: ["start"] }
    );

    bus.subscribe(
      async () => {
        await new Promise((r) => setTimeout(r, 10));
        secondDone = true;
      },
      { types: ["start"] }
    );

    await bus.publishAsync({ type: "start" });
    // Both should be done since publishAsync awaits all subscribers
    expect(firstDone).toBe(true);
    expect(secondDone).toBe(true);
  });
});
