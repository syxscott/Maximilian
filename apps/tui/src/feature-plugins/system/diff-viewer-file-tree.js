import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useMemo, useEffect } from "react";
import { Box, Text } from "ink";
import { Locale } from "../../util/locale";
import { buildFileTree, flattenFileTree } from "./diff-viewer-file-tree-utils";
import { Panel } from "./diff-viewer-ui";
const FILE_TREE_STATUS_WIDTH = 2;
export function DiffViewerFileTree(props) {
    const tree = useMemo(() => buildFileTree(props.files), [props.files]);
    const rows = useMemo(() => flattenFileTree(tree, props.expandedNodes), [tree, props.expandedNodes]);
    useEffect(() => {
        const node = props.highlightedNode;
        if (node === undefined)
            return;
        const selectedIndex = rows.findIndex((row) => row.id === node);
        if (selectedIndex === -1)
            return;
        // scroll-to logic would be handled by a scroll container in ink
    }, [props.highlightedNode, rows]);
    const fadedColor = useMemo(() => {
        // tint approximation: blend text color toward background
        return props.theme.textMuted;
    }, [props.theme.text, props.theme.background]);
    if (props.loading || props.error) {
        return (_jsx(Panel, { border: "both", width: props.width, children: _jsx(Text, {}) }));
    }
    if (props.files.length === 0) {
        return (_jsx(Panel, { border: "both", width: props.width, children: _jsx(Text, { color: props.theme.text, children: "No files" }) }));
    }
    return (_jsx(Panel, { border: "both", width: props.width, children: _jsx(Box, { flexDirection: "column", overflow: "hidden", children: rows.map((row, index) => {
                const highlighted = props.focused && props.highlightedNode === row.id;
                const selected = row.fileIndex !== undefined && props.selectedFileIndex === row.fileIndex;
                const file = row.fileIndex === undefined ? undefined : props.files[row.fileIndex]?.file;
                const reviewed = file !== undefined && (props.reviewedFileNames?.has(file) ?? false);
                const prefix = fileTreeRowPrefix(rows, index, row, props.expandedNodes);
                const status = fileTreeRowStatus(row, props.files, reviewed);
                const name = Locale.truncate(row.name, Math.max(1, props.width - FILE_TREE_STATUS_WIDTH - prefix.length));
                return (_jsxs(Box, { flexDirection: "row", width: "100%", backgroundColor: highlighted ? props.theme.primary : undefined, onClick: () => props.onRowClick?.(row), children: [_jsx(Text, { color: highlighted ? props.theme.background : fadedColor, wrap: "truncate-end", children: prefix }), _jsx(Box, { flexGrow: 1, minWidth: 0, children: _jsx(Text, { color: highlighted
                                    ? props.theme.background
                                    : selected
                                        ? props.theme.primary
                                        : reviewed || row.kind === "directory"
                                            ? props.theme.textMuted
                                            : props.theme.text, wrap: "truncate-end", children: name }) }), _jsx(Text, { color: highlighted ? props.theme.background : props.theme.textMuted, wrap: "truncate-end", children: status })] }, row.id));
            }) }) }));
}
function fileTreeRowPrefix(rows, index, row, expandedNodes) {
    const indentation = Array.from({ length: row.depth }, (_, depth) => {
        if (depth === 0 && !hasLaterSibling(rows, 0, 0))
            return " ";
        return hasLaterSibling(rows, index, depth) ? "│  " : "   ";
    }).join("");
    const topRoot = index === 0 && row.depth === 0;
    const branch = topRoot ? " " : hasLaterSibling(rows, index, row.depth) ? "├─ " : "└─ ";
    const marker = row.kind === "directory" ? (expandedNodes && !expandedNodes.has(row.id) ? "▸ " : "▾ ") : "";
    return `${indentation}${branch}${marker}`;
}
function hasLaterSibling(rows, index, depth) {
    return rows.slice(index + 1).find((row) => row.depth <= depth)?.depth === depth;
}
function fileTreeRowStatus(row, files, reviewed) {
    if (row.fileIndex === undefined)
        return "";
    const status = files[row.fileIndex]?.status;
    const marker = status === "modified" ? "M" : status === "added" ? "A" : status === "deleted" ? "D" : "?";
    return `${reviewed ? "✓" : " "}${marker}`.padStart(FILE_TREE_STATUS_WIDTH);
}
