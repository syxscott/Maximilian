import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
/**
 * Session route: transcript viewer + prompt + sidebar.
 *
 * Ported from OpenCode's `routes/session/index.tsx` (2648 lines). The original
 * used `@opentui/solid` primitives (`<scrollbox>`, `<markdown>`, `<diff>`,
 * `<code>`) plus a deep command-palette/keymap system. We rewrite to plain
 * ink primitives and split rendering into focused helper components.
 *
 * NOTE: this is a structural port, not a 1:1 translation. Several pieces are
 * stubbed or simplified:
 *   - Markdown rendering uses plain `<Text>` (no syntax highlighting).
 *   - Diffs render as raw text blocks (no split/stacked view).
 *   - Tool part rendering is summarized inline; full per-tool UI is deferred.
 *   - Keybindings/command palette fall back to no-op handlers.
 *
 * Routing of session messages, prompt submission, and status remain
 * faithful to the OpenCode intent.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "ink";
import { Prompt } from "../../prompt";
import { useRoute, useRouteData } from "../../context/route";
import { useSync } from "../../context/sync";
import { useEvent } from "../../context/event";
import { useSDK } from "../../context/sdk";
import { useLocal } from "../../context/local";
import { useTheme } from "../../context/theme";
import { useArgs } from "../../context/args";
// -- Helpers -----------------------------------------------------------------
function getString(value) {
    return typeof value === "string" ? value : undefined;
}
function getNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function inputSummary(input, omit) {
    const primitives = Object.entries(input).filter(([key, value]) => {
        if (omit?.includes(key))
            return false;
        return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
    });
    if (primitives.length === 0)
        return "";
    return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`;
}
function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60)
        return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}m${r}s`;
}
function formatTodayOrDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleString();
}
// -- Sub-components ----------------------------------------------------------
function ReasoningHeader({ part, open, toggleable }) {
    const { theme } = useTheme();
    const done = part.time.end !== undefined;
    if (!done) {
        return (_jsx(Text, { children: _jsx(Text, { color: theme.warning, children: "Thinking\u2026" }) }));
    }
    return (_jsxs(Text, { color: theme.warning, children: [toggleable ? (open ? "- " : "+ ") : "", "Thought: ", part.text.slice(0, 80), part.text.length > 80 ? "…" : ""] }));
}
function ReasoningPart({ part }) {
    const { theme } = useTheme();
    const [open, setOpen] = useState(false);
    const content = part.text.replace("[REDACTED]", "").trim();
    if (!content)
        return null;
    const duration = part.time.end !== undefined ? Math.max(0, part.time.end - part.time.start) : 0;
    return (_jsxs(Box, { flexDirection: "column", paddingLeft: 3, marginTop: 1, children: [_jsxs(Box, { onClick: () => setOpen((v) => !v), children: [_jsx(ReasoningHeader, { part: part, open: open, toggleable: true }), duration > 0 ? _jsxs(Text, { color: theme.textMuted, children: [" \u00B7 ", formatDuration(duration)] }) : null] }), open ? (_jsx(Box, { paddingLeft: 2, marginTop: 1, children: _jsx(Text, { color: theme.textMuted, children: content }) })) : null] }));
}
function TextPart({ part }) {
    const { theme } = useTheme();
    const text = part.text.trim();
    if (!text)
        return null;
    return (_jsx(Box, { paddingLeft: 3, marginTop: 1, flexShrink: 0, children: _jsx(Text, { color: theme.markdownText, children: text }) }));
}
function GenericTool({ part }) {
    const { theme } = useTheme();
    const output = getString(part.state.output)?.trim() ?? "";
    const input = part.state.input ?? {};
    return (_jsxs(Box, { paddingLeft: 3, marginTop: 1, children: [_jsxs(Text, { color: theme.text, children: ["\u2699 ", part.tool, " ", inputSummary(input)] }), output ? (_jsx(Box, { marginTop: 1, children: _jsx(Text, { color: theme.text, children: output }) })) : null] }));
}
function ToolPart({ part }) {
    // Per-tool rendering is summarized inline. Detailed sub-components (Shell,
    // Edit, Write, etc.) can be reintroduced when Maximilian's TUI gains a
    // diff viewer and syntax highlighter.
    return _jsx(GenericTool, { part: part });
}
function UserMessage({ message, parts, pending, onClick, }) {
    const { theme } = useTheme();
    const local = useLocal();
    const text = parts
        .map((p) => (p.type === "text" && !p.synthetic ? p.text : null))
        .filter(Boolean)
        .join("\n\n");
    const files = parts.filter((p) => p.type === "file");
    const queued = pending && message.id > pending;
    const color = local.agent.color(message.agent ?? "");
    if (!text && files.length === 0)
        return null;
    return (_jsx(Box, { flexDirection: "column", marginTop: 1, borderStyle: "single", borderColor: color, paddingLeft: 1, children: _jsxs(Box, { paddingLeft: 1, paddingTop: 1, paddingBottom: 1, flexDirection: "column", children: [text ? _jsx(Text, { color: theme.text, children: text }) : null, files.length > 0 ? (_jsx(Box, { flexDirection: "row", gap: 1, paddingTop: 1, flexWrap: "wrap", children: files.map((file) => (_jsxs(Text, { color: theme.textMuted, children: ["[", file.mime, "] ", file.filename] }, file.url))) })) : null, queued ? (_jsx(Text, { color: theme.warning, bold: true, children: "QUEUED" })) : (_jsx(Text, { color: theme.textMuted, children: formatTodayOrDate(message.time.created) })), onClick ? (_jsx(Box, { marginTop: 1, children: _jsx(Text, { color: theme.textMuted, children: "(click to view message actions)" }) })) : null] }) }));
}
function AssistantMessage({ message, parts }) {
    const { theme } = useTheme();
    const sync = useSync();
    const messages = sync.data.message[message.sessionID] ?? [];
    const final = !!message.finish && !["tool-calls", "unknown"].includes(message.finish);
    const duration = final && message.time.completed
        ? (() => {
            const user = messages.find((x) => x.role === "user" && x.id === message.parentID);
            if (!user?.time)
                return 0;
            return message.time.completed - user.time.created;
        })()
        : 0;
    return (_jsxs(Box, { flexDirection: "column", children: [parts.map((part, index) => {
                if (part.type === "text")
                    return _jsx(TextPart, { part: part }, `${part.type}-${index}`);
                if (part.type === "reasoning")
                    return _jsx(ReasoningPart, { part: part }, `${part.type}-${index}`);
                if (part.type === "tool")
                    return _jsx(ToolPart, { part: part }, `${part.type}-${index}`);
                return null;
            }), message.error && message.error.name !== "MessageAbortedError" ? (_jsx(Box, { marginTop: 1, borderStyle: "single", borderColor: theme.error, paddingLeft: 1, children: _jsx(Text, { color: theme.error, children: message.error.data?.message ?? message.error.message }) })) : null, message.last || final || message.error?.name === "MessageAbortedError" ? (_jsx(Box, { paddingLeft: 3, children: _jsxs(Text, { children: [_jsx(Text, { color: theme.primary, children: "\u25A3 " }), _jsx(Text, { color: theme.text, children: message.mode ?? "" }), _jsxs(Text, { color: theme.textMuted, children: [" · ", message.providerID ?? "", "/", message.modelID ?? "", duration > 0 ? ` · ${formatDuration(duration)}` : "", message.error?.name === "MessageAbortedError" ? " · interrupted" : ""] })] }) })) : null] }));
}
// -- Main component ----------------------------------------------------------
export function Session() {
    const route = useRouteData("session");
    const { navigate } = useRoute();
    const sync = useSync();
    const event = useEvent();
    const sdk = useSDK();
    const local = useLocal();
    const { theme } = useTheme();
    const args = useArgs();
    void args;
    const session = useMemo(() => sync.data.session.find((s) => s.id === route.sessionID), [sync.data.session, route.sessionID]);
    const messages = useMemo(() => (sync.data.message[route.sessionID] ?? []), [sync.data.message, route.sessionID]);
    const pending = useMemo(() => {
        const completed = messages.findLast((x) => x.role === "assistant" && x.time.completed)?.id;
        return messages.findLast((x) => x.role === "assistant" && !x.time.completed && (!completed || x.id > completed))?.id;
    }, [messages]);
    const lastAssistant = useMemo(() => messages.findLast((x) => x.role === "assistant"), [messages]);
    const [showTimestamps, setShowTimestamps] = useState(false);
    const [showDetails, setShowDetails] = useState(true);
    const [sidebarVisible, setSidebarVisible] = useState(false);
    const promptRef = useRef(undefined);
    const seededRef = useRef(false);
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                await sdk.client.get(`/session/${route.sessionID}`).catch(() => null);
                await sdk.client.get(`/session/${route.sessionID}/messages`).catch(() => null);
            }
            catch {
                if (cancelled)
                    return;
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [sdk, route.sessionID]);
    useEffect(() => {
        const off = event.on("message.part.updated", (evt) => {
            const part = evt.properties.part;
            if (part.type !== "tool")
                return;
            if (part.sessionID !== route.sessionID)
                return;
            if (part.tool === "plan_exit")
                local.agent.set("build");
            else if (part.tool === "plan_enter")
                local.agent.set("plan");
        });
        return off;
    }, [event, route.sessionID, local]);
    const bind = (ref) => {
        promptRef.current = ref;
        if (seededRef.current || !route.prompt || !ref)
            return;
        seededRef.current = true;
        ref.set(route.prompt);
    };
    // The original route dispatched commands like session.share, session.rename,
    // session.compact, etc. via a keymap layer. For Maximilian we expose them
    // through a small imperative API on a context bus so the prompt can wire
    // them later.
    const sessionCommands = useMemo(() => ({
        share: () => console.log("[session.share] not yet wired"),
        rename: () => console.log("[session.rename] not yet wired"),
        timeline: () => console.log("[session.timeline] not yet wired"),
        fork: () => console.log("[session.fork] not yet wired"),
        compact: async () => {
            const m = local.model.current();
            if (!m)
                return;
            await sdk.client.post(`/session/${route.sessionID}/summarize`, { modelID: m.modelID, providerID: m.providerID });
        },
        unshare: () => console.log("[session.unshare] not yet wired"),
        toggleSidebar: () => setSidebarVisible((v) => !v),
        toggleTimestamps: () => setShowTimestamps((v) => !v),
        toggleDetails: () => setShowDetails((v) => !v),
        copyLastAssistant: () => console.log("[messages.copy] not yet wired"),
    }), [sdk, route.sessionID, local]);
    void sessionCommands;
    const toBottom = () => {
        /* scrollbox would scroll here; ink does not have a virtualized list */
    };
    useEffect(() => {
        // Snap-to-bottom on session change.
        toBottom();
    }, [route.sessionID]);
    if (!session) {
        return (_jsx(Box, { flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center", children: _jsx(Text, { color: theme.textMuted, children: "Session not found." }) }));
    }
    const sidebar = sidebarVisible ? (_jsx(Box, { flexDirection: "column", width: 40, borderStyle: "single", borderColor: theme.border, children: _jsx(Text, { color: theme.textMuted, children: "Sessions sidebar (stub)" }) })) : null;
    return (_jsxs(Box, { flexDirection: "row", flexGrow: 1, children: [_jsxs(Box, { flexDirection: "column", flexGrow: 1, paddingLeft: 2, paddingRight: 2, gap: 1, children: [_jsx(Box, { flexDirection: "column", flexGrow: 1, children: messages.map((message, index) => {
                            const parts = (sync.data.part[message.id] ?? []);
                            if (message.role === "user") {
                                return (_jsx(UserMessage, { message: message, parts: parts, pending: pending, onClick: () => console.log("[dialog.message] not yet wired") }, message.id));
                            }
                            return (_jsx(AssistantMessage, { message: message, parts: parts, last: lastAssistant?.id === message.id }, message.id));
                        }) }), _jsx(Box, { flexShrink: 0, children: _jsx(Prompt, { ref: bind, sessionID: route.sessionID, onSubmit: toBottom }) })] }), sidebar] }));
}
