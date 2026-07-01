import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { t } from "@max/i18n";
const STATUS_COLOR = {
    connected: "green",
    failed: "red",
    disabled: "gray",
    needs_auth: "yellow",
    needs_client_registration: "red",
    error: "red",
};
function fileURLToPath(value) {
    return value.replace(/^file:\/\//, "");
}
function parsePlugin(item) {
    const value = typeof item === "string" ? item : item[0];
    if (value.startsWith("file://")) {
        const path = fileURLToPath(value);
        const parts = path.split("/");
        const filename = parts.pop() || path;
        if (!filename.includes("."))
            return { name: filename };
        const basename = filename.split(".")[0];
        if (basename === "index") {
            const dirname = parts.pop();
            const name = dirname || basename;
            return { name };
        }
        return { name: basename };
    }
    const index = value.lastIndexOf("@");
    if (index <= 0)
        return { name: value, version: "latest" };
    return { name: value.substring(0, index), version: value.substring(index + 1) };
}
function mcpStatusText(key, item) {
    switch (item.status) {
        case "connected":
            return "Connected";
        case "failed":
            return item.error ?? "Failed";
        case "disabled":
            return "Disabled in configuration";
        case "needs_auth":
            return `Needs authentication (run: opencode mcp auth ${key})`;
        case "needs_client_registration":
            return item.error ?? "Needs client registration";
        default:
            return item.status;
    }
}
export function DialogStatus(props) {
    const enabledFormatters = useMemo(() => props.formatters.filter((f) => f.enabled), [props.formatters]);
    const plugins = useMemo(() => props.plugins.map(parsePlugin).sort((a, b) => a.name.localeCompare(b.name)), [props.plugins]);
    useInput((input, key) => {
        if (key.escape)
            props.onClose?.();
    });
    const mcpEntries = Object.entries(props.mcps);
    const showMcp = mcpEntries.length > 0;
    const showLsp = props.lsps.length > 0;
    const showFormatters = enabledFormatters.length > 0;
    const showPlugins = plugins.length > 0;
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingBottom: 1, gap: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: t("tui.status") }), _jsx(Text, { dimColor: true, children: "esc" })] }), showMcp ? (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: [mcpEntries.length, " MCP Servers"] }), mcpEntries.map(([key, item]) => (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { color: STATUS_COLOR[item.status], flexShrink: 0, children: "\u2022" }), _jsxs(Text, { wrap: "word", children: [_jsx(Text, { bold: true, children: key }), " ", _jsx(Text, { dimColor: true, children: mcpStatusText(key, item) })] })] }, key)))] })) : (_jsx(Text, { children: t("tui.noMcpServers") })), showLsp && (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: [props.lsps.length, " LSP Servers"] }), props.lsps.map((item) => (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { color: STATUS_COLOR[item.status], flexShrink: 0, children: "\u2022" }), _jsxs(Text, { wrap: "word", children: [_jsx(Text, { bold: true, children: item.id }), " ", _jsx(Text, { dimColor: true, children: item.root })] })] }, item.id)))] })), showFormatters ? (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: [enabledFormatters.length, " Formatters"] }), enabledFormatters.map((item) => (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { color: "green", flexShrink: 0, children: "\u2022" }), _jsx(Text, { wrap: "word", bold: true, children: item.name })] }, item.name)))] })) : (_jsx(Text, { children: t("tui.noFormatters") })), showPlugins ? (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: [plugins.length, " Plugins"] }), plugins.map((item) => (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { color: "green", flexShrink: 0, children: "\u2022" }), _jsxs(Text, { wrap: "word", children: [_jsx(Text, { bold: true, children: item.name }), item.version && _jsxs(Text, { dimColor: true, children: [" @", item.version] })] })] }, item.name)))] })) : (_jsx(Text, { children: t("tui.noPlugins") }))] }));
}
export default DialogStatus;
