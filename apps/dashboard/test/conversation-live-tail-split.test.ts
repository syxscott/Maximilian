// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Live-tail partition + split tests (ZCode v4
 * conversationTimelineLiveTail borrowing): the position-based tail rule,
 * the three tail shapes, and the streaming-frame history reference
 * stability guarantee — including the honest re-issue when a HISTORY
 * turn's content actually changes.
 */
import { describe, expect, it } from "vitest"
import {
  partitionLiveTail,
  splitLiveTail,
  type TurnPartition,
} from "../src/components/conversation/live-tail-split"
import {
  buildTurnFlowItems,
  groupUnitsByTurn,
  sameConversationUnit,
  sameTurnRender,
  type RuntimeEvent,
  type TurnModel,
} from "../src/components/conversation/model"

const ev = (over: Record<string, unknown>): RuntimeEvent =>
  ({ type: "unknown", ...over }) as RuntimeEvent

/** Compile a stream into turns (the pipeline the timeline feeds in). */
const compile = (events: RuntimeEvent[]): TurnModel[] =>
  groupUnitsByTurn(buildTurnFlowItems(events, null))

/** Hand-built turn model (partition-level tests need no pipeline). */
const mkTurn = (turnId: string, status: TurnModel["status"] = "completed"): TurnModel => ({
  turnId,
  role: "assistant",
  status,
  depth: 1,
  units: [
    {
      kind: "task",
      key: `task-${turnId}`,
      turnId,
      role: "assistant",
      taskId: turnId,
      index: 0,
    },
  ],
})

describe("partitionLiveTail (history / tail cut + reference stability)", () => {
  it("the tail is exactly the stream's LAST turn — position, not a running flag", () => {
    const turns = [mkTurn("a"), mkTurn("b"), mkTurn("c", "running")]
    const partition = partitionLiveTail(turns)
    expect(partition.history.map((t) => t.turnId)).toEqual(["a", "b"])
    expect(partition.tail.map((t) => t.turnId)).toEqual(["c"])
  })

  it("a settled last turn still owns the tail (Stop must not remount it)", () => {
    const turns = [mkTurn("a"), mkTurn("b")]
    expect(partitionLiveTail(turns).tail.map((t) => t.turnId)).toEqual(["b"])
  })

  it("an empty stream partitions into nothing", () => {
    expect(partitionLiveTail([])).toEqual({ history: [], tail: [] })
  })

  it("a streaming frame that only touches the tail RE-USES the history array", () => {
    const frame1 = compile([
      ev({ type: "task-start", taskId: "t1" }),
      ev({ type: "task-complete", taskId: "t1" }),
      ev({ type: "task-start", taskId: "t2" }),
    ])
    const partition1 = partitionLiveTail(frame1)

    // Frame 2: a text delta lands in the LAST turn only — the pipeline
    // recompiles (fresh objects, identical history content).
    const frame2 = compile([
      ev({ type: "task-start", taskId: "t1" }),
      ev({ type: "task-complete", taskId: "t1" }),
      ev({ type: "task-start", taskId: "t2" }),
      ev({ type: "assistant-text", text: "delta", taskId: "t2" }),
    ])
    const partition2 = partitionLiveTail(frame2, partition1)
    expect(partition2.history).toBe(partition1.history)
    expect(partition2.tail[0]?.turnId).toBe("task-t2")
    expect(partition2.tail[0]?.units.length).toBe(2) // the delta landed
  })

  it("a HISTORY turn's content change honestly re-issues the array", () => {
    const frame1 = compile([
      ev({ type: "task-start", taskId: "t1" }),
      ev({ type: "tool-start", taskId: "t1", toolName: "bash" }),
      ev({ type: "task-start", taskId: "t2" }),
    ])
    const partition1 = partitionLiveTail(frame1)

    // Frame 2: the tool-end pairs INSIDE the history turn — content
    // changed, so the stable reference would render a frozen spinner.
    const frame2 = compile([
      ev({ type: "task-start", taskId: "t1" }),
      ev({ type: "tool-start", taskId: "t1", toolName: "bash" }),
      ev({ type: "tool-end", taskId: "t1", toolName: "bash", ok: true, durationMs: 10 }),
      ev({ type: "task-start", taskId: "t2" }),
    ])
    const partition2 = partitionLiveTail(frame2, partition1)
    expect(partition2.history).not.toBe(partition1.history)
    const toolUnit = partition2.history[0]?.units.find((u) => u.kind === "tool")
    expect(toolUnit && toolUnit.kind === "tool" ? toolUnit.state : undefined).toBe("ok")
  })

  it("returns the previous partition object when nothing changed at all", () => {
    const turns = [mkTurn("a"), mkTurn("b")]
    const first = partitionLiveTail(turns)
    const again = partitionLiveTail([...turns], first) // fresh array, same content
    expect(again).toBe(first)
  })
})

describe("splitLiveTail (the three tail shapes)", () => {
  it("tail 0 + empty stream renders nothing", () => {
    const split = splitLiveTail({ history: [], tail: [] })
    expect(split.virtual).toEqual([])
    expect(split.tailRows).toEqual([])
  })

  it("tail 0 + history-only stream promotes the LAST row to the tail", () => {
    const history = [mkTurn("a"), mkTurn("b")]
    const split = splitLiveTail({ history, tail: [] })
    expect(split.virtual).toEqual([history[0]])
    expect(split.tailRows).toEqual([history[1]])
  })

  it("tail 1 (the streaming shape): the band IS the history array, untouched", () => {
    const history = [mkTurn("a"), mkTurn("b")]
    const tail = [mkTurn("c", "running")]
    const split = splitLiveTail({ history, tail })
    expect(split.virtual).toBe(history) // reference identity — no rebuild
    expect(split.tailRows).toEqual(tail)
  })

  it("tail N: only the LAST tail row is live; earlier tail rows stay virtual", () => {
    const history = [mkTurn("a")]
    const tail = [mkTurn("b", "running"), mkTurn("c", "running")]
    const split = splitLiveTail({ history, tail })
    expect(split.virtual.map((t) => t.turnId)).toEqual(["a", "b"])
    expect(split.tailRows.map((t) => t.turnId)).toEqual(["c"])
  })
})

describe("sameTurnRender (the content equality the partition/memo rely on)", () => {
  const turnsOf = (events: RuntimeEvent[]): TurnModel[] => {
    const [turn] = groupUnitsByTurn(buildTurnFlowItems(events, null))
    if (!turn) throw new Error("expected a turn")
    return [turn]
  }

  it("equal content across recompiles → true despite fresh references", () => {
    const events: RuntimeEvent[] = [
      ev({ type: "task-start", taskId: "t1" }),
      ev({ type: "tool-start", taskId: "t1", toolName: "bash", input: { cmd: "ls" } }),
      ev({ type: "task-complete", taskId: "t1" }),
    ]
    const [a] = turnsOf(events)
    const [b] = turnsOf(events)
    expect(a).not.toBe(b)
    expect(sameTurnRender(a, b)).toBe(true)
  })

  it.each([
    [
      "a paired tool state flips",
      (e: RuntimeEvent[]) => [
        ...e,
        {
          type: "tool-end",
          taskId: "t1",
          toolName: "bash",
          ok: true,
          durationMs: 5,
        } as RuntimeEvent,
      ],
    ],
    [
      "a unit is appended",
      (e: RuntimeEvent[]) => [
        ...e,
        { type: "assistant-text", text: "more", taskId: "t1" } as RuntimeEvent,
      ],
    ],
    [
      "the status flips",
      (e: RuntimeEvent[]) => [
        ...e.slice(0, 2),
        { type: "task-failed", taskId: "t1", error: "boom" } as RuntimeEvent,
      ],
    ],
  ])("%s → false", (_name, mutate) => {
    const events: RuntimeEvent[] = [
      ev({ type: "task-start", taskId: "t1" }),
      ev({ type: "tool-start", taskId: "t1", toolName: "bash", input: { cmd: "ls" } }),
    ]
    const [a] = turnsOf(events)
    const [b] = turnsOf(mutate(events))
    expect(sameTurnRender(a, b)).toBe(false)
  })

  it("malformed inputs never compare equal to a real turn", () => {
    const [turn] = turnsOf([ev({ type: "task-start", taskId: "t1" })])
    expect(sameTurnRender(turn, null)).toBe(false)
    expect(sameTurnRender(null, turn)).toBe(false)
    expect(sameTurnRender(turn, turn)).toBe(true)
    // Unit level: a real unit vs null — and an identical reference.
    const unit = turn.units[0]
    expect(sameConversationUnit(unit, null)).toBe(false)
    expect(sameConversationUnit(unit, unit)).toBe(true)
  })
})

describe("partition + split compose into the timeline's render inputs", () => {
  it("streaming frames keep the virtual band identity end to end", () => {
    const frame1 = compile([
      ev({ type: "task-start", taskId: "t1" }),
      ev({ type: "task-complete", taskId: "t1" }),
      ev({ type: "task-start", taskId: "t2" }),
    ])
    const partition1 = partitionLiveTail(frame1)
    const split1 = splitLiveTail(partition1)
    expect(split1.virtual.map((t) => t.turnId)).toEqual(["task-t1"])
    expect(split1.tailRows.map((t) => t.turnId)).toEqual(["task-t2"])

    // A token frame later: band reference unchanged, tail grew.
    const frame2 = compile([
      ev({ type: "task-start", taskId: "t1" }),
      ev({ type: "task-complete", taskId: "t1" }),
      ev({ type: "task-start", taskId: "t2" }),
      ev({ type: "assistant-text", text: "token", taskId: "t2" }),
    ])
    const split2 = splitLiveTail(partitionLiveTail(frame2, partition1))
    expect(split2.virtual).toBe(split1.virtual)
    expect(split2.tailRows[0]?.units.length).toBe(2)
  })

  it("a TurnPartition round-trips through JSON-able turn models", () => {
    const partition: TurnPartition = partitionLiveTail([mkTurn("a")])
    expect(partition.history).toEqual([])
    expect(partition.tail).toHaveLength(1)
  })
})
