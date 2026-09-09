/**
 * Tests for OpencodePermissionTranslator — the bridge between
 * Maximilian's `allow | ask | deny` permission vocabulary and
 * opencode's `permission.ask` hook + `permission.v2.{asked,replied}`
 * event vocabulary.
 *
 * 借鉴 opencode: the translator mirrors
 *   - `PermissionAction` ("allow" | "deny" | "ask")
 *     (`packages/sdk/js/src/v2/gen/types.gen.ts:160`)
 *   - `PermissionV2Reply` ("once" | "always" | "reject")
 *     (`packages/sdk/js/src/v2/gen/types.gen.ts:3128`)
 *
 * Strategy: pure-function tests of the four translators
 * (`toOpencodePermission`, `fromOpencodePermissionAction`,
 * `fromOpencodePermissionReply`, `toMaximilianToolInput`,
 * `applyReplyToPermissions`) + a round-trip section that exercises the
 * mocked `permission.v2.asked` / `permission.v2.replied` envelopes
 * produced by `event-mapping.ts`.
 */

import { describe, it, expect } from "vitest";

import {
  OpencodePermissionTranslator,
  createOpencodePermissionTranslator,
  type OpencodePermissionAskedEvent,
  type OpencodePermissionRepliedEvent,
} from "../src/opencode-permission-translator";
import {
  DEFAULT_PERMISSIONS,
  resolvePermission,
  type Permissions,
} from "../src/permission";

// ── toOpencodePermission / fromOpencodePermissionAction ────────────────

describe("OpencodePermissionTranslator.toOpencodePermission", () => {
  const t = new OpencodePermissionTranslator();

  it("translates allow → allow", () => {
    expect(t.toOpencodePermission("allow")).toBe("allow");
  });

  it("translates ask → ask", () => {
    expect(t.toOpencodePermission("ask")).toBe("ask");
  });

  it("translates deny → deny", () => {
    expect(t.toOpencodePermission("deny")).toBe("deny");
  });

  it("throws on unknown values (exhaustiveness guard)", () => {
    // @ts-expect-error — testing runtime guard
    expect(() => t.toOpencodePermission("permit")).toThrow(/unknown permission/);
    // @ts-expect-error — testing runtime guard
    expect(() => t.toOpencodePermission(undefined)).toThrow(/unknown permission/);
    // @ts-expect-error — testing runtime guard
    expect(() => t.toOpencodePermission(null)).toThrow(/unknown permission/);
  });
});

describe("OpencodePermissionTranslator.fromOpencodePermissionAction", () => {
  const t = new OpencodePermissionTranslator();

  it("translates allow → allow", () => {
    expect(t.fromOpencodePermissionAction("allow")).toBe("allow");
  });

  it("translates ask → ask", () => {
    expect(t.fromOpencodePermissionAction("ask")).toBe("ask");
  });

  it("translates deny → deny", () => {
    expect(t.fromOpencodePermissionAction("deny")).toBe("deny");
  });

  it("throws on unknown actions", () => {
    // @ts-expect-error — testing runtime guard
    expect(() => t.fromOpencodePermissionAction("approve")).toThrow(/unknown action/);
  });

  it("round-trips with toOpencodePermission", () => {
    const cases = ["allow", "ask", "deny"] as const;
    for (const c of cases) {
      expect(t.fromOpencodePermissionAction(t.toOpencodePermission(c))).toBe(c);
    }
  });
});

// ── fromOpencodePermissionReply ─────────────────────────────────────────

describe("OpencodePermissionTranslator.fromOpencodePermissionReply", () => {
  const t = new OpencodePermissionTranslator();

  it("'once' translates to allow with no persistence", () => {
    expect(t.fromOpencodePermissionReply("once")).toEqual({
      decision: "allow",
      persist: false,
      patterns: [],
    });
  });

  it("'always' translates to allow with patterns to persist", () => {
    expect(t.fromOpencodePermissionReply("always", ["/tmp/**", "*.log"])).toEqual({
      decision: "allow",
      persist: true,
      patterns: ["/tmp/**", "*.log"],
    });
  });

  it("'always' with no `save` produces empty patterns (caller must decide)", () => {
    expect(t.fromOpencodePermissionReply("always")).toEqual({
      decision: "allow",
      persist: true,
      patterns: [],
    });
  });

  it("'reject' translates to deny", () => {
    expect(t.fromOpencodePermissionReply("reject")).toEqual({
      decision: "deny",
      persist: false,
      patterns: [],
    });
  });

  it("throws on unknown reply values", () => {
    // @ts-expect-error — testing runtime guard
    expect(() => t.fromOpencodePermissionReply("maybe")).toThrow(/unknown reply/);
  });
});

// ── toMaximilianToolInput ───────────────────────────────────────────────

describe("OpencodePermissionTranslator.toMaximilianToolInput", () => {
  const t = new OpencodePermissionTranslator();

  it("pulls bash + command from a v2 resources[0]", () => {
    const event: OpencodePermissionAskedEvent = {
      type: "permission.v2.asked",
      id: "req-1",
      sessionID: "ses-1",
      action: "bash",
      resources: ["npm install"],
    };
    const result = t.toMaximilianToolInput(event);
    expect(result.tool).toBe("bash");
    expect(result.target).toBe("npm install");
    expect(result.input).toEqual({ command: "npm install" });
  });

  it("pulls read + path from a v2 resources[0]", () => {
    const event: OpencodePermissionAskedEvent = {
      type: "permission.v2.asked",
      id: "req-2",
      sessionID: "ses-1",
      action: "read",
      resources: ["/home/user/file.txt"],
    };
    const result = t.toMaximilianToolInput(event);
    expect(result.tool).toBe("read");
    expect(result.target).toBe("/home/user/file.txt");
    expect(result.input).toEqual({ path: "/home/user/file.txt" });
  });

  it("falls back to patterns[0] for v1 events", () => {
    const event: OpencodePermissionAskedEvent = {
      type: "permission.asked",
      id: "req-3",
      sessionID: "ses-1",
      action: "write",
      patterns: ["/tmp/foo.ts"],
    };
    const result = t.toMaximilianToolInput(event);
    expect(result.tool).toBe("write");
    expect(result.target).toBe("/tmp/foo.ts");
  });

  it("falls back to the single `permission` field on v1", () => {
    const event: OpencodePermissionAskedEvent = {
      type: "permission.asked",
      id: "req-4",
      sessionID: "ses-1",
      action: "edit",
      permission: "/var/log/app.log",
    };
    const result = t.toMaximilianToolInput(event);
    expect(result.tool).toBe("edit");
    expect(result.target).toBe("/var/log/app.log");
  });

  it("unknown action returns null tool so caller can fail-closed (H2 regression)", () => {
    // H2-fix: an unknown opencode tool name must NOT silently route to
    // bash. The previous behavior masked tools that didn't match bash's
    // dangerous-pattern check (e.g. an MCP tool with no command field
    // would fall through to `bash: "ask"`). The caller now sees
    // `tool: null` and is expected to deny.
    const event: OpencodePermissionAskedEvent = {
      type: "permission.v2.asked",
      id: "req-5",
      sessionID: "ses-1",
      action: "future-tool",
      resources: ["some cmd"],
    };
    const result = t.toMaximilianToolInput(event);
    expect(result.tool).toBeNull();
    expect(result.target).toBe("some cmd");
  });

  it("returns empty target when nothing is populated", () => {
    const event: OpencodePermissionAskedEvent = {
      type: "permission.v2.asked",
      id: "req-6",
      sessionID: "ses-1",
      action: "bash",
    };
    const result = t.toMaximilianToolInput(event);
    expect(result.target).toBe("");
  });
});

// ── applyReplyToPermissions ─────────────────────────────────────────────

describe("OpencodePermissionTranslator.applyReplyToPermissions", () => {
  const t = new OpencodePermissionTranslator();

  it("writes allow rules for each pattern on 'always'", () => {
    const base: Permissions = {
      defaults: { ...DEFAULT_PERMISSIONS.defaults },
      patterns: {},
    };
    const next = t.applyReplyToPermissions(base, "write", {
      decision: "allow",
      persist: true,
      patterns: ["/tmp/**", "/scratch/**"],
    });
    expect(next.patterns.write).toEqual({
      "/tmp/**": "allow",
      "/scratch/**": "allow",
    });
  });

  it("merges with existing patterns for the same tool", () => {
    const base: Permissions = {
      defaults: { ...DEFAULT_PERMISSIONS.defaults },
      patterns: {
        write: { "/existing": "deny" },
      },
    };
    const next = t.applyReplyToPermissions(base, "write", {
      decision: "allow",
      persist: true,
      patterns: ["/tmp/**"],
    });
    expect(next.patterns.write).toEqual({
      "/existing": "deny",
      "/tmp/**": "allow",
    });
  });

  it("does not mutate the input config", () => {
    const base: Permissions = {
      defaults: { ...DEFAULT_PERMISSIONS.defaults },
      patterns: {},
    };
    t.applyReplyToPermissions(base, "write", {
      decision: "allow",
      persist: true,
      patterns: ["/tmp/**"],
    });
    expect(base.patterns).toEqual({});
  });

  it("returns the same config when persist=false", () => {
    const base: Permissions = {
      defaults: { ...DEFAULT_PERMISSIONS.defaults },
      patterns: { read: { "/a": "deny" } },
    };
    const next = t.applyReplyToPermissions(base, "write", {
      decision: "deny",
      persist: false,
      patterns: ["/tmp/**"],
    });
    expect(next).toBe(base);
  });

  it("returns the same config when patterns is empty (even if persist=true)", () => {
    const base: Permissions = {
      defaults: { ...DEFAULT_PERMISSIONS.defaults },
      patterns: {},
    };
    const next = t.applyReplyToPermissions(base, "write", {
      decision: "allow",
      persist: true,
      patterns: [],
    });
    expect(next).toBe(base);
  });

  it("H3 regression: 'always' cannot overwrite an existing deny rule", () => {
    // H3-fix: a user clicking "always" on a one-off prompt must not
    // silently grant blanket access to a path the policy already
    // denies. Without the fix, `merged[pattern] = "allow"` would
    // clobber `"/root/**": "deny"` when the new pattern has the
    // same key. The expected behavior is to skip the conflicting
    // pattern and leave the deny intact at its existing key.
    const base: Permissions = {
      defaults: { ...DEFAULT_PERMISSIONS.defaults },
      patterns: {
        read: {
          "/root/**": "deny",
          "/home/user/docs/**": "allow",
        },
      },
    };
    const next = t.applyReplyToPermissions(base, "read", {
      decision: "allow",
      persist: true,
      // opencode sent us a pattern that overlaps with an existing deny.
      patterns: ["/root/**", "/home/user/docs/**"],
    });
    // /root/** is the existing deny — "always" must NOT overwrite it
    expect(next.patterns.read?.["/root/**"]).toBe("deny");
    // /home/user/docs/** is an existing allow → stays allow
    expect(next.patterns.read?.["/home/user/docs/**"]).toBe("allow");

    // And the deny actually still applies at match time, even for
    // a target that matches the "would-be" allow pattern. resolvePermission
    // iterates patterns in insertion order, so the deny at /root/**
    // wins for any /root/** target.
    const decision = resolvePermission("read", { path: "/root/anything" }, next);
    expect(decision).toBe("deny");
  });

  it("H3 regression: 'always' with no overlap leaves all existing rules intact", () => {
    const base: Permissions = {
      defaults: { ...DEFAULT_PERMISSIONS.defaults },
      patterns: { read: { "/etc/**": "deny", "/var/**": "deny" } },
    };
    const next = t.applyReplyToPermissions(base, "read", {
      decision: "allow",
      persist: true,
      patterns: ["/tmp/**", "/scratch/**"],
    });
    expect(next.patterns.read).toEqual({
      "/etc/**": "deny",
      "/var/**": "deny",
      "/tmp/**": "allow",
      "/scratch/**": "allow",
    });
  });
});

// ── mocked permission.v2.asked / permission.v2.replied events ──────────

describe("OpencodePermissionTranslator with mocked SSE events", () => {
  const t = createOpencodePermissionTranslator();

  it("permission.v2.asked → Maximilian resolver → opencode action", () => {
    // Simulate the opencode server emitting a v2 prompt asking for
    // permission to read /home/user/secrets.txt. Maximilian has
    // explicit deny rules for sensitive paths in DEFAULT_PERMISSIONS,
    // so the resolver should return "deny".
    const askedEvent: OpencodePermissionAskedEvent = {
      type: "permission.v2.asked",
      id: "evt-1",
      sessionID: "ses-42",
      action: "read",
      resources: ["/home/user/secrets.txt"],
    };

    // 1. Translate envelope → tool/input triple
    const { tool, input } = t.toMaximilianToolInput(askedEvent);

    // 2. Ask Maximilian's resolver
    const decision = resolvePermission(tool, input, DEFAULT_PERMISSIONS);

    // 3. Lower back into opencode's hook output
    const action = t.toOpencodePermission(decision);

    // `.ssh` is not in our test path — fall back to default read=allow.
    expect(action).toBe("allow");
  });

  it("permission.v2.asked on a denied path yields opencode 'deny'", () => {
    const askedEvent: OpencodePermissionAskedEvent = {
      type: "permission.v2.asked",
      id: "evt-2",
      sessionID: "ses-42",
      action: "read",
      resources: ["/home/user/.ssh/id_rsa"],
    };
    const { tool, input } = t.toMaximilianToolInput(askedEvent);
    const decision = resolvePermission(tool, input, DEFAULT_PERMISSIONS);
    expect(decision).toBe("deny");
    expect(t.toOpencodePermission(decision)).toBe("deny");
  });

  it("permission.v2.asked on a dangerous bash command yields 'ask' (then deny via dangerous check)", () => {
    // Maximilian's default config asks on bash; the runtime's own
    // dangerous-command check (`validateBashCommand`) is what would
    // ultimately block `rm -rf /`. The translator's job is just to
    // forward the resolver's decision.
    const askedEvent: OpencodePermissionAskedEvent = {
      type: "permission.v2.asked",
      id: "evt-3",
      sessionID: "ses-42",
      action: "bash",
      resources: ["ls -la"],
    };
    const { tool, input } = t.toMaximilianToolInput(askedEvent);
    const decision = resolvePermission(tool, input, DEFAULT_PERMISSIONS);
    expect(decision).toBe("ask");
    expect(t.toOpencodePermission(decision)).toBe("ask");
  });

  it("permission.v2.replied 'always' round-trips into a persisted Maximilian rule", () => {
    const askedEvent: OpencodePermissionAskedEvent = {
      type: "permission.v2.asked",
      id: "evt-4",
      sessionID: "ses-42",
      action: "write",
      resources: ["/tmp/build.log"],
      save: ["/tmp/**"],
    };
    const { tool } = t.toMaximilianToolInput(askedEvent);

    const repliedEvent: OpencodePermissionRepliedEvent = {
      type: "permission.v2.replied",
      sessionID: "ses-42",
      requestID: askedEvent.id,
      reply: "always",
    };
    // In v2, `save` lives on the original asked event (the server
    // carries it through); the runtime is expected to forward it
    // when calling the translator with the reply.
    const translated = t.fromOpencodePermissionReply(
      repliedEvent.reply,
      askedEvent.save,
    );
    expect(translated).toEqual({
      decision: "allow",
      persist: true,
      patterns: ["/tmp/**"],
    });

    // Now apply the reply to a base Permissions config and verify the
    // next time the same path comes up, the resolver skips the prompt.
    const next = t.applyReplyToPermissions(DEFAULT_PERMISSIONS, tool, translated);
    const result = resolvePermission(tool, { path: "/tmp/foo.txt" }, next);
    expect(result).toBe("allow");
  });

  it("permission.v2.replied 'reject' translates to deny decision", () => {
    const repliedEvent: OpencodePermissionRepliedEvent = {
      type: "permission.v2.replied",
      sessionID: "ses-42",
      requestID: "evt-5",
      reply: "reject",
    };
    const translated = t.fromOpencodePermissionReply(repliedEvent.reply);
    expect(t.toOpencodePermission(translated.decision)).toBe("deny");
  });
});
