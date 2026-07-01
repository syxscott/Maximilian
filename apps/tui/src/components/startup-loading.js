import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import { Box } from "ink";
import { Spinner } from "./spinner";
import { useLocale, t } from "@max/i18n";
// OpenCode's <StartupLoading> shows a bottom-of-screen spinner after a 500ms
// debounce, then holds it for at least 3 seconds before fading out so a fast
// boot doesn't produce a flicker. We preserve both behaviours.
const DEFAULT_COLORS = {
    backgroundPanel: "black",
    textMuted: "gray",
};
export function StartupLoading({ ready }) {
    useLocale();
    const [show, setShow] = React.useState(false);
    const stampRef = React.useRef(0);
    const waitRef = React.useRef(null);
    const holdRef = React.useRef(null);
    const clearTimers = React.useCallback(() => {
        if (waitRef.current) {
            clearTimeout(waitRef.current);
            waitRef.current = null;
        }
        if (holdRef.current) {
            clearTimeout(holdRef.current);
            holdRef.current = null;
        }
    }, []);
    React.useEffect(() => {
        if (ready) {
            if (!show)
                return;
            const left = 3000 - (Date.now() - stampRef.current);
            if (left <= 0) {
                setShow(false);
                return;
            }
            holdRef.current = setTimeout(() => {
                holdRef.current = null;
                setShow(false);
            }, left);
            return;
        }
        // not ready
        if (show)
            return;
        waitRef.current = setTimeout(() => {
            waitRef.current = null;
            stampRef.current = Date.now();
            setShow(true);
        }, 500);
        return clearTimers;
    }, [ready, show, clearTimers]);
    React.useEffect(() => {
        return () => clearTimers();
    }, [clearTimers]);
    if (!show)
        return null;
    const label = ready ? t("tui.finishingStartup") : t("tui.loadingPlugins");
    return (_jsx(Box, { alignItems: "center", justifyContent: "center", marginBottom: 1, flexDirection: "column", children: _jsx(Box, { borderStyle: "single", borderColor: DEFAULT_COLORS.textMuted, paddingLeft: 1, paddingRight: 1, children: _jsx(Spinner, { color: DEFAULT_COLORS.textMuted, children: label }) }) }));
}
export default StartupLoading;
