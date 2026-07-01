/**
 * SDK context: typed RPC client + global event stream.
 *
 * Ported from OpenCode's SolidJS `sdk.tsx`. The original used the
 * `@opencode-ai/sdk/v2` typed client; Maximilian doesn't have an equivalent
 * yet, so we ship a minimal fetch-based wrapper plus an in-memory event bus.
 *
 * Consumers that need to talk to a real OpenCode-compatible server can swap
 * `createDefaultClient` for a generated SDK by re-implementing this file.
 */
import { useEffect, useRef } from "react";
import { createSimpleContext } from "./helper";
function createDefaultClient(url, init) {
    const headers = { "content-type": "application/json", ...init?.headers };
    if (init?.directory)
        headers["x-maximilian-directory"] = init.directory;
    if (init?.token)
        headers["authorization"] = `Bearer ${init.token}`;
    const fetchImpl = globalThis.fetch?.bind(globalThis) ?? (() => Promise.reject(new Error("fetch is not available")));
    return {
        raw: (path, requestInit) => fetchImpl(new URL(path, url).toString(), { ...requestInit, headers: { ...headers, ...requestInit?.headers } }),
        get: async (path) => {
            const res = await fetchImpl(new URL(path, url).toString(), { method: "GET", headers, signal: init?.signal });
            if (!res.ok)
                throw new Error(`SDK GET ${path} failed: ${res.status}`);
            return (await res.json());
        },
        post: async (path, body) => {
            const res = await fetchImpl(new URL(path, url).toString(), {
                method: "POST",
                headers,
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: init?.signal,
            });
            if (!res.ok)
                throw new Error(`SDK POST ${path} failed: ${res.status}`);
            return (await res.json());
        },
    };
}
export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
    name: "SDK",
    init: (props) => {
        // Use refs to persist state across re-renders. helper.tsx calls init()
        // on every render, so we must NOT allocate new resources each call.
        const abortRef = useRef(undefined);
        if (!abortRef.current)
            abortRef.current = new AbortController();
        const abort = abortRef.current;
        let sse;
        const sdk = createDefaultClient(props.url, {
            directory: props.directory,
            headers: props.headers,
            signal: abort.signal,
            token: props.token,
        });
        const handlersRef = useRef(undefined);
        if (!handlersRef.current)
            handlersRef.current = new Set();
        const handlers = handlersRef.current;
        const emitter = {
            emit(_type, event) {
                for (const handler of handlers)
                    handler(event);
            },
            on(_type, handler) {
                handlers.add(handler);
                return () => {
                    handlers.delete(handler);
                };
            },
        };
        let queue = [];
        let timer;
        let last = 0;
        const retryDelay = 1000;
        const maxRetryDelay = 30000;
        const flush = () => {
            if (queue.length === 0)
                return;
            const events = queue;
            queue = [];
            timer = undefined;
            last = Date.now();
            for (const event of events)
                emitter.emit("event", event);
        };
        const handleEvent = (event) => {
            queue.push(event);
            const elapsed = Date.now() - last;
            if (timer)
                return;
            if (elapsed < 16) {
                timer = setTimeout(flush, 16);
                return;
            }
            flush();
        };
        function startSSE() {
            sse?.abort();
            const ctrl = new AbortController();
            sse = ctrl;
            void (async () => {
                let attempt = 0;
                while (true) {
                    if (abort.signal.aborted || ctrl.signal.aborted)
                        break;
                    try {
                        const res = await sdk.raw("/global/event", { signal: ctrl.signal });
                        if (!res.ok || !res.body)
                            throw new Error(`SSE failed: ${res.status}`);
                        const reader = res.body.getReader();
                        const decoder = new TextDecoder();
                        let buf = "";
                        // eslint-disable-next-line no-constant-condition
                        while (true) {
                            const { value, done } = await reader.read();
                            if (done)
                                break;
                            if (ctrl.signal.aborted)
                                break;
                            buf += decoder.decode(value, { stream: true });
                            let idx;
                            while ((idx = buf.indexOf("\n\n")) !== -1) {
                                const block = buf.slice(0, idx);
                                buf = buf.slice(idx + 2);
                                const dataLines = block
                                    .split("\n")
                                    .filter((line) => line.startsWith("data:"))
                                    .map((line) => line.slice(5).trim())
                                    .join("\n");
                                if (!dataLines)
                                    continue;
                                try {
                                    handleEvent(JSON.parse(dataLines));
                                }
                                catch {
                                    /* malformed line, skip */
                                }
                            }
                        }
                    }
                    catch {
                        /* fall through to backoff */
                    }
                    if (timer)
                        clearTimeout(timer);
                    if (queue.length > 0)
                        flush();
                    attempt += 1;
                    if (abort.signal.aborted || ctrl.signal.aborted)
                        break;
                    const backoff = Math.min(retryDelay * 2 ** (attempt - 1), maxRetryDelay);
                    await new Promise((resolve) => setTimeout(resolve, backoff));
                }
            })();
        }
        if (typeof window === "undefined") {
            // Node: only start an event source if the caller asked for one.
            // Maximilian's API has no global SSE endpoint (events are per-workspace
            // via /api/workspaces/:id/events), so the TUI defaults to no SSE —
            // otherwise we'd spin forever retrying a 404 on /global/event.
            if (props.events) {
                void props.events.subscribe(handleEvent).then((unsub) => {
                    // Best-effort cleanup: rely on GC if the provider is unmounted.
                    void unsub;
                });
            }
            else if (props.enableSSE) {
                startSSE();
            }
        }
        // Abort on unmount to prevent SSE/orphan-handler leaks.
        useEffect(() => () => abort.abort(), []);
        return {
            client: sdk,
            directory: props.directory,
            event: emitter,
            fetch: props.fetch ?? globalThis.fetch?.bind(globalThis) ?? (() => Promise.reject(new Error("no fetch"))),
            url: props.url,
        };
    },
});
