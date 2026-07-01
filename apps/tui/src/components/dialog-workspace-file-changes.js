import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
const OPTIONS = ["no", "yes"];
function statusLabel(status) {
    if (status === "added")
        return "A";
    if (status === "deleted")
        return "D";
    return "M";
}
function changeCountText(file) {
    return `${file.additions ? `+${file.additions}` : ""}${file.deletions ? ` -${file.deletions}` : ""}`;
}
function changeCountWidth(file) {
    return changeCountText(file).length + 2;
}
function truncateLeft(input, maxLength) {
    if (maxLength <= 0)
        return "";
    if (input.length <= maxLength)
        return input;
    return "…" + input.slice(input.length - maxLength + 1);
}
export function DialogWorkspaceFileChanges(props) {
    const [active, setActive] = useState("yes");
    const visibleCount = Math.min(props.files.length, 8);
    const fileNameWidth = useMemo(() => 48 -
        Math.max(Math.max(7, ...props.files.map(changeCountWidth)) - 7, 0), [props.files]);
    function confirm() {
        props.onSelect(active);
    }
    useInput((input, key) => {
        if (key.return) {
            confirm();
            return;
        }
        if (key.leftArrow) {
            const index = OPTIONS.indexOf(active);
            setActive(OPTIONS[Math.max(index - 1, 0)]);
            return;
        }
        if (key.rightArrow) {
            const index = OPTIONS.indexOf(active);
            setActive(OPTIONS[Math.min(index + 1, OPTIONS.length - 1)]);
        }
    });
    const slice = props.files.slice(0, visibleCount);
    return (_jsxs(Box, { flexDirection: "column", gap: 1, paddingX: 2, paddingBottom: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: props.title ?? "File Changes Found" }), _jsx(Text, { dimColor: true, children: "esc" })] }), _jsx(Box, { children: _jsx(Text, { dimColor: true, wrap: "word", children: props.message ?? "Do you want to move these changes with the session?" }) }), _jsx(Box, { flexDirection: "column", children: slice.map((item, i) => (_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsxs(Box, { flexDirection: "row", flexShrink: 1, minWidth: 0, children: [_jsx(Box, { width: 2, flexShrink: 0, children: _jsx(Text, { dimColor: true, children: statusLabel(item.status) }) }), _jsx(Text, { dimColor: true, wrap: "none", children: truncateLeft(item.file, fileNameWidth) })] }), _jsx(Box, { flexDirection: "row", gap: 1, minWidth: 7, flexShrink: 0, justifyContent: "flex-end", children: _jsxs(Text, { children: [item.additions ? _jsxs(Text, { color: "green", children: ["+", item.additions] }) : null, item.deletions ? _jsxs(Text, { color: "red", children: [" -", item.deletions] }) : null] }) })] }, `${item.file}-${i}`))) }), _jsx(Box, { flexDirection: "row", justifyContent: "flex-end", paddingBottom: 1, children: OPTIONS.map((item) => (_jsx(Box, { paddingX: 2, backgroundColor: item === active ? "blue" : undefined, children: _jsx(Text, { color: item === active ? "white" : undefined, children: item }) }, item))) })] }));
}
DialogWorkspaceFileChanges.show = (files, options) => {
    return new Promise((resolve) => {
        // Caller in React tree is expected to mount this component; this helper
        // preserves the OpenCode static API but resolution requires the host.
        resolve(undefined);
        void options;
        void files;
    });
};
export default DialogWorkspaceFileChanges;
