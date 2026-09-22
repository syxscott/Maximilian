import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  assertCredentialLeaseClientEndpoint,
  CredentialLeaseProtocolError,
  resolveCredentialLeaseEndpoint,
} from "../src/index.js"

describe("resolveCredentialLeaseEndpoint", () => {
  it("derives the socket and capability file under <stateDir>/run", () => {
    const endpoint = resolveCredentialLeaseEndpoint("/home/user/.maximilian")
    expect(endpoint).toEqual({
      transport: "unix",
      endpoint: path.resolve("/home/user/.maximilian", "run", "credential-lease-v1.sock"),
      capabilityFile: path.resolve("/home/user/.maximilian", "run", "credential-lease-v1.cap"),
    })
    expect(path.dirname(endpoint.endpoint)).toBe(path.dirname(endpoint.capabilityFile))
  })

  it("normalizes trailing separators and duplicate slashes", () => {
    const endpoint = resolveCredentialLeaseEndpoint("/tmp/max//")
    expect(endpoint.endpoint).toBe(path.resolve("/tmp/max", "run", "credential-lease-v1.sock"))
  })

  it("accepts the filesystem root", () => {
    const endpoint = resolveCredentialLeaseEndpoint(path.parse("/tmp").root)
    expect(path.basename(endpoint.endpoint)).toBe("credential-lease-v1.sock")
  })

  it("rejects relative state directories", () => {
    expect(() => resolveCredentialLeaseEndpoint("relative/state")).toThrow(TypeError)
    expect(() => resolveCredentialLeaseEndpoint("./state")).toThrow(TypeError)
  })
})

describe("assertCredentialLeaseClientEndpoint", () => {
  const runDir = "/tmp/max/run"
  const valid = [
    path.join(runDir, "credential-lease-v1.sock"),
    path.join(runDir, "credential-lease-v1.cap"),
  ]

  it("accepts a socket and capability file in one run directory", () => {
    expect(() => assertCredentialLeaseClientEndpoint(valid[0]!, valid[1]!)).not.toThrow()
  })

  it("rejects relative paths", () => {
    expect(() =>
      assertCredentialLeaseClientEndpoint("run/credential-lease-v1.sock", valid[1]!),
    ).toThrow(CredentialLeaseProtocolError)
    expect(() =>
      assertCredentialLeaseClientEndpoint(valid[0]!, "run/credential-lease-v1.cap"),
    ).toThrow(CredentialLeaseProtocolError)
  })

  it("rejects unexpected file names", () => {
    expect(() =>
      assertCredentialLeaseClientEndpoint(path.join(runDir, "other.sock"), valid[1]!),
    ).toThrow(CredentialLeaseProtocolError)
    expect(() =>
      assertCredentialLeaseClientEndpoint(valid[0]!, path.join(runDir, "other.cap")),
    ).toThrow(CredentialLeaseProtocolError)
  })

  it("rejects a socket and capability file split across directories", () => {
    expect(() =>
      assertCredentialLeaseClientEndpoint(
        valid[0]!,
        path.join("/tmp/elsewhere", "credential-lease-v1.cap"),
      ),
    ).toThrow(TypeError)
    expect(() =>
      assertCredentialLeaseClientEndpoint(
        valid[0]!,
        path.join("/tmp/elsewhere", "credential-lease-v1.cap"),
      ),
    ).toThrow("must share one run directory")
  })
})
