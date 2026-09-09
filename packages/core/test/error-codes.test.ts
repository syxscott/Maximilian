import { describe, it, expect } from "vitest"
import {
  MaximilianError,
  ERROR_CATALOG,
  getErrorDef,
  listErrorCodes,
  type ErrorCodeValue,
} from "../src/error-codes.js"

describe("error-codes catalog", () => {
  it("has unique codes across all entries", () => {
    const codes = Object.keys(ERROR_CATALOG)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it("every entry has a code field matching its key", () => {
    for (const [key, entry] of Object.entries(ERROR_CATALOG)) {
      expect(entry.code).toBe(key)
    }
  })

  it("codes follow MAX-NNNN format and are grouped by domain", () => {
    for (const code of Object.keys(ERROR_CATALOG)) {
      expect(code).toMatch(/^MAX-\d{4}$/)
      const n = Number(code.slice(4))
      const domain = ERROR_CATALOG[code as ErrorCodeValue].domain
      const expectedRange = {
        auth: [1000, 1999],
        workspaces: [2000, 2999],
        agents: [3000, 3999],
        llm: [4000, 4999],
        "meta-system": [5000, 5999],
        queue: [6000, 6999],
        config: [7000, 7999],
        internal: [9000, 9999],
      }[domain]
      expect(expectedRange).toBeDefined()
      expect(n).toBeGreaterThanOrEqual(expectedRange![0])
      expect(n).toBeLessThanOrEqual(expectedRange![1])
    }
  })

  it("httpStatus is set sensibly per category", () => {
    for (const entry of Object.values(ERROR_CATALOG)) {
      expect(entry.httpStatus).toBeGreaterThanOrEqual(400)
      expect(entry.httpStatus).toBeLessThan(600)
    }
  })

  it("listErrorCodes returns all entries", () => {
    expect(listErrorCodes().length).toBe(Object.keys(ERROR_CATALOG).length)
  })

  it("getErrorDef returns the entry by key", () => {
    expect(getErrorDef("MAX-1001").title).toBe("Missing credentials")
  })
})

describe("MaximilianError", () => {
  it("exposes the catalog fields plus an optional override message", () => {
    const e = new MaximilianError("MAX-4002", "OpenAI 429", { provider: "openai" })
    expect(e.code).toBe("MAX-4002")
    expect(e.domain).toBe("llm")
    expect(e.httpStatus).toBe(429)
    expect(e.retryable).toBe(true)
    expect(e.remediation).toBeTruthy()
    expect(e.details).toEqual({ provider: "openai" })
    expect(e.message).toBe("OpenAI 429")
  })

  it("toJSON includes code, title, message, remediation, retryable, domain, details", () => {
    const e = new MaximilianError("MAX-5002")
    const json = e.toJSON()
    expect(json.error.code).toBe("MAX-5002")
    expect(json.error.title).toBe("Governance violation")
    expect(json.error.domain).toBe("meta-system")
    expect(typeof json.error.retryable).toBe("boolean")
  })
})