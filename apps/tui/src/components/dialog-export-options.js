import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useMemo, useState } from "react";
import { t } from "@max/i18n";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
const FORMATS = [
    { label: "JSON", value: "json", description: "Machine-readable structured data" },
    { label: "Markdown", value: "markdown", description: "Human-readable formatted text" },
    { label: "Plain Text", value: "text", description: "Unformatted text only" },
    { label: "HTML", value: "html", description: "Web page renderable export" },
];
export function DialogExportOptions(props) {
    const [format, setFormat] = useState(props.defaultFormat ?? "markdown");
    const [includeToolCalls, setIncludeToolCalls] = useState(true);
    const [includeTimestamps, setIncludeTimestamps] = useState(false);
    const [includeThinking, setIncludeThinking] = useState(false);
    const [prettyPrint, setPrettyPrint] = useState(true);
    const [view, setView] = useState("format");
    useInput((input, key) => {
        if (key.escape)
            props.onCancel?.();
    });
    const formatItems = useMemo(() => FORMATS.map((f) => ({ label: f.label, value: f.value })), []);
    const optionItems = useMemo(() => [
        {
            label: `Include tool calls: ${includeToolCalls ? "yes" : "no"}`,
            value: "toolCalls",
        },
        {
            label: `Include timestamps: ${includeTimestamps ? "yes" : "no"}`,
            value: "timestamps",
        },
        {
            label: `Include thinking: ${includeThinking ? "yes" : "no"}`,
            value: "thinking",
        },
        {
            label: `Pretty print: ${prettyPrint ? "yes" : "no"}`,
            value: "prettyPrint",
        },
        {
            label: "Export now",
            value: "submit",
        },
    ], [includeToolCalls, includeTimestamps, includeThinking, prettyPrint]);
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: t("tui.exportOptions") }), _jsx(Text, { dimColor: true, children: "esc" })] }), _jsxs(Box, { marginY: 1, children: [_jsx(Text, { children: "Format: " }), _jsx(Text, { color: "cyan", children: format })] }), view === "format" ? (_jsxs(Box, { flexDirection: "column", children: [_jsx(Box, { marginBottom: 1, children: _jsx(Text, { dimColor: true, children: t("tui.chooseAFormat") }) }), _jsx(SelectInput, { items: formatItems, onSelect: (item) => {
                            setFormat(item.value);
                            setView("options");
                        }, itemComponent: ({ isSelected, label, value }) => (_jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { color: isSelected ? "green" : undefined, children: label }), value === format && _jsx(Text, { dimColor: true, children: " (current)" })] })) })] })) : (_jsx(Box, { flexDirection: "column", children: _jsx(SelectInput, { items: optionItems, onSelect: (item) => {
                        switch (item.value) {
                            case "toolCalls":
                                setIncludeToolCalls((v) => !v);
                                break;
                            case "timestamps":
                                setIncludeTimestamps((v) => !v);
                                break;
                            case "thinking":
                                setIncludeThinking((v) => !v);
                                break;
                            case "prettyPrint":
                                setPrettyPrint((v) => !v);
                                break;
                            case "submit":
                                void props.onConfirm?.({
                                    format,
                                    includeToolCalls,
                                    includeTimestamps,
                                    includeThinking,
                                    prettyPrint,
                                });
                                break;
                        }
                    } }) }))] }));
}
export default DialogExportOptions;
