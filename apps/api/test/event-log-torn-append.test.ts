// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// (borrowing mcode-agent-table b00862b, test/store.test.ts:62-221) Torn
// ledger tail protection for the JSONL event log:
//   - a torn (partial) tail is cut off at the BYTE level and never
//     glues the next append into one unparseable line
//   - a complete tail that only lost its newline is applied at replay
//     and terminated; a complete tail that was never applied REFUSES
//     appends until a restart replays the log
//   - appends run on a single 'a+' fd with a writeSync loop; a failed
//     write (ENOSPC, short write) leaves zero bytes behind
//
// Only writeSync is faked, so the rest of node:fs stays real. The flag
// is hoisted together with the mock: a vi.mock factory runs before the
// module body, so it cannot close over a plain `let`.

import { describe, it, expect, afterEach, vi } from "vitest"
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { JsonlEventLog, UnappliedTailError } from "../src/event-log.js"

const fsMock = vi.hoisted(() => ({ writeSync: "off" as "off" | "throw" | "short" | "half" }))

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return {
    ...actual,
    writeSync(fd: number, data: string | NodeJS.ArrayBufferView, ...rest: unknown[]) {
      if (fsMock.writeSync === "throw") {
        const err = new Error("ENOSPC: no space left on device, write") as NodeJS.ErrnoException
        err.code = "ENOSPC"
        throw err
      }
      if (fsMock.writeSync === "half" && typeof data !== "string") {
        // One byte lands, then the disk is full: the append must roll
        // that byte back.
        fsMock.writeSync = "off"
        actual.writeSync(fd, data as Buffer, 0, 1)
        const err = new Error("ENOSPC: no space left on device, write") as NodeJS.ErrnoException
        err.code = "ENOSPC"
        throw err
      }
      if (fsMock.writeSync === "short" && typeof data !== "string") {
        fsMock.writeSync = "off"
        const buf = data as Buffer
        const offset = (rest[0] as number | undefined) ?? 0
        const length = (rest[1] as number | undefined) ?? buf.length - offset
        const position = rest[2] as number | undefined
        return actual.writeSync(fd, buf, offset, length - 1, position)
      }
      return (actual.writeSync as (...a: unknown[]) => number)(fd, data, ...rest)
    },
  }
})

afterEach(() => {
  fsMock.writeSync = "off"
})

const event = (seq: number, type = "task-start") =>
  JSON.stringify({ seq, type, payload: { n: seq }, ts: "2026-01-01T00:00:00.000Z" })

function makeLog(id: string): { log: JsonlEventLog; root: string; filePath: string } {
  const root = mkdtempSync(join(tmpdir(), "event-log-torn-"))
  const log = new JsonlEventLog(id, root)
  return { log, root, filePath: log.file }
}

/** The log file lives under `<root>/events/`. */
function seedFile(filePath: string, content: Buffer | string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

const parses = (text: string) => () =>
  text
    .split("\n")
    .filter(Boolean)
    .forEach((l) => JSON.parse(l))

describe("load side — torn tail handling", () => {
  it("cuts a half-written trailing JSON line and keeps the prior entries", async () => {
    const { log, filePath } = makeLog("t1")
    seedFile(filePath, event(1) + "\n" + '{"seq":2,"type":"task-st')

    await log.initialize()

    const events = await log.readAfter(0)
    expect(events.map((e) => e.seq)).toEqual([1])
    const text = readFileSync(filePath, "utf8")
    expect(text.endsWith("\n")).toBe(true)
    expect(parses(text)).not.toThrow()
  })

  it("keeps a complete last entry that only lost its newline, and terminates the file", async () => {
    const { log, filePath } = makeLog("t2")
    seedFile(filePath, event(1) + "\n" + event(2))

    await log.initialize()

    const events = await log.readAfter(0)
    expect(events.map((e) => e.seq)).toEqual([1, 2])
    expect(readFileSync(filePath, "utf8").endsWith("\n")).toBe(true)

    // The replayed tail counts into the seq counter: the next append is seq 3.
    const { seq } = await log.append("task-complete", { ok: true })
    expect(seq).toBe(3)
  })

  it("cuts at a byte boundary when the interrupted write ended inside a multi-byte character", async () => {
    const { log, filePath } = makeLog("t3")
    const good = JSON.stringify({
      seq: 1,
      type: "task-start",
      payload: { text: "话题 讨论" },
      ts: "2026-01-01T00:00:00.000Z",
    })
    const goodBytes = Buffer.from(good + "\n", "utf8")
    seedFile(
      filePath,
      Buffer.concat([
        goodBytes,
        Buffer.from('{"seq":2,"payload":"', "utf8"),
        Buffer.from([0xe4, 0xb8]), // first two bytes of a three-byte character
      ]),
    )

    await log.initialize()

    const events = await log.readAfter(0)
    expect(events.map((e) => e.seq)).toEqual([1])
    // The file is byte-identical to the good prefix — no U+FFFD shifted
    // the cut, no partial byte survived.
    expect(readFileSync(filePath).equals(goodBytes)).toBe(true)
  })

  it("repairs a log whose only line is torn", async () => {
    const { log, filePath } = makeLog("t4")
    seedFile(filePath, '{"seq":2,"type":"task-st')

    await log.initialize()

    const events = await log.readAfter(0)
    expect(events).toEqual([]) // the fragment was not a parseable event
    // The next append lands on a clean, newline-terminated file.
    const { seq } = await log.append("task-start", { n: 1 })
    expect(seq).toBe(1)
    const after = readFileSync(filePath, "utf8")
    expect(after.endsWith("\n")).toBe(true)
    expect(parses(after)).not.toThrow()
  })
})

describe("append side — torn tail repair", () => {
  it("does not glue a new entry onto a torn tail (append repairs first)", async () => {
    const { log, filePath } = makeLog("t5")
    seedFile(filePath, event(1) + "\n" + '{"seq":2,"type":"task-st')

    const { seq } = await log.append("task-complete", { ok: true })

    expect(seq).toBe(2)
    const text = readFileSync(filePath, "utf8")
    expect(parses(text)).not.toThrow()
    expect(text.endsWith("\n")).toBe(true)
    const seqs = (await log.readAfter(0)).map((e) => e.seq)
    expect(seqs).toEqual([1, 2])
  })

  it("appends without a prior load (auto-initialize creates the file)", async () => {
    const { log, filePath } = makeLog("t6")

    const { seq } = await log.append("task-start", { n: 1 })

    expect(seq).toBe(1)
    expect(readFileSync(filePath, "utf8").endsWith("\n")).toBe(true)
    expect((await log.readAfter(0)).map((e) => e.seq)).toEqual([1])
  })
})

describe("append side — refusal on a complete unapplied tail", () => {
  it("refuses to append while the log ends in a complete entry this instance has not applied", async () => {
    const { log, filePath } = makeLog("t7")
    // Establish a live instance with writeSeq=1.
    await log.append("task-start", { n: 1 })
    const before = readFileSync(filePath)

    // Simulate a crashed foreign writer: a whole entry landed without
    // its newline after this instance already initialized.
    seedFile(filePath, Buffer.concat([before, Buffer.from(event(2), "utf8")]))

    let message = ""
    let threw = false
    try {
      await log.append("task-complete", { n: 2 })
    } catch (err) {
      threw = err instanceof UnappliedTailError
      message = (err as Error).message
    }
    expect(threw).toBe(true)
    expect(message).toMatch(/restart to replay/)
    // The message can reach API clients, so it carries no path.
    expect(message).not.toContain(filePath)
    // Nothing changed on disk.
    const poisoned = Buffer.concat([before, Buffer.from(event(2), "utf8")])
    expect(readFileSync(filePath).equals(poisoned)).toBe(true)

    // The refusal is sticky until a restart replays the log.
    let again = ""
    try {
      await log.append("task-complete", { n: 2 })
    } catch (err) {
      again = (err as Error).message
    }
    expect(again).toMatch(/restart to replay/)
  })

  it("accepts appends again after close() + replay applied the tail", async () => {
    const { log, filePath } = makeLog("t8")
    await log.append("task-start", { n: 1 })
    const before = readFileSync(filePath)
    seedFile(filePath, Buffer.concat([before, Buffer.from(event(2), "utf8")]))

    let refused = false
    try {
      await log.append("task-complete", { n: 2 })
    } catch {
      refused = true
    }
    expect(refused).toBe(true)

    // Restart: close + re-initialize replays the tail and terminates the file.
    await log.close()
    await log.initialize()

    const { seq } = await log.append("task-complete", { n: 2 })
    expect(seq).toBe(3)
    expect(readFileSync(filePath, "utf8").endsWith("\n")).toBe(true)
  })
})

describe("append side — write failures leave nothing behind", () => {
  it("leaves nothing behind when the append itself fails", async () => {
    const { log, filePath } = makeLog("t9")
    await log.append("task-start", { n: 1 })
    const before = readFileSync(filePath)
    fsMock.writeSync = "throw"

    await expect(log.append("task-complete", { n: 2 })).rejects.toThrow(/ENOSPC/)

    const after = readFileSync(filePath)
    expect(after[after.length - 1]).toBe(0x0a)
    expect(parses(after.toString("utf8"))).not.toThrow()
    expect(after.equals(before)).toBe(true)

    // Recovery: the next append lands cleanly.
    fsMock.writeSync = "off"
    const { seq } = await log.append("task-complete", { n: 2 })
    expect(seq).toBe(2)
    expect((await log.readAfter(0)).map((e) => e.seq)).toEqual([1, 2])
  })

  it("rolls back the byte a write manages to put down before the disk fills", async () => {
    const { log, filePath } = makeLog("t10")
    await log.append("task-start", { n: 1 })
    const before = readFileSync(filePath)
    fsMock.writeSync = "half"

    await expect(log.append("task-complete", { n: 2 })).rejects.toThrow(/ENOSPC/)

    expect(readFileSync(filePath).equals(before)).toBe(true)
    fsMock.writeSync = "off"
    const { seq } = await log.append("task-complete", { n: 2 })
    expect(seq).toBe(2)
    expect((await log.readAfter(0)).map((e) => e.seq)).toEqual([1, 2])
  })

  it("completes a short write instead of returning early", async () => {
    const { log, filePath } = makeLog("t11")
    fsMock.writeSync = "short"

    const { seq } = await log.append("task-start", { n: 1 })

    expect(seq).toBe(1)
    // The whole entry is down byte-for-byte (append() stamps its own ts,
    // so equality is checked through the parser, not a fixture string).
    const after = readFileSync(filePath, "utf8")
    expect(after.endsWith("\n")).toBe(true)
    expect(parses(after)).not.toThrow()
    const events = await log.readAfter(0)
    expect(events.map((e) => e.seq)).toEqual([1])
    expect(events[0]?.payload).toEqual({ n: 1 })
  })
})

describe("append side — seq continuity", () => {
  it("never reuses a seq after a restart (fresh instance reads the disk counter)", async () => {
    const { log, root, filePath } = makeLog("t12")
    await log.append("task-start", { n: 1 })
    await log.append("task-start", { n: 2 })

    const restarted = new JsonlEventLog("t12", root)
    const { seq } = await restarted.append("task-start", { n: 3 })
    expect(seq).toBe(3)
    expect((await restarted.readAfter(0)).map((e) => e.seq)).toEqual([1, 2, 3])
  })
})
