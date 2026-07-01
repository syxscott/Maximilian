/**
 * Tests for @max/sdk.
 *
 * Covers the stub client surface so future expansions of the SDK have a
 * regression net to anchor against.
 */
import { describe, it, expect } from "vitest";
import { createClient, default as defaultExport } from "../src/client.js";

describe("createClient (stub)", () => {
  it("returns a plain object when no config is given", () => {
    const client = createClient();
    expect(typeof client).toBe("object");
  });

  it("ignores arbitrary config until the surface grows", () => {
    const client = createClient({ baseUrl: "https://example.test", token: "x" });
    expect(typeof client).toBe("object");
  });

  it("the default export points at the same factory", () => {
    expect(defaultExport).toBe(createClient);
  });
});