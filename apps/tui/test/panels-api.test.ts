/**
 * Wiring tests for the new panel client functions in `src/api.ts`
 * (listJobs / deleteJob / triggerJob / listWorkspaces / getWorkspace).
 * Same stubbed-fetch style as api.test.ts: we verify URL / method /
 * headers construction; response validation stays with the API server.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createMaximilianClient } from "../src/api"

function makeResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: "OK",
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response
}

describe("panel client functions", () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it("lists jobs via GET /api/jobs with the bearer header", async () => {
    const fetchMock = vi.fn(async () => Promise.resolve(makeResponse({ jobs: [], total: 0 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = createMaximilianClient("http://localhost:3001", "tok")
    const result = await client.listJobs()

    const call = fetchMock.mock.calls[0]!
    expect(call[0]).toBe("http://localhost:3001/api/jobs")
    expect((call[1] as RequestInit).method).toBe("GET")
    expect(((call[1] as RequestInit).headers as Record<string, string>)["authorization"]).toBe(
      "Bearer tok",
    )
    expect(result).toEqual({ jobs: [], total: 0 })
  })

  it("deletes a job via DELETE /api/jobs/{id} with URL-encoded id and no body", async () => {
    const fetchMock = vi.fn(async () => Promise.resolve(makeResponse(undefined, { status: 204 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = createMaximilianClient("http://localhost:3001")
    await client.deleteJob("job a/b")

    const call = fetchMock.mock.calls[0]!
    expect(call[0]).toBe("http://localhost:3001/api/jobs/job%20a%2Fb")
    expect((call[1] as RequestInit).method).toBe("DELETE")
    expect((call[1] as RequestInit).body).toBeUndefined()
  })

  it("triggers a job via POST /api/jobs/{id}/trigger with no body", async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(makeResponse({ ok: true, job: { id: "job_1", triggerCount: 1 } })),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = createMaximilianClient("http://localhost:3001")
    const result = await client.triggerJob("job_1")

    const call = fetchMock.mock.calls[0]!
    expect(call[0]).toBe("http://localhost:3001/api/jobs/job_1/trigger")
    expect((call[1] as RequestInit).method).toBe("POST")
    expect((call[1] as RequestInit).body).toBeUndefined()
    expect(result.ok).toBe(true)
  })

  it("lists workspace ids and fetches one workspace passthrough object", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse({ items: ["ws-1", "ws-2"], total: 2 }))
      .mockResolvedValueOnce(makeResponse({ id: "ws-1", userRequest: "hi", status: "running" }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = createMaximilianClient("http://localhost:3001")
    const list = await client.listWorkspaces()
    const ws = await client.getWorkspace("ws-1")

    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:3001/api/workspaces?limit=20")
    expect(fetchMock.mock.calls[1]![0]).toBe("http://localhost:3001/api/workspaces/ws-1")
    expect(list.items).toEqual(["ws-1", "ws-2"])
    expect(ws).toEqual({ id: "ws-1", userRequest: "hi", status: "running" })
  })

  it("surfaces delete failures as an Error (404 path)", async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(makeResponse("Unknown job: nope", { ok: false, status: 404 })),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = createMaximilianClient("http://localhost:3001")
    await expect(client.deleteJob("nope")).rejects.toThrow(/404.*Unknown job/)
  })

  it("exposes the full client surface including the three new panel domains", () => {
    const client = createMaximilianClient("http://localhost:3001")
    expect(typeof client.listJobs).toBe("function")
    expect(typeof client.deleteJob).toBe("function")
    expect(typeof client.triggerJob).toBe("function")
    expect(typeof client.listWorkspaces).toBe("function")
    expect(typeof client.getWorkspace).toBe("function")
  })
})
