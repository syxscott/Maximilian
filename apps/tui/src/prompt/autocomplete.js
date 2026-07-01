import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
// @ts-nocheck
/**
 * Autocomplete dropdown for `@mentions` and `/commands`.
 *
 * Ported from OpenCode's `prompt/autocomplete.tsx`. The original used a
 * custom `<scrollbox>` overlay anchored to the textarea; we render a simpler
 * list above the prompt when active.
 *
 * The component is intentionally API-compatible with the OpenCode version so
 * the existing `Prompt` parent can reuse the same `setPrompt` / `setExtmark`
 * callbacks.
 */
import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { Box, Text } from "ink";
import fuzzysort from "fuzzysort";
import { useSync } from "../context/sync";
import { useSDK } from "../context/sdk";
import { useTheme } from "../context/theme";
export const Autocomplete = forwardRef(function Autocomplete(props, forwardedRef) {
    const sync = useSync();
    const sdk = useSDK();
    const { theme } = useTheme();
    const [visible, setVisible] = useState(false);
    const [triggerIndex, setTriggerIndex] = useState(0);
    const [selected, setSelected] = useState(0);
    const [files, setFiles] = useState([]);
    const handle = useRef(undefined);
    // -- Search ---------------------------------------------------------------
    const query = useMemo(() => {
        if (!visible)
            return "";
        return props.input().getTextRange(triggerIndex + 1, props.input().cursorOffset);
    }, [visible, triggerIndex, props.value, props]);
    useEffect(() => {
        if (visible !== "@") {
            setFiles([]);
            return;
        }
        let cancelled = false;
        const t = setTimeout(() => {
            sdk.client
                .get(`/fs/find?query=${encodeURIComponent(query)}&limit=20`)
                .then((res) => {
                if (cancelled)
                    return;
                const width = Math.max(40, props.anchor().width - 4);
                setFiles((res.data ?? []).map((item) => ({
                    display: item.path.length > width ? item.path.slice(0, width - 1) + "…" : item.path,
                    value: item.path,
                    isDirectory: item.type === "directory",
                    path: item.path,
                    onSelect: () => insertPart(item.path),
                })));
            })
                .catch(() => {
                if (!cancelled)
                    setFiles([]);
            });
        }, 80);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [query, visible, sdk, props]);
    // -- Option lists ---------------------------------------------------------
    const agents = useMemo(() => sync.data.agent
        .filter((a) => !a.hidden && a.mode !== "primary")
        .map((a) => ({
        display: `@${a.name}`,
        onSelect: () => insertPart(a.name, {
            type: "agent",
            name: a.name,
            source: { start: 0, end: 0, value: "" },
        }),
    })), [sync.data.agent]);
    const commands = useMemo(() => sync.data.command
        .filter((c) => c.source !== "skill")
        .map((c) => ({
        display: `/${c.name}`,
        description: c.description,
        onSelect: () => {
            // Replace input text with the command + trailing space.
            props.setPrompt((draft) => {
                draft.input = `/${c.name} `;
                draft.parts = [];
            });
        },
    })), [sync.data.command]);
    // -- Option assembly ------------------------------------------------------
    const options = useMemo(() => {
        if (!visible)
            return [];
        const list = visible === "/" ? commands : [...agents, ...files];
        if (!query)
            return list.slice(0, 10);
        const fuzzied = fuzzysort.go(query, list, {
            keys: [
                (obj) => (obj.value ?? obj.display).trimEnd(),
                ...(visible === "/" ? ["description"] : []),
            ],
            threshold: visible === "@" ? 0.5 : 0,
            limit: 10,
        });
        return fuzzied.map((r) => r.obj);
    }, [visible, agents, files, commands, query]);
    useEffect(() => {
        setSelected(0);
    }, [options.length]);
    // -- Insertion ------------------------------------------------------------
    function insertPart(text, part) {
        const next = `@${text} `;
        const plain = props.input().plainText;
        const head = plain.slice(0, triggerIndex);
        props.setPrompt((draft) => {
            draft.input = head + next;
            if (part)
                draft.parts.push(part);
        });
        setVisible(false);
        void plain;
    }
    function select() {
        const choice = options[selected];
        if (!choice)
            return;
        setVisible(false);
        choice.onSelect?.();
    }
    // -- Public API -----------------------------------------------------------
    useImperativeHandle(forwardedRef, () => ({
        get visible() {
            return visible;
        },
        onInput(value) {
            const offset = value.length;
            if (offset === 0)
                return;
            if (value.startsWith("/") && !value.slice(0, offset).match(/\s/)) {
                setVisible("/");
                setTriggerIndex(0);
                return;
            }
            const idx = value.lastIndexOf("@", offset - 1);
            if (idx !== -1 && !value.slice(idx, offset).match(/\s/)) {
                setVisible("@");
                setTriggerIndex(idx);
            }
        },
    }));
    // Mirror the imperative API onto the parent's `ref` prop.
    useEffect(() => {
        handle.current = {
            get visible() {
                return visible;
            },
            onInput(value) {
                const offset = value.length;
                if (offset === 0)
                    return;
                if (value.startsWith("/") && !value.slice(0, offset).match(/\s/)) {
                    setVisible("/");
                    setTriggerIndex(0);
                    return;
                }
                const idx = value.lastIndexOf("@", offset - 1);
                if (idx !== -1 && !value.slice(idx, offset).match(/\s/)) {
                    setVisible("@");
                    setTriggerIndex(idx);
                }
            },
        };
        props.ref?.(handle.current);
        return () => props.ref?.(undefined);
    }, [visible, props]);
    if (!visible || options.length === 0)
        return null;
    return (_jsx(Box, { flexDirection: "column", marginTop: 1, borderStyle: "round", borderColor: theme.border, paddingLeft: 1, paddingRight: 1, children: options.map((option, index) => (_jsx(Box, { flexDirection: "row", children: _jsxs(Text, { color: index === selected ? theme.primary : theme.text, children: [option.display, option.description ? _jsxs(Text, { color: theme.textMuted, children: ["  ", option.description] }) : null] }) }, option.display + index))) }));
});
