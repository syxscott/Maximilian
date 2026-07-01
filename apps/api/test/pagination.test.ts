/**
 * Pagination helper tests — covers cursor continuation, limit clamping,
 * stale-cursor fallback, and the empty case.
 */

import { describe, it, expect } from "vitest";
import { PaginationQuerySchema, paginate } from "../src/lib/pagination";

describe("PaginationQuerySchema", () => {
  it("defaults limit to 20 when omitted", () => {
    const parsed = PaginationQuerySchema.parse({});
    expect(parsed.limit).toBe(20);
    expect(parsed.cursor).toBeUndefined();
  });

  it("coerces string limit to number", () => {
    const parsed = PaginationQuerySchema.parse({ limit: "50" });
    expect(parsed.limit).toBe(50);
  });

  it("rejects limit > 100", () => {
    const parsed = PaginationQuerySchema.safeParse({ limit: 500 });
    expect(parsed.success).toBe(false);
  });

  it("rejects limit < 1", () => {
    const parsed = PaginationQuerySchema.safeParse({ limit: 0 });
    expect(parsed.success).toBe(false);
  });
});

describe("paginate", () => {
  it("returns the first page when no cursor is supplied", () => {
    const items = [1, 2, 3, 4, 5];
    const result = paginate(items, { cursor: undefined, limit: 2 });
    expect(result.items).toEqual([1, 2]);
    expect(result.nextCursor).toBe("2");
    expect(result.total).toBe(5);
  });

  it("resumes after the cursor", () => {
    const items = [1, 2, 3, 4, 5];
    const result = paginate(items, { cursor: "2", limit: 2 });
    expect(result.items).toEqual([3, 4]);
    expect(result.nextCursor).toBe("4");
  });

  it("returns no nextCursor when at the end", () => {
    const items = [1, 2, 3];
    const result = paginate(items, { cursor: "2", limit: 5 });
    expect(result.items).toEqual([3]);
    expect(result.nextCursor).toBeUndefined();
  });

  it("falls back to start when cursor is stale", () => {
    const items = [1, 2, 3];
    const result = paginate(items, { cursor: "missing", limit: 2 });
    expect(result.items).toEqual([1, 2]);
    expect(result.nextCursor).toBe("2");
  });

  it("uses getId for object arrays", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const result = paginate(items, { cursor: "a", limit: 1 }, (item) => item.id);
    expect(result.items).toEqual([{ id: "b" }]);
    expect(result.nextCursor).toBe("b");
  });

  it("handles empty input", () => {
    const result = paginate([], { cursor: undefined, limit: 10 });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeUndefined();
    expect(result.total).toBe(0);
  });
});
