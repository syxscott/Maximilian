import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { t } from "@max/i18n";
function getRelativeTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (seconds < 60)
        return "just now";
    if (minutes < 60)
        return `${minutes}m ago`;
    if (hours < 24)
        return `${hours}h ago`;
    if (days < 7)
        return `${days}d ago`;
    const date = new Date(timestamp);
    return date.toISOString();
}
function getStashPreview(input, maxLength = 50) {
    const firstLine = input.split("\n")[0].trim();
    if (firstLine.length <= maxLength)
        return firstLine;
    return firstLine.slice(0, Math.max(0, maxLength - 1)) + "…";
}
export function DialogStash(props) {
    const [toDelete, setToDelete] = useState(undefined);
    useInput((input, key) => {
        if (key.escape) {
            setToDelete(undefined);
        }
    });
    const items = useMemo(() => {
        return props.entries
            .map((entry, index) => {
            const isDeleting = toDelete === index;
            const lineCount = (entry.input.match(/\n/g)?.length ?? 0) + 1;
            return {
                label: isDeleting
                    ? `Press ${props.deleteHint ?? "delete"} again to confirm`
                    : getStashPreview(entry.input),
                value: index,
                description: getRelativeTime(entry.timestamp),
                footer: lineCount > 1 ? `~${lineCount} lines` : undefined,
            };
        })
            .reverse();
    }, [props.entries, toDelete, props.deleteHint]);
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: t("tui.stash") }), _jsx(Text, { dimColor: true, children: "esc" })] }), _jsx(Box, { marginTop: 1, children: _jsx(SelectInput, { items: items, onSelect: (item) => {
                        const entry = props.entries[item.value];
                        if (entry) {
                            props.onSelect?.(entry);
                        }
                    }, itemComponent: ({ isSelected, label, value, description, footer }) => (_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { color: isSelected ? "green" : toDelete === value ? "red" : undefined, children: label }), description && _jsxs(Text, { dimColor: true, children: ["  ", description] })] }), footer && _jsx(Text, { dimColor: true, children: footer })] })) }) }), toDelete !== undefined && (_jsx(Box, { marginTop: 1, children: _jsx(Text, { color: "red", children: t("tui.confirmRemoval") }) }))] }));
}
DialogStash.confirmDelete = (item, current, set, remove) => {
    if (current === item.value) {
        remove?.(item.value);
        set?.(undefined);
        return;
    }
    set?.(item.value);
};
export default DialogStash;
