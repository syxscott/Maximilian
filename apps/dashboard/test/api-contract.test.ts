// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * API-contract drift guard (opencode httpapi-codegen borrowing, check
 * form): the dashboard's client can never call a route the backend does
 * not serve, and the committed generated contract must track the
 * backend's committed OpenAPI path list.
 */

import { describe, it, expect } from "vitest"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import {
  generateContractSource,
  extractClientCalls,
  matchesContract,
} from "../scripts/generate-api-contract.mjs"
import { API_PATHS, API_PATH_COUNT } from "../src/api-contract"

const API_TS = join(__dirname, "..", "src", "api.ts")

describe("dashboard API contract", () => {
  it("the committed api-contract.ts matches a fresh generation", () => {
    const fresh = generateContractSource()
    const committed = readFileSync(join(__dirname, "..", "src", "api-contract.ts"), "utf8")
    expect(committed).toBe(fresh)
  })

  it("every path the client calls exists in the backend contract", () => {
    const calls = extractClientCalls(API_TS)
    expect(calls.length).toBeGreaterThan(5)
    const unmatched = calls.filter(
      (call) => !API_PATHS.some((entry) => matchesContract(call, entry)),
    )
    expect(unmatched).toEqual([])
  })

  it("normalization matches parameterized routes in both directions", () => {
    expect(matchesContract("/workspaces/{param}", "GET /workspaces/{id}")).toBe(true)
    expect(
      matchesContract(
        "/workspaces/{param}/artifacts/{param}",
        "GET /workspaces/{id}/artifacts/{name}",
      ),
    ).toBe(true)
    expect(matchesContract("/workspaces", "GET /workspaces")).toBe(true)
    // Literal segments must match exactly.
    expect(matchesContract("/workspace/{param}", "GET /workspaces/{id}")).toBe(false)
  })

  it("the contract is non-trivial", () => {
    expect(API_PATH_COUNT).toBeGreaterThan(50)
  })
})
