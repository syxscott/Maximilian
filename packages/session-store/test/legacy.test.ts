import { afterEach, beforeEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { readLegacyWorkspaceEvents } from "../src/legacy.js"

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-jsonl-test-"))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function writeLog(name: string, lines: string[]): string {
  const file = path.join(dir, name)
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf-8")
  return file
}

describe("readLegacyWorkspaceEvents", () => {
  it("parses the apps/api JSONL event format in file order", () => {
    const file = writeLog("ws1.jsonl", [
      JSON.stringify({
        seq: 1,
        type: "workspace",
        payload: { id: "ws1" },
        ts: "2026-01-01T00:00:01.000Z",
      }),
      JSON.stringify({
        seq: 2,
        type: "task-start",
        payload: { taskId: "t1" },
        ts: "2026-01-01T00:00:02.000Z",
      }),
      JSON.stringify({ seq: 3, type: "task-end", payload: null, ts: "2026-01-01T00:00:03.000Z" }),
    ])
    const events = readLegacyWorkspaceEvents(file)
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(events.map((e) => e.type)).toEqual(["workspace", "task-start", "task-end"])
    expect(events[1]?.payload).toEqual({ taskId: "t1" })
  })

  it("skips corrupt lines without aborting (crash-tolerant contract)", () => {
    const file = writeLog("ws2.jsonl", [
      JSON.stringify({ seq: 1, type: "a", payload: 1, ts: "2026-01-01T00:00:01.000Z" }),
      '{"seq":2,"type":"b","paylo', // truncated write (invalid JSON)
      "not json at all", // garbage
      "", // blank line
      "   ", // whitespace-only line
      JSON.stringify({ type: "no-seq", payload: null, ts: "2026-01-01T00:00:02.000Z" }), // missing seq
      JSON.stringify({ seq: "three", type: "no-num-seq" }), // non-numeric seq
      JSON.stringify({ seq: 2, type: "b", payload: 2, ts: "2026-01-01T00:00:02.000Z" }),
    ])
    const events = readLegacyWorkspaceEvents(file)
    expect(events).toHaveLength(2)
    expect(events.map((e) => e.seq)).toEqual([1, 2])
    expect(events[1]?.type).toBe("b")
  })

  it("defaults a missing ts like the API writer's reader does", () => {
    const file = writeLog("ws3.jsonl", [JSON.stringify({ seq: 1, type: "a" })])
    const events = readLegacyWorkspaceEvents(file)
    expect(events).toHaveLength(1)
    expect(events[0]?.ts).toBeTruthy()
    expect(Number.isNaN(Date.parse(events[0]?.ts ?? ""))).toBe(false)
  })

  it("treats a missing file as an empty log", () => {
    expect(readLegacyWorkspaceEvents(path.join(dir, "absent.jsonl"))).toEqual([])
  })
})
