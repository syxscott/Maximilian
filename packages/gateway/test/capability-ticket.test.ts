// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for CapabilityTicket (ZCode borrowing): one-time, short-TTL
 * elevation credentials — consumed on use, replay impossible.
 */
import { describe, it, expect } from "vitest"
import { CapabilityTicketStore } from "../src/capability-ticket.js"

describe("CapabilityTicketStore", () => {
  it("mints and consumes a ticket once", () => {
    const store = new CapabilityTicketStore({ ttlMs: 30_000 })
    const ticket = store.mint("host-elevation")
    expect(store.consume(ticket)).toBe("host-elevation")
    expect(store.consume(ticket)).toBeNull() // replay impossible
  })

  it("expires tickets past the TTL", () => {
    let t = 1_000
    const store = new CapabilityTicketStore({ ttlMs: 5_000, now: () => t })
    const ticket = store.mint("host-elevation")
    t += 6_000
    expect(store.consume(ticket)).toBeNull()
  })

  it("prunes expired tickets", () => {
    let t = 1_000
    const store = new CapabilityTicketStore({ ttlMs: 5_000, now: () => t })
    store.mint("s1")
    t += 6_000
    store.mint("s2")
    expect(store.size).toBe(1)
  })

  it("tickets are scoped", () => {
    const store = new CapabilityTicketStore({ ttlMs: 5_000 })
    const ticket = store.mint("host-elevation")
    expect(store.consume(ticket + "x")).toBeNull()
  })
})
