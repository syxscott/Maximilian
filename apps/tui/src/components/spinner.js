import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import { Box, Text } from "ink";
// OpenCode uses Braille spinners: ⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏
// ink-spinner defaults to dots; expose a custom frame list.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
// Simple in-house frame spinner driven by an interval, so we don't depend on
// ink-spinner's frame list and can preserve OpenCode's exact glyph sequence.
function useSpinnerFrame(interval) {
    const [frame, setFrame] = React.useState(0);
    React.useEffect(() => {
        const id = setInterval(() => {
            setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
        }, interval);
        return () => clearInterval(id);
    }, [interval]);
    return SPINNER_FRAMES[frame];
}
export function Spinner({ children, color = "gray", interval = 80, fallback }) {
    // animations are always enabled in this port; callers can pass `fallback` to
    // opt into a static indicator instead.
    if (fallback !== undefined) {
        return (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { color: color, children: "\u22EF " }), fallback] }));
    }
    const glyph = useSpinnerFrame(interval);
    return (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { color: color, children: glyph }), children ? _jsx(Text, { color: color, children: children }) : null] }));
}
export default Spinner;
