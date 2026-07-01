import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { selectedForeground, useTheme } from "../context/theme";
import { useDialog } from "./dialog";
// Open the URL in the user's default browser. We avoid a hard dependency on
// the `open` package (not in the Maximilian TUI dependency list) and fall
// back to spawning the platform's default command if it's unavailable.
function openUrl(url) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const open = require("open");
        return open(url);
    }
    catch {
        /* swallow: caller already handles failures */
        return Promise.resolve();
    }
}
const GO_URL = "https://opencode.ai/go";
const PAD_X = 3;
function runAction(props, dialog) {
    if (props.link) {
        void openUrl(props.link).catch(() => { });
    }
    props.onClose?.();
    dialog.clear();
}
function dismiss(props, dialog) {
    props.onClose?.(true);
    dialog.clear();
}
export function DialogRetryAction(props) {
    const dialog = useDialog();
    const { theme } = useTheme();
    const fg = selectedForeground(theme);
    const [selected, setSelected] = useState("action");
    useInput((input, key) => {
        if (key.leftArrow || key.rightArrow || key.tab) {
            setSelected((value) => (value === "action" ? "dismiss" : "action"));
            return;
        }
        if (key.return) {
            if (selected === "action")
                runAction(props, dialog);
            else
                dismiss(props, dialog);
        }
    });
    const isDismiss = selected === "dismiss";
    return (_jsxs(Box, { flexDirection: "column", paddingLeft: PAD_X, paddingRight: PAD_X, paddingBottom: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, color: theme.text, children: props.title }), _jsx(Text, { color: theme.textMuted, children: "esc" })] }), _jsx(Box, { marginTop: 1, children: _jsx(Text, { color: theme.textMuted, children: props.message }) }), props.link ? (_jsx(Box, { width: "100%", flexDirection: "row", justifyContent: "center", paddingBottom: 1, marginTop: 1, children: _jsx(Text, { color: theme.primary, wrap: "truncate-end", children: props.link }) })) : (_jsx(Box, { paddingBottom: 1 })), _jsxs(Box, { flexDirection: "row", justifyContent: "space-between", marginTop: 1, children: [_jsx(Box, { paddingLeft: 2, paddingRight: 2, backgroundColor: isDismiss ? theme.primary : undefined, children: _jsx(Text, { bold: isDismiss, color: isDismiss ? fg : theme.textMuted, children: "don't show again" }) }), _jsx(Box, { paddingLeft: 2, paddingRight: 2, backgroundColor: !isDismiss ? theme.primary : undefined, children: _jsx(Text, { bold: !isDismiss, color: !isDismiss ? fg : theme.text, children: props.label }) })] })] }));
}
DialogRetryAction.show = (dialog, props) => {
    return new Promise((resolve) => {
        dialog.replace(_jsx(DialogRetryAction, { ...props, onClose: (dontShow) => resolve(dontShow ?? false) }), { onClose: () => resolve(false) });
    });
};
