import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../context/theme";
import { useDialog } from "./dialog";
const OPTIONS = ["cancel", "restore"];
export function DialogWorkspaceUnavailable(props) {
    const dialog = useDialog();
    const { theme } = useTheme();
    const [active, setActive] = useState("restore");
    async function confirm() {
        if (active === "cancel") {
            dialog.clear();
            return;
        }
        const result = await props.onRestore?.();
        if (result === false)
            return;
    }
    useInput((input, key) => {
        if (key.return) {
            void confirm();
            return;
        }
        if (key.leftArrow) {
            setActive("cancel");
            return;
        }
        if (key.rightArrow) {
            setActive("restore");
            return;
        }
    });
    return (_jsxs(Box, { flexDirection: "column", paddingLeft: 2, paddingRight: 2, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, color: theme.text, children: "Workspace Unavailable" }), _jsx(Text, { color: theme.textMuted, children: "esc" })] }), _jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { color: theme.textMuted, wrap: "wrap", children: "This session is attached to a workspace that is no longer available." }), _jsx(Text, { color: theme.textMuted, wrap: "wrap", children: "Would you like to restore this session into a new workspace?" })] }), _jsx(Box, { flexDirection: "row", justifyContent: "flex-end", paddingBottom: 1, marginTop: 1, gap: 1, children: OPTIONS.map((item) => (_jsx(Box, { paddingLeft: 2, paddingRight: 2, backgroundColor: item === active ? theme.primary : undefined, children: _jsx(Text, { color: item === active ? theme.selectedListItemText : theme.textMuted, children: item }) }, item))) })] }));
}
