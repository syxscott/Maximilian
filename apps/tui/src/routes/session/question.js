import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
/**
 * QuestionPrompt: multi-tab question UI with single/multi-select answers.
 *
 * Ported from OpenCode's SolidJS `question.tsx`. The original used
 * `createStore`, `createMemo`, `createSignal`, `For`, `Show`, `<scrollbox>`,
 * `<textarea>`, `useRenderer`, `useBindings`, `useOpencodeModeStack`, and
 * `tint`/`selectedForeground` from theme.
 *
 * We port to React `useState`, `useMemo`, conditional JSX, and `.map()`.
 * OpenTUI-specific primitives are simplified:
 *   - textarea: replaced by a basic text input via useInput.
 *   - useRenderer.getSelection(): removed (ink has no native selection).
 *   - useBindings: replaced by useInput.
 *   - useOpencodeModeStack: removed (not available in Maximilian).
 *   - tint(): inlined as a simple color approximation.
 */
import { useCallback, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../../context/theme";
import { useSDK } from "../../context/sdk";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Approximation of OpenCode's `tint` (blend two hex colors). */
function tint(base, accent, _ratio) {
    // For ink, we just return the accent color as a simple approximation.
    void base;
    return accent;
}
// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function QuestionPrompt(props) {
    const sdk = useSDK();
    const { theme } = useTheme();
    const questions = useMemo(() => props.request.questions, [props.request.questions]);
    const single = useMemo(() => questions.length === 1 && questions[0]?.multiple !== true, [questions]);
    const tabs = useMemo(() => (single ? 1 : questions.length + 1), [single, questions]);
    const [tab, setTab] = useState(0);
    const [answers, setAnswers] = useState([]);
    const [customInputs, setCustomInputs] = useState([]);
    const [selected, setSelected] = useState(0);
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState("");
    const question = useMemo(() => questions[tab], [questions, tab]);
    const isConfirm = useMemo(() => !single && tab === questions.length, [single, tab, questions.length]);
    const options = useMemo(() => question?.options ?? [], [question]);
    const allowCustom = useMemo(() => question?.custom !== false, [question]);
    const isOther = useMemo(() => allowCustom && selected === options.length, [allowCustom, selected, options.length]);
    const customValue = useMemo(() => customInputs[tab] ?? "", [customInputs, tab]);
    const multi = useMemo(() => question?.multiple === true, [question]);
    const customPicked = useMemo(() => {
        const value = customValue;
        if (!value)
            return false;
        return answers[tab]?.includes(value) ?? false;
    }, [customValue, answers, tab]);
    const submit = useCallback(() => {
        const allAnswers = questions.map((_, i) => answers[i] ?? []);
        void sdk.client.question?.reply?.({
            requestID: props.request.id,
            directory: props.directory,
            answers: allAnswers,
        });
    }, [questions, answers, sdk, props]);
    const reject = useCallback(() => {
        void sdk.client.question?.reject?.({
            requestID: props.request.id,
            directory: props.directory,
        });
    }, [sdk, props]);
    const pick = useCallback((answer, isCustom = false) => {
        const nextAnswers = [...answers];
        nextAnswers[tab] = [answer];
        setAnswers(nextAnswers);
        if (isCustom) {
            const nextCustom = [...customInputs];
            nextCustom[tab] = answer;
            setCustomInputs(nextCustom);
        }
        if (single) {
            void sdk.client.question?.reply?.({
                requestID: props.request.id,
                directory: props.directory,
                answers: [[answer]],
            });
            return;
        }
        setTab(tab + 1);
        setSelected(0);
    }, [answers, customInputs, tab, single, sdk, props]);
    const toggle = useCallback((answer) => {
        const existing = answers[tab] ?? [];
        const next = [...existing];
        const index = next.indexOf(answer);
        if (index === -1)
            next.push(answer);
        else
            next.splice(index, 1);
        const nextAnswers = [...answers];
        nextAnswers[tab] = next;
        setAnswers(nextAnswers);
    }, [answers, tab]);
    const selectOption = useCallback(() => {
        if (isOther) {
            if (!multi) {
                setEditing(true);
                setEditValue(customValue);
                return;
            }
            if (customValue && customPicked) {
                toggle(customValue);
                return;
            }
            setEditing(true);
            setEditValue(customValue);
            return;
        }
        const opt = options[selected];
        if (!opt)
            return;
        if (multi) {
            toggle(opt.label);
            return;
        }
        pick(opt.label);
    }, [isOther, multi, customValue, customPicked, options, selected, pick, toggle]);
    const moveTo = useCallback((index) => {
        setSelected(index);
    }, []);
    const selectTab = useCallback((index) => {
        setTab(index);
        setSelected(0);
    }, []);
    // Handle editing mode input
    useInput((input, key) => {
        if (!editing)
            return;
        if (key.escape) {
            setEditing(false);
            return;
        }
        if (key.backspace || key.delete) {
            setEditValue((prev) => prev.slice(0, -1));
            return;
        }
        if (key.return) {
            const text = editValue.trim();
            const prev = customInputs[tab];
            if (!text) {
                if (prev) {
                    const nextCustom = [...customInputs];
                    nextCustom[tab] = "";
                    setCustomInputs(nextCustom);
                    const nextAnswers = [...answers];
                    nextAnswers[tab] = (nextAnswers[tab] ?? []).filter((x) => x !== prev);
                    setAnswers(nextAnswers);
                }
                setEditing(false);
                return;
            }
            if (multi) {
                const nextCustom = [...customInputs];
                nextCustom[tab] = text;
                setCustomInputs(nextCustom);
                const existing = answers[tab] ?? [];
                const next = [...existing];
                if (prev) {
                    const index = next.indexOf(prev);
                    if (index !== -1)
                        next.splice(index, 1);
                }
                if (!next.includes(text))
                    next.push(text);
                const nextAnswers = [...answers];
                nextAnswers[tab] = next;
                setAnswers(nextAnswers);
                setEditing(false);
                return;
            }
            pick(text, true);
            setEditing(false);
            return;
        }
        if (input && !key.ctrl && !key.meta) {
            setEditValue((prev) => prev + input);
        }
    }, { isActive: editing && !isConfirm });
    // Handle navigation mode input
    const totalOptions = options.length + (allowCustom ? 1 : 0);
    const maxKey = Math.min(totalOptions, 9);
    useInput((input, key) => {
        if (editing)
            return;
        if (isConfirm) {
            if (key.return) {
                submit();
                return;
            }
            if (key.escape) {
                reject();
                return;
            }
            return;
        }
        // Tab navigation
        if (key.tab) {
            // shift detection not available in ink; always move forward
            selectTab((tab + 1) % tabs);
            return;
        }
        // Number keys for quick select
        const num = parseInt(input, 10);
        if (num >= 1 && num <= maxKey) {
            moveTo(num - 1);
            // auto-select after moving
            setTimeout(() => {
                const idx = num - 1;
                if (idx === options.length && allowCustom) {
                    if (!multi) {
                        setEditing(true);
                        setEditValue(customValue);
                    }
                }
                else {
                    const opt = options[idx];
                    if (opt) {
                        if (multi)
                            toggle(opt.label);
                        else
                            pick(opt.label);
                    }
                }
            }, 0);
            return;
        }
        if (key.up || input === "k") {
            moveTo((selected - 1 + totalOptions) % totalOptions);
            return;
        }
        if (key.down || input === "j") {
            moveTo((selected + 1) % totalOptions);
            return;
        }
        if (key.left || input === "h") {
            selectTab((tab - 1 + tabs) % tabs);
            return;
        }
        if (key.right || input === "l") {
            selectTab((tab + 1) % tabs);
            return;
        }
        if (key.return) {
            selectOption();
            return;
        }
        if (key.escape) {
            reject();
        }
    }, { isActive: !editing });
    return (_jsxs(Box, { flexDirection: "column", paddingLeft: 1, paddingRight: 3, paddingTop: 1, paddingBottom: 1, borderStyle: "single", borderColor: theme.accent, children: [!single ? (_jsxs(Box, { flexDirection: "row", gap: 1, paddingLeft: 1, children: [questions.map((q, index) => {
                        const isActive = index === tab;
                        const isAnswered = (answers[index]?.length ?? 0) > 0;
                        return (_jsx(Box, { paddingLeft: 1, paddingRight: 1, children: _jsx(Text, { color: isActive ? selectedForeground(theme, theme.accent) : isAnswered ? theme.text : undefined, dimColor: !isActive && !isAnswered, children: q.header }) }, index));
                    }), _jsx(Box, { paddingLeft: 1, paddingRight: 1, children: _jsx(Text, { color: isConfirm ? selectedForeground(theme, theme.accent) : undefined, dimColor: !isConfirm, children: "Confirm" }) })] })) : null, !isConfirm ? (_jsxs(Box, { paddingLeft: 1, gap: 1, flexDirection: "column", children: [_jsx(Box, { children: _jsxs(Text, { color: theme.text, children: [question?.question, multi ? " (select all that apply)" : ""] }) }), _jsxs(Box, { flexDirection: "column", children: [options.map((opt, i) => {
                                const active = i === selected;
                                const picked = answers[tab]?.includes(opt.label) ?? false;
                                return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { flexDirection: "row", children: [_jsx(Box, { paddingRight: 1, children: _jsx(Text, { color: active ? tint(theme.textMuted, theme.secondary, 0.6) : undefined, dimColor: !active, children: `${i + 1}.` }) }), _jsx(Box, { children: _jsx(Text, { color: active ? theme.secondary : picked ? theme.success : theme.text, children: multi ? `[${picked ? "x" : " "}] ${opt.label}` : opt.label }) }), !multi ? (_jsx(Text, { color: theme.success, children: picked ? " v" : "" })) : null] }), opt.description ? (_jsx(Box, { paddingLeft: 3, children: _jsx(Text, { dimColor: true, children: opt.description }) })) : null] }, i));
                            }), allowCustom ? (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { flexDirection: "row", children: [_jsx(Box, { paddingRight: 1, children: _jsx(Text, { color: isOther ? tint(theme.textMuted, theme.secondary, 0.6) : undefined, dimColor: !isOther, children: `${options.length + 1}.` }) }), _jsx(Box, { children: _jsx(Text, { color: isOther ? theme.secondary : customPicked ? theme.success : theme.text, children: multi ? `[${customPicked ? "x" : " "}] Type your own answer` : "Type your own answer" }) }), !multi ? (_jsx(Text, { color: theme.success, children: customPicked ? " v" : "" })) : null] }), editing ? (_jsx(Box, { paddingLeft: 3, children: _jsxs(Text, { color: theme.text, children: [editValue, _jsx(Text, { color: theme.primary, children: "_" })] }) })) : null, !editing && customValue ? (_jsx(Box, { paddingLeft: 3, children: _jsx(Text, { dimColor: true, children: customValue }) })) : null] })) : null] })] })) : null, isConfirm && !single ? (_jsxs(Box, { paddingLeft: 1, flexDirection: "column", children: [_jsx(Text, { color: theme.text, children: "Review" }), questions.map((q, index) => {
                        const value = answers[index]?.join(", ") ?? "";
                        const answered = Boolean(value);
                        return (_jsx(Box, { paddingLeft: 1, children: _jsxs(Text, { children: [_jsxs(Text, { dimColor: true, children: [q.header, ": "] }), _jsx(Text, { color: answered ? theme.text : theme.error, children: answered ? value : "(not answered)" })] }) }, index));
                    })] })) : null, _jsxs(Box, { flexDirection: "row", gap: 2, paddingTop: 1, paddingLeft: 2, children: [!single ? (_jsx(Text, { children: _jsx(Text, { dimColor: true, children: "tab" }) })) : null, !isConfirm ? (_jsx(Text, { children: _jsx(Text, { dimColor: true, children: "up/down select" }) })) : null, _jsxs(Text, { children: ["enter", " ", _jsx(Text, { dimColor: true, children: isConfirm ? "submit" : multi ? "toggle" : single ? "submit" : "confirm" })] }), _jsxs(Text, { children: ["esc ", _jsx(Text, { dimColor: true, children: "dismiss" })] })] })] }));
}
