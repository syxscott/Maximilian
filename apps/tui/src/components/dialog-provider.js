import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { t } from "@max/i18n";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
const PROVIDER_PRIORITY = {
    opencode: 0,
    "opencode-go": 1,
    openai: 2,
    "github-copilot": 3,
    anthropic: 4,
    google: 5,
};
const CUSTOM_PROVIDER_OPTION_VALUE = "__opencode_custom_provider__";
const CUSTOM_PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/;
export function normalizeCustomProviderID(value) {
    const providerID = value.trim().replace(/^@ai-sdk\//, "");
    if (!CUSTOM_PROVIDER_ID.test(providerID))
        return undefined;
    return providerID;
}
export function providerOptions(list) {
    return [
        ...[...list]
            .sort((a, b) => {
            const pa = PROVIDER_PRIORITY[a.id] ?? 99;
            const pb = PROVIDER_PRIORITY[b.id] ?? 99;
            if (pa !== pb)
                return pa - pb;
            const an = a.name.toLowerCase();
            const bn = b.name.toLowerCase();
            if (an !== bn)
                return an < bn ? -1 : 1;
            return a.id.localeCompare(b.id);
        })
            .map((provider) => ({
            type: "provider",
            title: provider.name,
            value: provider.id,
            providerID: provider.id,
            description: {
                opencode: "(Recommended)",
                anthropic: "(API key)",
                openai: "(ChatGPT Plus/Pro or API key)",
                "opencode-go": "Low cost subscription for everyone",
            }[provider.id],
        })),
        {
            type: "custom",
            title: "Other",
            value: CUSTOM_PROVIDER_OPTION_VALUE,
            description: "Custom provider",
        },
    ];
}
export function DialogProvider(props) {
    const items = useMemo(() => {
        return providerOptions(props.providers).map((provider) => {
            if (provider.type === "custom") {
                return {
                    label: provider.title,
                    value: provider.value,
                    description: provider.description,
                    category: "Providers",
                    onSelect: () => props.onSelectCustom?.(),
                };
            }
            const connected = props.connectedProviderIDs?.includes(provider.providerID);
            return {
                label: provider.title,
                value: provider.value,
                description: provider.description,
                category: provider.providerID in PROVIDER_PRIORITY ? "Popular" : "Providers",
                onSelect: () => props.onSelectProvider?.(provider.providerID),
            };
        });
    }, [props.providers, props.connectedProviderIDs, props.onSelectProvider, props.onSelectCustom]);
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: t("tui.connectAProvider") }), _jsx(Text, { dimColor: true, children: "esc" })] }), _jsx(Box, { marginTop: 1, children: _jsx(SelectInput, { items: items, onSelect: (item) => item.onSelect?.(), itemComponent: ({ isSelected, label }) => (_jsx(Text, { color: isSelected ? "green" : undefined, children: label })) }) })] }));
}
export function AutoMethod(props) {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setTick((v) => v + 1), 1000);
        return () => clearInterval(t);
    }, []);
    useInput((input, key) => {
        if (input === "c") {
            const match = props.authorization.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/);
            const code = match?.[0] ?? props.authorization.url;
            props.onCopyCode?.(code);
        }
    });
    useEffect(() => {
        void props.onAwaitCallback?.();
    }, []);
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingBottom: 1, gap: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: props.title }), _jsx(Text, { dimColor: true, children: "esc" })] }), _jsxs(Box, { flexDirection: "column", gap: 1, children: [_jsx(Text, { color: "blue", children: props.authorization.url }), _jsx(Text, { dimColor: true, children: props.authorization.instructions })] }), _jsxs(Text, { dimColor: true, children: ["Waiting for authorization... ", tick, "s"] }), _jsx(Box, { children: _jsxs(Text, { children: ["c ", _jsx(Text, { dimColor: true, children: "copy" })] }) })] }));
}
export function CodeMethod(props) {
    const [code, setCode] = useState("");
    const [error, setError] = useState(false);
    useInput((input, key) => {
        if (key.escape)
            props.onCancel?.();
    });
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, gap: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: props.title }), _jsx(Text, { dimColor: true, children: "esc" })] }), _jsxs(Box, { flexDirection: "column", gap: 1, children: [_jsx(Text, { dimColor: true, children: props.authorization.instructions }), _jsx(Text, { color: "blue", children: props.authorization.url }), error && _jsx(Text, { color: "red", children: t("tui.invalidCode") })] }), _jsxs(Box, { children: [_jsx(Text, { children: "Code: " }), _jsx(TextInput, { value: code, onChange: setCode, onSubmit: async (value) => {
                            const ok = await props.onSubmit?.(value);
                            if (!ok)
                                setError(true);
                        } })] })] }));
}
export function ApiMethod(props) {
    const [value, setValue] = useState("");
    useInput((input, key) => {
        if (key.escape)
            props.onCancel?.();
    });
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, gap: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: props.title }), _jsx(Text, { dimColor: true, children: "esc" })] }), props.description ? _jsx(Box, { children: props.description }) : null, _jsxs(Box, { children: [_jsx(Text, { children: "API key: " }), _jsx(TextInput, { value: value, onChange: setValue, onSubmit: (v) => {
                            if (!v.trim())
                                return;
                            void props.onSubmit?.(v.trim());
                        } })] })] }));
}
export function DialogPrompt(props) {
    const [value, setValue] = useState(props.initialValue ?? "");
    useInput((input, key) => {
        if (key.escape)
            props.onCancel?.();
    });
    if (props.options && props.options.length > 0) {
        return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: props.title }), _jsx(Text, { dimColor: true, children: "esc" })] }), props.description && _jsx(Box, { marginY: 1, children: props.description }), _jsx(Box, { marginTop: 1, children: _jsx(SelectInput, { items: props.options.map((o) => ({ label: o.label, value: o.value })), onSelect: (item) => void props.onConfirm?.(item.value) }) })] }));
    }
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: props.title }), _jsx(Text, { dimColor: true, children: "esc" })] }), props.description && _jsx(Box, { marginY: 1, children: props.description }), _jsxs(Box, { children: [_jsxs(Text, { children: [props.placeholder ?? "Value", ": "] }), _jsx(TextInput, { value: value, onChange: setValue, onSubmit: (v) => void props.onConfirm?.(v) })] })] }));
}
DialogPrompt.show = (props) => {
    return new Promise((resolve) => {
        resolve(null);
        void props;
    });
};
export default DialogProvider;
