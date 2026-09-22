import { describe, expect, it } from "vitest"

import {
  CredentialLeaseFrameDecoder,
  CredentialLeaseProtocolError,
  encodeCredentialLeaseFrame,
} from "../src/index.js"

const MAX_FRAME_BYTES = 64 * 1024

function frame(value: unknown): Buffer {
  return encodeCredentialLeaseFrame(value)
}

function expectInvalidRequest(fn: () => unknown): void {
  try {
    fn()
    expect.unreachable("expected the call to throw")
  } catch (error) {
    expect(error).toBeInstanceOf(CredentialLeaseProtocolError)
    expect((error as CredentialLeaseProtocolError).code).toBe("INVALID_REQUEST")
  }
}

describe("credential lease frames", () => {
  it("round-trips a value through encode and decode", () => {
    const value = { version: 1, requestId: "abc-123", method: "status" }
    const decoder = new CredentialLeaseFrameDecoder()
    expect(decoder.push(frame(value))).toEqual([value])
    expect(decoder.bufferedBytes).toBe(0)
  })

  it("writes the payload length as a 4-byte big-endian prefix", () => {
    expect(frame({ hello: "world" }).readUInt32BE(0)).toBe(
      Buffer.byteLength(JSON.stringify({ hello: "world" }), "utf8"),
    )
  })

  it("decodes multiple frames carried in a single chunk in order", () => {
    const decoder = new CredentialLeaseFrameDecoder()
    const encoded = Buffer.concat([frame({ n: 1 }), frame({ n: 2 }), frame({ n: 3 })])
    expect(decoder.push(encoded)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
  })

  it("reassembles frames delivered one byte at a time", () => {
    const decoder = new CredentialLeaseFrameDecoder()
    const encoded = frame({ split: true })
    const delivered: unknown[] = []
    for (const byte of encoded) {
      delivered.push(...decoder.push(Buffer.from([byte])))
    }
    expect(delivered).toEqual([{ split: true }])
    expect(decoder.bufferedBytes).toBe(0)
  })

  it("buffers a partial frame and completes it on the next chunk", () => {
    const decoder = new CredentialLeaseFrameDecoder()
    const encoded = frame({ partial: true })
    const head = encoded.subarray(0, encoded.length - 3)
    expect(decoder.push(head)).toEqual([])
    expect(decoder.bufferedBytes).toBe(head.length)
    expect(decoder.push(encoded.subarray(head.length))).toEqual([{ partial: true }])
  })

  it("ignores empty chunks", () => {
    const decoder = new CredentialLeaseFrameDecoder()
    expect(decoder.push(Buffer.alloc(0))).toEqual([])
    expect(decoder.bufferedBytes).toBe(0)
  })

  it("accepts a payload at the maximum frame size boundary", () => {
    const value = { padding: "x".repeat(MAX_FRAME_BYTES - 14) }
    expect(Buffer.byteLength(JSON.stringify(value), "utf8")).toBe(MAX_FRAME_BYTES)
    const decoder = new CredentialLeaseFrameDecoder()
    expect(decoder.push(frame(value))).toEqual([value])
  })

  it("rejects encoding an oversized payload", () => {
    const value = { padding: "x".repeat(MAX_FRAME_BYTES + 1) }
    expectInvalidRequest(() => frame(value))
  })

  it("rejects encoding an empty payload", () => {
    // JSON.stringify(undefined) yields undefined, so no payload bytes exist.
    expectInvalidRequest(() => frame(undefined))
  })

  it("rejects encoding an unserializable value", () => {
    const value: Record<string, unknown> = {}
    value.self = value
    expectInvalidRequest(() => frame(value))
  })
})

describe("credential lease frame decoder rejection paths", () => {
  it("rejects a zero-length frame prefix and clears its buffer", () => {
    const decoder = new CredentialLeaseFrameDecoder()
    expectInvalidRequest(() => decoder.push(Buffer.alloc(4)))
    expect(decoder.bufferedBytes).toBe(0)
  })

  it("rejects a frame prefix above the maximum size and clears its buffer", () => {
    const decoder = new CredentialLeaseFrameDecoder()
    const oversized = Buffer.alloc(4)
    oversized.writeUInt32BE(MAX_FRAME_BYTES + 1, 0)
    expectInvalidRequest(() => decoder.push(oversized))
    expect(decoder.bufferedBytes).toBe(0)
  })

  it("rejects a payload that is not valid JSON", () => {
    const decoder = new CredentialLeaseFrameDecoder()
    const payload = Buffer.from("{not json", "utf8")
    const header = Buffer.alloc(4)
    header.writeUInt32BE(payload.length, 0)
    expectInvalidRequest(() => decoder.push(Buffer.concat([header, payload])))
    expect(decoder.bufferedBytes).toBe(0)
  })

  it("keeps decoding later frames after a rejected frame reset the buffer", () => {
    const decoder = new CredentialLeaseFrameDecoder()
    const badPayload = Buffer.from("[1,2", "utf8")
    const badHeader = Buffer.alloc(4)
    badHeader.writeUInt32BE(badPayload.length, 0)
    expectInvalidRequest(() => decoder.push(Buffer.concat([badHeader, badPayload])))
    expect(decoder.push(frame({ recovered: true }))).toEqual([{ recovered: true }])
  })

  it("rejects an over-long prefix even when it arrives in pieces", () => {
    const decoder = new CredentialLeaseFrameDecoder()
    const oversized = Buffer.alloc(4)
    oversized.writeUInt32BE(0xffffffff, 0)
    expect(decoder.push(oversized.subarray(0, 2))).toEqual([])
    expectInvalidRequest(() => decoder.push(oversized.subarray(2)))
  })
})
