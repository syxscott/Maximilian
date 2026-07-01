import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import { Box, Text, useInput } from "ink";
import { Dialog, useDialog } from "./dialog";
const OPTIONS = ["cancel", "confirm"];
const DEFAULT_COLORS = {
    text: "white",
    textMuted: "gray",
    primary: "cyan",
    selectedListItemText: "black",
};
function titleCase(input) {
    if (!input)
        return input;
    return input.charAt(0).toUpperCase() + input.slice(1);
}
export function DialogConfirm(props) {
    const dialog = useDialog();
    const [active, setActive] = React.useState("confirm");
    useInput((input, key) => {
        if (key.return) {
            if (active === "confirm")
                props.onConfirm?.();
            if (active === "cancel")
                props.onCancel?.();
            dialog.clear();
            return;
        }
        if (key.leftArrow || key.rightArrow) {
            setActive((prev) => (prev === "confirm" ? "cancel" : "confirm"));
        }
    });
    return (_jsx(Dialog, { size: "medium", onClose: () => dialog.clear(), children: _jsxs(Box, { flexDirection: "column", paddingLeft: 2, paddingRight: 2, gap: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, color: DEFAULT_COLORS.text, children: props.title }), _jsx(Text, { color: DEFAULT_COLORS.textMuted, children: "esc" })] }), _jsx(Box, { paddingBottom: 1, children: _jsx(Text, { color: DEFAULT_COLORS.textMuted, children: props.message }) }), _jsx(Box, { flexDirection: "row", justifyContent: "flex-end", paddingBottom: 1, children: OPTIONS.map((key) => {
                        const isActive = key === active;
                        const labelText = titleCase(key === "cancel" ? props.label ?? key : key);
                        // Highlight the active option by wrapping its label in a Text with
                        // backgroundColor and inverse colors. ink doesn't expose
                        // backgroundColor on Box, so we put the highlight on the inner Text.
                        return (_jsx(Box, { paddingLeft: 1, paddingRight: 1, children: _jsx(Text, { color: isActive ? DEFAULT_COLORS.selectedListItemText : DEFAULT_COLORS.textMuted, backgroundColor: isActive ? DEFAULT_COLORS.primary : undefined, children: labelText }) }, key));
                    }) })] }) }));
}
DialogConfirm.show = (dialog, title, message, label) => {
    return new Promise((resolve) => {
        dialog.replace(_jsx(DialogConfirm, { title: title, message: message, onConfirm: () => resolve(true), onCancel: () => resolve(false), label: label }), { onClose: () => resolve(undefined) });
    });
};
export default DialogConfirm;
