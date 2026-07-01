import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
/**
 * PermissionPrompt: interactive permission gate for tool execution.
 *
 * Ported from OpenCode's SolidJS `permission.tsx`. The original used
 * `createStore`, `<Switch>/<Match>`, `<For>`, `<Show>`, `<Portal>`,
 * `useBindings`, `useTerminalDimensions`, `<diff>`, `<scrollbox>`,
 * `<textarea>`, and `SplitBorder` from `@opentui/core`.
 *
 * We port to React `useState`, conditional JSX, `.map()`, and ink `Box`/`Text`.
 * Several OpenTUI-specific features are simplified:
 *   - Diff viewer: rendered as raw text (no syntax highlighting).
 *   - Scrollbox: replaced by a plain Box.
 *   - Textarea: replaced by a simple text prompt.
 *   - Portal: removed (ink has no portal concept).
 *   - SplitBorder: replaced by ink's `borderStyle`.
 *   - useBindings: replaced by `useInput` from ink.
 */
import { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { dirname } from "node:path";
import { useTheme, selectedForeground } from "../../context/theme";
import { useSDK } from "../../context/sdk";
import { useSync } from "../../context/sync";
import { useProject } from "../../context/project";
import { Locale } from "../../util/locale";
import { webSearchProviderLabel } from "../../util/tool-display";
// ---------------------------------------------------------------------------
// Local helpers (stubs for missing dependencies)
// ---------------------------------------------------------------------------
function usePathFormatter() {
    return {
        format(p) {
            return p ?? "";
        },
    };
}
// ---------------------------------------------------------------------------
// EditBody
// ---------------------------------------------------------------------------
function EditBody(props) {
    const { theme } = useTheme();
    const filepath = useMemo(() => {
        const value = props.request.metadata?.filepath;
        return typeof value === "string" ? value : "";
    }, [props.request.metadata?.filepath]);
    const diff = useMemo(() => {
        const value = props.request.metadata?.diff;
        return typeof value === "string" ? value : "";
    }, [props.request.metadata?.diff]);
    return (_jsx(Box, { flexDirection: "column", children: diff ? (_jsx(Box, { paddingLeft: 1, children: _jsx(Text, { color: theme.text, children: diff }) })) : (_jsx(Box, { paddingLeft: 1, children: _jsx(Text, { dimColor: true, children: "No diff provided" }) })) }));
}
// ---------------------------------------------------------------------------
// TextBody
// ---------------------------------------------------------------------------
function TextBody(props) {
    const { theme } = useTheme();
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { flexDirection: "row", gap: 1, paddingLeft: 1, children: [props.icon ? (_jsx(Text, { dimColor: true, children: props.icon })) : null, _jsx(Text, { dimColor: true, children: props.title })] }), props.description ? (_jsx(Box, { paddingLeft: 1, children: _jsx(Text, { color: theme.text, children: props.description }) })) : null] }));
}
// ---------------------------------------------------------------------------
// RejectPrompt
// ---------------------------------------------------------------------------
function RejectPrompt(props) {
    const { theme } = useTheme();
    const [value, setValue] = useState("");
    useInput((input, key) => {
        if (key.escape) {
            props.onCancel();
            return;
        }
        if (key.return) {
            props.onConfirm(value);
            return;
        }
        if (key.backspace || key.delete) {
            setValue((prev) => prev.slice(0, -1));
            return;
        }
        if (input && !key.ctrl && !key.meta) {
            setValue((prev) => prev + input);
        }
    });
    return (_jsxs(Box, { flexDirection: "column", paddingLeft: 1, paddingRight: 3, paddingTop: 1, paddingBottom: 1, borderStyle: "single", borderColor: theme.error, children: [_jsxs(Box, { flexDirection: "row", gap: 1, paddingLeft: 1, children: [_jsx(Text, { color: theme.error, children: "!" }), _jsx(Text, { color: theme.text, children: "Reject permission" })] }), _jsx(Box, { paddingLeft: 1, children: _jsx(Text, { dimColor: true, children: "Tell OpenCode what to do differently" }) }), _jsx(Box, { paddingLeft: 1, paddingTop: 1, children: _jsxs(Text, { color: theme.text, children: [value, _jsx(Text, { color: theme.primary, children: "_" })] }) }), _jsxs(Box, { flexDirection: "row", gap: 2, paddingTop: 1, children: [_jsxs(Text, { children: ["enter ", _jsx(Text, { dimColor: true, children: "confirm" })] }), _jsxs(Text, { children: ["esc ", _jsx(Text, { dimColor: true, children: "cancel" })] })] })] }));
}
// ---------------------------------------------------------------------------
// Prompt (generic option selector)
// ---------------------------------------------------------------------------
function Prompt(props) {
    const { theme } = useTheme();
    const keys = Object.keys(props.options);
    const [selected, setSelected] = useState(keys[0]);
    useInput((input, key) => {
        if (key.left || input === "h") {
            setSelected((prev) => {
                const idx = keys.indexOf(prev);
                return keys[(idx - 1 + keys.length) % keys.length];
            });
            return;
        }
        if (key.right || input === "l") {
            setSelected((prev) => {
                const idx = keys.indexOf(prev);
                return keys[(idx + 1) % keys.length];
            });
            return;
        }
        if (key.return) {
            props.onSelect(selected);
            return;
        }
        if (key.escape && props.escapeKey) {
            props.onSelect(props.escapeKey);
        }
    });
    return (_jsxs(Box, { flexDirection: "column", paddingLeft: 1, paddingRight: 3, paddingTop: 1, paddingBottom: 1, borderStyle: "single", borderColor: theme.warning, children: [props.header ?? (_jsxs(Box, { flexDirection: "row", gap: 1, paddingLeft: 1, flexShrink: 0, children: [_jsx(Text, { color: theme.warning, children: "!" }), _jsx(Text, { color: theme.text, children: props.title })] })), props.body, _jsx(Box, { flexDirection: "row", flexShrink: 0, gap: 1, paddingTop: 1, children: keys.map((option) => (_jsx(Box, { paddingLeft: 1, paddingRight: 1, children: _jsx(Text, { color: option === selected ? selectedForeground(theme, theme.warning) : undefined, dimColor: option !== selected, children: props.options[option] }) }, option))) }), _jsxs(Box, { flexDirection: "row", gap: 2, paddingTop: 1, children: [_jsx(Text, { children: _jsx(Text, { dimColor: true, children: "select" }) }), _jsxs(Text, { children: ["enter ", _jsx(Text, { dimColor: true, children: "confirm" })] })] })] }));
}
// ---------------------------------------------------------------------------
// PermissionPrompt
// ---------------------------------------------------------------------------
export function PermissionPrompt(props) {
    const sdk = useSDK();
    const project = useProject();
    const sync = useSync();
    const [stage, setStage] = useState("permission");
    const pathFormatter = usePathFormatter();
    const { theme } = useTheme();
    const session = useMemo(() => sync.data.session.find((s) => s.id === props.request.sessionID), [sync.data.session, props.request.sessionID]);
    const input = useMemo(() => {
        const tool = props.request.tool;
        if (!tool)
            return {};
        const parts = (sync.data.part?.[tool.messageID] ?? []);
        for (const part of parts) {
            if (part.type === "tool" &&
                part.callID === tool.callID &&
                part.state?.status !== "pending") {
                return (part.state?.input ?? {});
            }
        }
        return {};
    }, [props.request.tool, sync.data.part]);
    // -- "always" stage ---------------------------------------------------------
    if (stage === "always") {
        return (_jsx(Prompt, { title: "Always allow", body: props.request.always.length === 1 && props.request.always[0] === "*" ? (_jsx(TextBody, { title: "This will allow " + props.request.permission + " until OpenCode is restarted." })) : (_jsxs(Box, { paddingLeft: 1, gap: 1, flexDirection: "column", children: [_jsx(Text, { dimColor: true, children: "This will allow the following patterns until OpenCode is restarted" }), props.request.always.map((pattern) => (_jsxs(Text, { color: theme.text, children: ["- ", pattern] }, pattern)))] })), options: { confirm: "Confirm", cancel: "Cancel" }, escapeKey: "cancel", onSelect: (option) => {
                setStage("permission");
                if (option === "cancel")
                    return;
                void sdk.client.permission?.reply?.({
                    reply: "always",
                    requestID: props.request.id,
                    directory: props.directory,
                    workspace: project.workspace.current(),
                });
            } }));
    }
    // -- "reject" stage ---------------------------------------------------------
    if (stage === "reject") {
        return (_jsx(RejectPrompt, { onConfirm: (message) => {
                void sdk.client.permission?.reply?.({
                    reply: "reject",
                    requestID: props.request.id,
                    directory: props.directory,
                    message: message || undefined,
                    workspace: project.workspace.current(),
                });
            }, onCancel: () => {
                setStage("permission");
            } }));
    }
    // -- "permission" stage (default) -------------------------------------------
    const info = (() => {
        const permission = props.request.permission;
        const data = input;
        if (permission === "edit") {
            const raw = props.request.metadata?.filepath;
            const filepath = typeof raw === "string" ? raw : "";
            return {
                icon: "->",
                title: `Edit ${pathFormatter.format(filepath)}`,
                body: _jsx(EditBody, { request: props.request }),
            };
        }
        if (permission === "read") {
            const raw = data.filePath;
            const filePath = typeof raw === "string" ? raw : "";
            return {
                icon: "->",
                title: `Read ${pathFormatter.format(filePath)}`,
                body: filePath ? (_jsx(Box, { paddingLeft: 1, children: _jsx(Text, { dimColor: true, children: "Path: " + pathFormatter.format(filePath) }) })) : null,
            };
        }
        if (permission === "glob") {
            const pattern = typeof data.pattern === "string" ? data.pattern : "";
            return {
                icon: "*",
                title: `Glob "${pattern}"`,
                body: pattern ? (_jsx(Box, { paddingLeft: 1, children: _jsx(Text, { dimColor: true, children: "Pattern: " + pattern }) })) : null,
            };
        }
        if (permission === "grep") {
            const pattern = typeof data.pattern === "string" ? data.pattern : "";
            return {
                icon: "*",
                title: `Grep "${pattern}"`,
                body: pattern ? (_jsx(Box, { paddingLeft: 1, children: _jsx(Text, { dimColor: true, children: "Pattern: " + pattern }) })) : null,
            };
        }
        if (permission === "list") {
            const raw = data.path;
            const dir = typeof raw === "string" ? raw : "";
            return {
                icon: "->",
                title: `List ${pathFormatter.format(dir)}`,
                body: dir ? (_jsx(Box, { paddingLeft: 1, children: _jsx(Text, { dimColor: true, children: "Path: " + pathFormatter.format(dir) }) })) : null,
            };
        }
        if (permission === "bash") {
            const title = typeof data.description === "string" && data.description ? data.description : "Shell command";
            const command = typeof data.command === "string" ? data.command : "";
            return {
                icon: "#",
                title,
                body: command ? (_jsx(Box, { paddingLeft: 1, children: _jsx(Text, { color: theme.text, children: "$ " + command }) })) : null,
            };
        }
        if (permission === "task") {
            const type = typeof data.subagent_type === "string" ? data.subagent_type : "Unknown";
            const desc = typeof data.description === "string" ? data.description : "";
            return {
                icon: "#",
                title: `${Locale.titlecase(type)} Task`,
                body: desc ? (_jsx(Box, { paddingLeft: 1, children: _jsx(Text, { color: theme.text, children: "> " + desc }) })) : null,
            };
        }
        if (permission === "webfetch") {
            const url = typeof data.url === "string" ? data.url : "";
            return {
                icon: "%",
                title: `WebFetch ${url}`,
                body: url ? (_jsx(Box, { paddingLeft: 1, children: _jsx(Text, { dimColor: true, children: "URL: " + url }) })) : null,
            };
        }
        if (permission === "websearch") {
            const query = typeof data.query === "string" ? data.query : "";
            return {
                icon: "D",
                title: `${webSearchProviderLabel(data.provider)} "${query}"`,
                body: query ? (_jsx(Box, { paddingLeft: 1, children: _jsx(Text, { dimColor: true, children: "Query: " + query }) })) : null,
            };
        }
        if (permission === "external_directory") {
            const meta = props.request.metadata ?? {};
            const parent = typeof meta["parentDir"] === "string" ? meta["parentDir"] : undefined;
            const filepath = typeof meta["filepath"] === "string" ? meta["filepath"] : undefined;
            const pattern = props.request.patterns?.[0];
            const derived = typeof pattern === "string" ? (pattern.includes("*") ? dirname(pattern) : pattern) : undefined;
            const raw = parent ?? filepath ?? derived;
            const dir = pathFormatter.format(raw);
            const patterns = (props.request.patterns ?? []).filter((p) => typeof p === "string");
            return {
                icon: "<-",
                title: `Access external directory ${dir}`,
                body: patterns.length > 0 ? (_jsxs(Box, { paddingLeft: 1, gap: 1, flexDirection: "column", children: [_jsx(Text, { dimColor: true, children: "Patterns" }), patterns.map((p) => (_jsxs(Text, { color: theme.text, children: ["- ", p] }, p)))] })) : null,
            };
        }
        if (permission === "doom_loop") {
            return {
                icon: "~",
                title: "Continue after repeated failures",
                body: (_jsx(Box, { paddingLeft: 1, children: _jsx(Text, { dimColor: true, children: "This keeps the session running despite repeated failures." }) })),
            };
        }
        return {
            icon: "o",
            title: `Call tool ${permission}`,
            body: (_jsx(Box, { paddingLeft: 1, children: _jsx(Text, { dimColor: true, children: "Tool: " + permission }) })),
        };
    })();
    const header = (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { flexDirection: "row", gap: 1, flexShrink: 0, children: [_jsx(Text, { color: theme.warning, children: "!" }), _jsx(Text, { color: theme.text, children: "Permission required" })] }), _jsxs(Box, { flexDirection: "row", gap: 1, paddingLeft: 2, flexShrink: 0, children: [_jsx(Text, { dimColor: true, children: info.icon }), _jsx(Text, { color: theme.text, children: info.title })] })] }));
    return (_jsx(Prompt, { title: "Permission required", header: header, body: info.body, options: { once: "Allow once", always: "Allow always", reject: "Reject" }, escapeKey: "reject", onSelect: (option) => {
            if (option === "always") {
                setStage("always");
                return;
            }
            if (option === "reject") {
                if (session?.parentID) {
                    setStage("reject");
                    return;
                }
                void sdk.client.permission?.reply?.({
                    reply: "reject",
                    requestID: props.request.id,
                    directory: props.directory,
                    workspace: project.workspace.current(),
                });
                return;
            }
            void sdk.client.permission?.reply?.({
                reply: "once",
                requestID: props.request.id,
                directory: props.directory,
                workspace: project.workspace.current(),
            });
        } }));
}
