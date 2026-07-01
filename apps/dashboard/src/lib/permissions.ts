/**
 * Permissions — frontend mirror of the on-disk `Permissions` config the
 * runtime gate consults before letting any tool call through.
 *
 * - `usePermissions()` fetches + caches the current config, exposes save()
 * - `usePermissionPrompt()` subscribes to the workspace SSE stream and
 *   surfaces a `permission-request` event as a pending prompt; the
 *   `answer(decision)` helper hits the `/api/permissions/answer` endpoint
 *   which unblocks the runtime.
 *
 * The actual matrix UI lives in `components/PermissionsMatrix.tsx`. The
 * modal lives in `components/PermissionDialog.tsx`. This file just owns
 * the API surface and the in-memory cache.
 */

import { useCallback, useEffect, useState } from "react";
import { BASE, fetchJson, authHeaders, z } from "../api";

export type Permission = "allow" | "ask" | "deny";
export const TOOL_NAMES = ["bash", "read", "write", "edit", "glob", "grep"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface Permissions {
  defaults: Record<ToolName, Permission>;
  patterns: Partial<Record<ToolName, Record<string, Permission>>>;
}

export const DEFAULT_PERMISSIONS: Permissions = {
  defaults: {
    bash: "ask",
    write: "ask",
    edit: "ask",
    read: "allow",
    glob: "allow",
    grep: "allow",
  },
  patterns: {},
};

// ── REST client ──────────────────────────────────────────────────────────

const permSchema = z
  .object({
    defaults: z.record(z.union([z.literal("allow"), z.literal("ask"), z.literal("deny")])),
    patterns: z.record(z.record(z.union([z.literal("allow"), z.literal("ask"), z.literal("deny")]))),
  })
  .passthrough();

const testSchema = z.object({ pattern: z.string(), value: z.string(), matches: z.boolean() });
const answerSchema = z.object({
  requestId: z.string(),
  decision: z.union([z.literal("allow"), z.literal("deny")]),
});

export const permissionsApi = {
  get: (signal?: AbortSignal): Promise<Permissions> =>
    fetchJson(`${BASE}/permissions`, { headers: authHeaders(), signal }, permSchema) as Promise<Permissions>,

  put: (config: Permissions, signal?: AbortSignal): Promise<Permissions> =>
    fetchJson(
      `${BASE}/permissions`,
      {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(config),
        signal,
      },
      permSchema,
    ) as Promise<Permissions>,

  reset: (signal?: AbortSignal): Promise<Permissions> =>
    fetchJson(
      `${BASE}/permissions/reset`,
      { method: "POST", headers: authHeaders(), signal },
      permSchema,
    ) as Promise<Permissions>,

  test: (pattern: string, value: string, signal?: AbortSignal): Promise<{ matches: boolean }> =>
    fetchJson(
      `${BASE}/permissions/test`,
      {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ pattern, value }),
        signal,
      },
      testSchema,
    ) as Promise<{ matches: boolean }>,

  answer: (requestId: string, decision: "allow" | "deny", signal?: AbortSignal): Promise<{ requestId: string; decision: "allow" | "deny" }> =>
    fetchJson(
      `${BASE}/permissions/answer`,
      {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, decision }),
        signal,
      },
      answerSchema,
    ) as Promise<{ requestId: string; decision: "allow" | "deny" }>,
};

// ── Hooks ────────────────────────────────────────────────────────────────

export interface UsePermissionsResult {
  config: Permissions;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  save: (next: Permissions) => Promise<void>;
  reset: () => Promise<void>;
}

/**
 * Load + cache the persisted config. Falls back to defaults on error so the
 * UI never has to handle a half-loaded state.
 */
export function usePermissions(): UsePermissionsResult {
  const [config, setConfig] = useState<Permissions>(DEFAULT_PERMISSIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await permissionsApi.get();
      setConfig(normalise(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfig(DEFAULT_PERMISSIONS);
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(async (next: Permissions) => {
    setError(null);
    const persisted = await permissionsApi.put(normalise(next));
    setConfig(normalise(persisted));
  }, []);

  const reset = useCallback(async () => {
    const next = await permissionsApi.reset();
    setConfig(normalise(next));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { config, loading, error, reload, save, reset };
}

/**
 * Hook used by `PermissionDialog` — receives a `pending` prompt from the
 * caller (App.tsx lifts the SSE event into state and passes it down) and
 * exposes an `answer(decision)` callback that hits the API and lets the
 * runtime unblock the parked task.
 *
 * The actual SSE subscription lives in App.tsx because the workspace
 * stream is shared across multiple consumers (workspace updates, event
 * log, permission prompts) — keeping a single EventSource avoids the
 * cost of a second connection and the races between two replay buffers.
 */
export interface PendingPermission {
  requestId: string;
  workspaceId: string;
  taskId: string;
  tool: string;
  target: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Coerce an unknown shape into a known-good `Permissions` (drop unknown tools). */
function normalise(raw: Permissions): Permissions {
  const defaults = { ...DEFAULT_PERMISSIONS.defaults };
  for (const tool of TOOL_NAMES) {
    const d = (raw.defaults ?? {})[tool];
    if (d === "allow" || d === "ask" || d === "deny") defaults[tool] = d;
  }
  const patterns: Permissions["patterns"] = {};
  for (const tool of TOOL_NAMES) {
    const p = (raw.patterns ?? {})[tool];
    if (!p || typeof p !== "object") continue;
    const filtered: Record<string, Permission> = {};
    for (const [pat, action] of Object.entries(p)) {
      if (action === "allow" || action === "ask" || action === "deny") filtered[pat] = action;
    }
    if (Object.keys(filtered).length > 0) patterns[tool] = filtered;
  }
  return { defaults, patterns };
}
