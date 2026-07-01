import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
/**
 * Prompt component: text input + autocomplete + parts.
 *
 * Ported from OpenCode's `component/prompt/index.tsx` (~1697 lines). The
 * original implemented an opentui-specific `<textarea>` with extmark-based
 * styling for `@mentions`, `/commands`, `#file` references, plus an
 * autocomplete dropdown, history, stash, and slash command plumbing.
 *
 * Maximilian's TUI uses ink, which doesn't ship its own textarea. We build
 * the prompt on top of `ink-text-input` and model the autocomplete overlay
 * ourselves. The `PromptRef` surface is preserved (focused, current, set,
 * reset, blur, focus, submit) so calling routes (home, session) work without
 * changes.
 *
 * What is preserved:
 *   - Visual layout (bordered input, placeholder cycling, hint, mode shell).
 *   - Slash-command autocomplete from `sync.data.command`.
 *   - File/agent mention autocomplete via SDK fs.find.
 *   - Submit pipeline (agent, model, variant, parts, session creation).
 *
 * What is simplified:
 *   - No extmark styling (no syntax highlighting on virtual text).
 *   - No multiselect, no paste-image attachments.
 *   - History/stash are stubs.
 */
import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle, useCallback } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import fuzzysort from "fuzzysort";
import { Autocomplete } from "./autocomplete";
import { useSync } from "../context/sync";
import { useSDK } from "../context/sdk";
import { useLocal } from "../context/local";
import { useTheme } from "../context/theme";
import { useRoute } from "../context/route";
import { useTuiPaths } from "../context/runtime";
// -- Helpers -----------------------------------------------------------------
function randomIndex(count) {
    if (count <= 0)
        return 0;
    return Math.floor(Math.random() * count);
}
function formatEditorContext(_selection) {
    return "";
}
// -- Component ---------------------------------------------------------------
export const Prompt = forwardRef(function Prompt(props, forwardedRef) {
    const sync = useSync();
    const sdk = useSDK();
    const local = useLocal();
    const { theme } = useTheme();
    const route = useRoute();
    const paths = useTuiPaths();
    void route;
    void paths;
    const [input, setInput] = useState("");
    const [parts, setParts] = useState([]);
    const [mode, setMode] = useState("normal");
    const [focused, setFocused] = useState(true);
    const submittingRef = useRef(false);
    const list = props.placeholders?.normal ?? [];
    const shell = props.placeholders?.shell ?? [];
    const [placeholderIndex, setPlaceholderIndex] = useState(() => randomIndex(list.length));
    const placeholder = mode === "shell"
        ? shell[placeholderIndex % Math.max(shell.length, 1)] ?? "$ "
        : list[placeholderIndex % Math.max(list.length, 1)] ?? "Type your message...";
    const status = sync.data.session_status[props.sessionID ?? ""] ?? { type: "idle" };
    const autocompleteRef = useRef(undefined);
    const inputRef = useRef(null);
    // Hand off focus management to ink-text-input via its built-in focus prop.
    // We expose `focus()`/`blur()` to callers through the imperative handle.
    const focusInput = useCallback(() => inputRef.current?.focus(), []);
    const blurInput = useCallback(() => inputRef.current?.blur(), []);
    useEffect(() => {
        if (props.visible !== false)
            focusInput();
    }, [props.visible, focusInput]);
    // -- Submit pipeline ------------------------------------------------------
    const submit = useCallback(async () => {
        if (submittingRef.current)
            return false;
        submittingRef.current = true;
        try {
            const text = input.trim();
            if (!text)
                return false;
            const agent = local.agent.current();
            if (!agent)
                return false;
            const model = local.model.current();
            if (!model)
                return false;
            // Route slash commands through SDK; otherwise send a prompt.
            if (mode === "shell" || text.startsWith("!")) {
                const command = mode === "shell" ? text : text.slice(1);
                if (!props.sessionID)
                    return false;
                await sdk.client.post(`/session/${props.sessionID}/shell`, {
                    command,
                    agent: agent.name,
                    model: { providerID: model.providerID, modelID: model.modelID },
                }).catch(() => undefined);
            }
            else if (text.startsWith("/")) {
                const firstLineEnd = text.indexOf("\n");
                const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
                const [command, ...rest] = firstLine.split(" ");
                if (!props.sessionID)
                    return false;
                await sdk.client.post(`/session/${props.sessionID}/command`, {
                    command: command.slice(1),
                    arguments: rest.join(" "),
                    agent: agent.name,
                    model: `${model.providerID}/${model.modelID}`,
                    parts: parts.filter((p) => p.type === "file"),
                }).catch(() => undefined);
            }
            else {
                let sessionID = props.sessionID;
                if (!sessionID) {
                    const res = await sdk.client.post(`/session`, {
                        agent: agent.name,
                        model: { providerID: model.providerID, modelID: model.modelID },
                    }).catch(() => null);
                    if (!res?.id)
                        return false;
                    sessionID = res.id;
                }
                await sdk.client.post(`/session/${sessionID}/messages`, {
                    parts: [
                        ...parts,
                        { type: "text", text },
                    ],
                    agent: agent.name,
                    model: { providerID: model.providerID, modelID: model.modelID },
                }).catch(() => undefined);
            }
            // Reset prompt on success.
            setInput("");
            setParts([]);
            props.onSubmit?.();
            return true;
        }
        finally {
            submittingRef.current = false;
        }
    }, [input, mode, parts, props, sdk, local]);
    // -- Imperative handle ----------------------------------------------------
    const ref = useMemo(() => ({
        get focused() {
            return focused;
        },
        current: { input, parts },
        set(prompt) {
            setInput(prompt.input);
            setParts(prompt.parts);
            setTimeout(focusInput, 0);
        },
        reset() {
            setInput("");
            setParts([]);
        },
        blur() {
            blurInput();
        },
        focus() {
            focusInput();
        },
        submit() {
            void submit();
        },
    }), [focused, input, parts, submit, focusInput, blurInput]);
    useImperativeHandle(forwardedRef, () => ref, [ref]);
    useEffect(() => {
        props.ref?.(ref);
        return () => props.ref?.(undefined);
    }, [props, ref]);
    // -- Autocomplete wiring --------------------------------------------------
    const handleSubmit = (value) => {
        // If the autocomplete is visible, its onSelect will mutate the input; we
        // bail here so we don't double-handle. Otherwise we submit.
        if (autocompleteRef.current?.visible)
            return;
        void submit().then((handled) => {
            if (handled)
                setPlaceholderIndex(randomIndex(list.length));
        });
        void value;
    };
    const handleInputChange = (value) => {
        setInput(value);
        autocompleteRef.current?.onInput(value);
    };
    const setPrompt = useCallback((updater) => {
        // Apply mutations to our local input/parts. We model "draft" as a plain
        // object so consumers can mutate it like Solid's `produce`.
        // Clone parts to avoid mutating state in-place (React won't re-render if reference is same).
        const draft = { input, parts: [...parts] };
        updater(draft);
        setInput(draft.input);
        setParts(draft.parts);
    }, [input, parts]);
    // Slash-command list from sync + fuzzy filter.
    const commands = useMemo(() => {
        return sync.data.command.filter((c) => c.source !== "skill");
    }, [sync.data.command]);
    const filteredCommands = useMemo(() => {
        if (!input.startsWith("/"))
            return [];
        const query = input.slice(1);
        if (!query || query.includes(" "))
            return [];
        const results = fuzzysort.go(query, commands, { keys: ["name"], limit: 8 });
        return results.map((r) => r.obj);
    }, [input, commands]);
    // -- Render ---------------------------------------------------------------
    const visible = props.visible !== false && !props.disabled;
    return (_jsxs(Box, { flexDirection: "column", children: [props.hint ? _jsx(Box, { children: props.hint }) : null, _jsx(Box, { borderStyle: "round", borderColor: mode === "shell" ? theme.warning : theme.border, paddingLeft: 1, paddingRight: 1, children: _jsxs(Box, { flexDirection: "row", flexGrow: 1, children: [mode === "shell" ? (_jsx(Box, { marginRight: 1, children: _jsx(Text, { color: theme.warning, children: "$" }) })) : null, _jsx(Box, { flexGrow: 1, children: visible ? (_jsx(TextInput, { value: input, onChange: handleInputChange, onSubmit: handleSubmit, placeholder: props.showPlaceholder === false ? "" : placeholder, ref: (r) => {
                                    if (r && r.focus && r.blur) {
                                        inputRef.current = { focus: r.focus, blur: r.blur };
                                    }
                                } })) : (_jsx(Text, { color: theme.textMuted, children: input || placeholder })) }), props.right ? _jsx(Box, { marginLeft: 1, children: props.right }) : null] }) }), filteredCommands.length > 0 ? (_jsx(Box, { flexDirection: "column", marginTop: 1, children: filteredCommands.map((cmd) => (_jsxs(Text, { color: theme.text, children: ["/", cmd.name, cmd.description ? _jsxs(Text, { color: theme.textMuted, children: ["  ", cmd.description] }) : null] }, cmd.name))) })) : null, _jsx(Autocomplete, { ref: (r) => {
                    autocompleteRef.current = r ?? undefined;
                }, value: input, setPrompt: setPrompt, setExtmark: () => {
                    /* extmarks are not modeled in ink; no-op */
                }, anchor: () => ({ x: 0, y: 0, width: 80 }), input: () => ({
                    getTextRange: (start, end) => input.slice(start, end),
                    cursorOffset: input.length,
                    get plainText() {
                        return input;
                    },
                }), fileStyleId: 0, agentStyleId: 0, promptPartTypeId: () => 0 }), status.type !== "idle" ? (_jsx(Box, { marginTop: 1, children: _jsxs(Text, { color: theme.warning, children: ["Session: ", status.type] }) })) : null, _jsx("input", { type: "text", value: input, onChange: (e) => handleInputChange(e.target.value), onKeyDown: (e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        void handleSubmit(input);
                    }
                }, 
                // Hidden mirror so screen readers and tests can poke at the value
                // without depending on ink's stdin/raw-mode lifecycle.
                style: { display: "none" }, "aria-hidden": true, readOnly: true })] }));
});
// suppress unused warning for formatEditorContext (kept for parity)
void formatEditorContext;
