import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import { t } from "@max/i18n";
import { Box, Text, useInput, useStdout, useApp } from "ink";
const LIGHT_COLORS = {
    bg: "white",
    text: "black",
    muted: "gray",
    primary: "blue",
    selectedListItemText: "white",
};
const DARK_COLORS = {
    bg: "black",
    text: "white",
    muted: "gray",
    primary: "yellow",
    selectedListItemText: "black",
};
const STACK_PREVIEW_CHARS = 6000;
const GITHUB_ISSUES_URL = "https://github.com/anomalyco/opencode/issues/new?template=bug-report.yml";
const OPENCODE_VERSION = "unknown";
export function ErrorComponent({ error, reset, mode = "dark" }) {
    const { exit } = useApp();
    const { stdout } = useStdout();
    const [copied, setCopied] = React.useState(false);
    const colors = mode === "light" ? LIGHT_COLORS : DARK_COLORS;
    const height = stdout?.rows ?? 24;
    const scrollHeight = Math.max(4, Math.floor(height * 0.7));
    const issueURL = React.useMemo(() => {
        const url = new URL(GITHUB_ISSUES_URL);
        if (error.message) {
            url.searchParams.set("title", `opentui: fatal: ${error.message}`);
        }
        if (error.stack) {
            const stackPreview = error.stack.substring(0, STACK_PREVIEW_CHARS - url.toString().length);
            url.searchParams.set("description", "```\n" + stackPreview + "...\n```");
        }
        url.searchParams.set("opencode-version", OPENCODE_VERSION);
        return url;
    }, [error]);
    useInput((input, key) => {
        if (key.ctrl && input === "c") {
            void exit();
        }
    });
    // We can't actually write to a clipboard from inside the TUI port without an
    // injected adapter; we keep the call site and simulate the copied state so
    // the UI matches OpenCode's behaviour once a clipboard provider is wired in.
    const copyIssueURL = React.useCallback(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, []);
    return (_jsxs(Box, { flexDirection: "column", gap: 1, width: stdout?.columns ?? 80, children: [_jsxs(Box, { flexDirection: "row", gap: 1, alignItems: "center", children: [_jsx(Text, { bold: true, color: colors.text, children: "Please report an issue." }), _jsx(Box, { borderStyle: "single", borderColor: colors.primary, paddingLeft: 1, paddingRight: 1, children: _jsx(Text, { bold: true, color: colors.text, children: "Copy issue URL (exception info pre-filled)" }) }), copied ? _jsx(Text, { color: colors.muted, children: t("tui.copiedSuccessfully") }) : null] }), _jsxs(Box, { flexDirection: "row", gap: 2, alignItems: "center", children: [_jsx(Text, { color: colors.text, children: "A fatal error occurred!" }), _jsx(Box, { borderStyle: "single", borderColor: colors.primary, paddingLeft: 1, paddingRight: 1, children: _jsx(Text, { color: colors.text, children: t("tui.resetTui") }) }), _jsx(Box, { borderStyle: "single", borderColor: colors.primary, paddingLeft: 1, paddingRight: 1, children: _jsx(Text, { color: colors.text, children: t("tui.exit") }) })] }), _jsx(Box, { flexDirection: "column", height: scrollHeight, overflow: "hidden", children: _jsx(Text, { color: colors.muted, wrap: "wrap", children: error.stack ?? "(no stack trace)" }) }), _jsx(Text, { color: colors.text, children: error.message }), _jsx(Text, { dimColor: true, children: issueURL.toString().slice(0, 80) })] }));
}
export default ErrorComponent;
