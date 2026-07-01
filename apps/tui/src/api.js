/**
 * Maximilian API client for the TUI.
 *
 * Mirrors the dashboard's `apps/dashboard/src/api.ts` contract but uses plain
 * TS types (the API server already validates with Zod; the TUI doesn't need a
 * second runtime check). Covers the endpoints the Home route needs:
 *   GET  /api/health
 *   GET  /api/obs/executions
 *   GET  /api/gov/pending
 *   GET  /api/obs/usage/summary?range=...
 *   POST /api/chat
 *
 * Auth: optional bearer token (ADMIN_TOKEN / JWT) injected into every request.
 */
export function createMaximilianClient(baseUrl, token) {
    const headers = {
        "content-type": "application/json",
    };
    if (token)
        headers["authorization"] = `Bearer ${token}`;
    async function getJson(path, signal) {
        const url = new URL(path, baseUrl).toString();
        const res = await fetch(url, { method: "GET", headers, signal });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`);
        }
        return (await res.json());
    }
    async function postJson(path, body, signal) {
        const url = new URL(path, baseUrl).toString();
        const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`);
        }
        return (await res.json());
    }
    return {
        health: (signal) => getJson("/api/health", signal),
        listExecutions: (signal) => getJson("/api/obs/executions", signal),
        listPendingProposals: (signal) => getJson("/api/gov/pending", signal),
        getUsageSummary: (range, signal) => getJson(`/api/obs/usage/summary?range=${encodeURIComponent(range)}`, signal),
        chat: (message, signal) => postJson("/api/chat", { message }, signal),
    };
}
