/**
 * Permission audit log — exercises the ring buffer + query semantics.
 *
 * The log is a bounded in-memory store; the runtime records an `ask` row
 * when a prompt is surfaced and an `allow`/`deny` row when the user
 * answers. Both rows share the same `requestId` so auditors can pair them.
 */

import { describe, it, expect } from "vitest";
import { PermissionAuditLog } from "../src/permission-audit";

function mkEntry(opts: {
  at: string;
  requestId?: string;
  tool?: string;
  workspaceId?: string;
  decision?: "ask" | "allow" | "deny";
}) {
  return {
    at: opts.at,
    requestId: opts.requestId ?? "",
    workspaceId: opts.workspaceId ?? "ws-1",
    taskId: "t-1",
    tool: opts.tool ?? "bash",
    target: "/tmp/x",
    decision: opts.decision ?? "ask",
  };
}

describe("PermissionAuditLog", () => {
  it("records entries and returns them in chronological order", () => {
    const log = new PermissionAuditLog(100);
    log.record(mkEntry({ at: "2026-01-01T00:00:00Z", requestId: "r1" }));
    log.record(mkEntry({ at: "2026-01-01T00:00:01Z", requestId: "r1", decision: "allow" }));
    log.record(mkEntry({ at: "2026-01-01T00:00:02Z", requestId: "r2" }));

    const rows = log.query();
    expect(rows.length).toBe(3);
    expect(rows[0]!.at).toBe("2026-01-01T00:00:00Z");
    expect(rows[2]!.at).toBe("2026-01-01T00:00:02Z");
  });

  it("caps results at the requested limit, newest first", () => {
    const log = new PermissionAuditLog(100);
    for (let i = 0; i < 10; i++) {
      log.record(mkEntry({ at: `2026-01-01T00:00:${i.toString().padStart(2, "0")}Z`, requestId: `r${i}` }));
    }
    const rows = log.query({ limit: 3 });
    expect(rows.length).toBe(3);
    // Newest first → reversed to chronological for display, so the last 3
    // entries are r7, r8, r9 in chronological order.
    expect(rows[0]!.requestId).toBe("r7");
    expect(rows[2]!.requestId).toBe("r9");
  });

  it("filters by tool and workspaceId", () => {
    const log = new PermissionAuditLog(100);
    log.record(mkEntry({ at: "2026-01-01T00:00:00Z", requestId: "r1", tool: "bash", workspaceId: "ws-1" }));
    log.record(mkEntry({ at: "2026-01-01T00:00:01Z", requestId: "r2", tool: "write", workspaceId: "ws-1" }));
    log.record(mkEntry({ at: "2026-01-01T00:00:02Z", requestId: "r3", tool: "bash", workspaceId: "ws-2" }));

    expect(log.query({ tool: "bash" }).length).toBe(2);
    expect(log.query({ workspaceId: "ws-1" }).length).toBe(2);
    expect(log.query({ tool: "bash", workspaceId: "ws-2" }).length).toBe(1);
  });

  it("returns entries with at >= since", () => {
    const log = new PermissionAuditLog(100);
    log.record(mkEntry({ at: "2026-01-01T00:00:00Z", requestId: "r1" }));
    log.record(mkEntry({ at: "2026-01-01T00:00:05Z", requestId: "r2" }));
    log.record(mkEntry({ at: "2026-01-01T00:00:10Z", requestId: "r3" }));

    const rows = log.query({ since: "2026-01-01T00:00:05Z" });
    expect(rows.length).toBe(2);
    expect(rows[0]!.requestId).toBe("r2");
  });

  it("evicts oldest entries when capacity is exceeded", () => {
    const log = new PermissionAuditLog(3);
    log.record(mkEntry({ at: "2026-01-01T00:00:00Z", requestId: "r1" }));
    log.record(mkEntry({ at: "2026-01-01T00:00:01Z", requestId: "r2" }));
    log.record(mkEntry({ at: "2026-01-01T00:00:02Z", requestId: "r3" }));
    log.record(mkEntry({ at: "2026-01-01T00:00:03Z", requestId: "r4" }));

    expect(log.size()).toBe(3);
    const rows = log.query();
    expect(rows[0]!.requestId).toBe("r2");
    expect(rows[2]!.requestId).toBe("r4");
  });

  it("getByRequestId returns all matching entries for a requestId", () => {
    const log = new PermissionAuditLog(100);
    log.record(mkEntry({ at: "2026-01-01T00:00:00Z", requestId: "r1" }));
    log.record(mkEntry({ at: "2026-01-01T00:00:01Z", requestId: "r2" }));
    log.record(mkEntry({ at: "2026-01-01T00:00:02Z", requestId: "r1", decision: "allow" }));

    // Returns BOTH the ask and the allow row, in chronological order.
    const rows = log.getByRequestId("r1");
    expect(rows.length).toBe(2);
    expect(rows[0]!.decision).toBe("ask");
    expect(rows[1]!.decision).toBe("allow");
    expect(log.getByRequestId("missing")).toEqual([]);
  });

  it("getByRequestId still finds the allow row after the ask row is evicted", () => {
    // Regression: the old requestLookup map deleted the requestId entry
    // when the ask row was evicted, even though the matching allow row
    // was still in the buffer. This test pins the fix.
    const log = new PermissionAuditLog(3);
    log.record(mkEntry({ at: "2026-01-01T00:00:00Z", requestId: "r1" }));
    log.record(mkEntry({ at: "2026-01-01T00:00:01Z", requestId: "r1", decision: "allow" }));
    // Fill past capacity so the ask row (r1@00:00) gets evicted but the
    // allow row (r1@00:01) stays.
    log.record(mkEntry({ at: "2026-01-01T00:00:02Z", requestId: "r2" }));
    log.record(mkEntry({ at: "2026-01-01T00:00:03Z", requestId: "r3" }));

    const rows = log.getByRequestId("r1");
    expect(rows.length).toBe(1);
    expect(rows[0]!.decision).toBe("allow");
  });

  it("countMatching returns total filtered count ignoring limit", () => {
    const log = new PermissionAuditLog(100);
    log.record(mkEntry({ at: "2026-01-01T00:00:00Z", requestId: "r1", tool: "bash" }));
    log.record(mkEntry({ at: "2026-01-01T00:00:01Z", requestId: "r2", tool: "write" }));
    log.record(mkEntry({ at: "2026-01-01T00:00:02Z", requestId: "r3", tool: "bash" }));

    expect(log.countMatching({ tool: "bash" })).toBe(2);
    expect(log.countMatching({})).toBe(3);
  });

  it("clamps limit to MAX_LIMIT (1000)", () => {
    const log = new PermissionAuditLog(2000);
    for (let i = 0; i < 1500; i++) {
      log.record(mkEntry({ at: `2026-01-01T00:00:${(i % 60).toString().padStart(2, "0")}Z`, requestId: `r${i}` }));
    }
    const rows = log.query({ limit: 5000 });
    expect(rows.length).toBe(1000);
  });
});
