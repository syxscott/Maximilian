import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { t } from "@max/i18n";
export function DialogSessionRename(props) {
    const [value, setValue] = useState(props.initial ?? "");
    useEffect(() => {
        if (props.initial !== undefined)
            setValue(props.initial);
    }, [props.initial]);
    useInput((input, key) => {
        if (key.escape)
            props.onCancel?.();
    });
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: t("tui.renameSession") }), _jsx(Text, { dimColor: true, children: "esc" })] }), _jsxs(Box, { marginTop: 1, children: [_jsx(Text, { children: "New title: " }), _jsx(TextInput, { value: value, onChange: setValue, onSubmit: (v) => {
                            const trimmed = v.trim();
                            if (trimmed.length === 0)
                                return;
                            void props.onConfirm?.(trimmed);
                        } })] })] }));
}
export default DialogSessionRename;
