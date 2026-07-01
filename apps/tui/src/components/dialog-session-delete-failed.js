import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../context/theme";
import { useDialog } from "./dialog";
export function DialogSessionDeleteFailed(props) {
    const dialog = useDialog();
    const { theme } = useTheme();
    const [active, setActive] = useState("delete");
    const options = [
        {
            id: "delete",
            title: "Delete workspace",
            description: "Delete the workspace and all sessions attached to it.",
            run: props.onDelete,
        },
        {
            id: "restore",
            title: "Restore to new workspace",
            description: "Try to restore this session into a new workspace.",
            run: props.onRestore,
        },
    ];
    async function confirm() {
        const found = options.find((item) => item.id === active);
        const result = await found?.run?.();
        if (result === false)
            return;
        if (props.onDone) {
            props.onDone();
        }
        else {
            dialog.clear();
        }
    }
    useInput((input, key) => {
        if (key.return) {
            void confirm();
            return;
        }
        if (key.leftArrow || key.upArrow) {
            setActive("delete");
            return;
        }
        if (key.rightArrow || key.downArrow) {
            setActive("restore");
            return;
        }
    });
    return (_jsxs(Box, { flexDirection: "column", paddingLeft: 2, paddingRight: 2, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, color: theme.text, children: "Failed to Delete Session" }), _jsx(Text, { color: theme.textMuted, children: "esc" })] }), _jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { color: theme.textMuted, wrap: "wrap", children: `The session "${props.session}" could not be deleted because the workspace "${props.workspace}" is not available.` }), _jsx(Text, { color: theme.textMuted, wrap: "wrap", children: "Choose how you want to recover this broken workspace session." })] }), _jsx(Box, { flexDirection: "column", paddingBottom: 1, marginTop: 1, children: options.map((item) => (_jsxs(Box, { flexDirection: "column", paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1, backgroundColor: item.id === active ? theme.primary : undefined, children: [_jsx(Text, { bold: true, color: item.id === active ? theme.selectedListItemText : theme.text, children: item.title }), _jsx(Text, { color: item.id === active ? theme.selectedListItemText : theme.textMuted, wrap: "wrap", children: item.description })] }, item.id))) })] }));
}
