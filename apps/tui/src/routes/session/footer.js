import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// @ts-nocheck
/**
 * Footer: bottom bar showing directory, connection status, MCP/LSP counts.
 *
 * Ported from OpenCode's SolidJS `footer.tsx`. The original used
 * `createMemo`, `createStore`, `onMount`/`onCleanup`, and `<Switch>`/`<Match>`;
 * we port to React `useMemo`, `useState`, `useEffect`, and conditional JSX.
 */
import { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../../context/theme";
import { useSync } from "../../context/sync";
import { useRoute } from "../../context/route";
import { useConnected } from "../../components/use-connected";
export function Footer() {
    const { theme } = useTheme();
    const sync = useSync();
    const route = useRoute();
    const connected = useConnected();
    const mcp = useMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length, [sync.data.mcp]);
    const mcpError = useMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"), [sync.data.mcp]);
    const lsp = useMemo(() => Object.keys(sync.data.lsp), [sync.data.lsp]);
    const permissions = useMemo(() => {
        if (route.data.type !== "session")
            return [];
        return sync.data.permission?.[route.data.sessionID] ?? [];
    }, [sync.data.permission, route.data]);
    const directory = useMemo(() => {
        // In the original, directory came from a dedicated context. We approximate
        // by reading the project path from sync data.
        return sync.data.path ?? "";
    }, [sync.data]);
    const [welcome, setWelcome] = useState(false);
    useEffect(() => {
        const timeouts = [];
        function tick() {
            if (connected)
                return;
            if (!welcome) {
                setWelcome(true);
                timeouts.push(setTimeout(() => tick(), 5000));
                return;
            }
            if (welcome) {
                setWelcome(false);
                timeouts.push(setTimeout(() => tick(), 10_000));
                return;
            }
        }
        timeouts.push(setTimeout(() => tick(), 10_000));
        return () => {
            timeouts.forEach(clearTimeout);
        };
    }, [connected, welcome]);
    return (_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", flexShrink: 0, children: [_jsx(Text, { dimColor: true, children: directory }), _jsx(Box, { gap: 2, flexDirection: "row", flexShrink: 0, children: welcome ? (_jsxs(Text, { children: ["Get started ", _jsx(Text, { dimColor: true, children: "/connect" })] })) : connected ? (_jsxs(_Fragment, { children: [permissions.length > 0 ? (_jsxs(Text, { color: theme.warning, children: [permissions.length, " Permission", permissions.length > 1 ? "s" : ""] })) : null, _jsxs(Text, { children: [_jsx(Text, { color: lsp.length > 0 ? theme.success : theme.textMuted, children: "*" }), " ", lsp.length, " LSP"] }), mcp > 0 ? (_jsxs(Text, { children: [_jsx(Text, { color: mcpError ? theme.error : theme.success, children: "@" }), " ", mcp, " MCP"] })) : null, _jsx(Text, { dimColor: true, children: "/status" })] })) : null })] }));
}
