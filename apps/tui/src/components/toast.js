import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import { Box, Text, useStdout } from "ink";
const DEFAULT_DURATION = 5000;
const VARIANT_COLOR = {
    info: "blue",
    success: "green",
    warning: "yellow",
    error: "red",
};
const DEFAULT_COLORS = {
    backgroundPanel: "black",
    text: "white",
};
const ToastContext = React.createContext(null);
export function useToast() {
    const value = React.useContext(ToastContext);
    if (!value) {
        throw new Error("useToast must be used within a ToastProvider");
    }
    return value;
}
export function ToastProvider({ children }) {
    const [currentToast, setCurrentToast] = React.useState(null);
    const timeoutRef = React.useRef(null);
    const clearTimer = React.useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    }, []);
    const value = React.useMemo(() => {
        return {
            currentToast,
            show(options) {
                clearTimer();
                const next = {
                    title: options.title,
                    message: options.message,
                    variant: options.variant,
                    duration: options.duration ?? DEFAULT_DURATION,
                };
                setCurrentToast(next);
                timeoutRef.current = setTimeout(() => {
                    setCurrentToast(null);
                    timeoutRef.current = null;
                }, next.duration);
            },
            error(err) {
                if (err instanceof Error) {
                    value.show({ variant: "error", message: err.message });
                    return;
                }
                value.show({ variant: "error", message: "An unknown error has occurred" });
            },
        };
    }, [currentToast, clearTimer]);
    React.useEffect(() => {
        return () => clearTimer();
    }, [clearTimer]);
    return (_jsxs(ToastContext.Provider, { value: value, children: [children, _jsx(Toast, { current: currentToast })] }));
}
function Toast({ current }) {
    const { stdout } = useStdout();
    const width = stdout?.columns ?? 80;
    if (!current)
        return null;
    const maxWidth = Math.min(60, width - 6);
    const variantColor = VARIANT_COLOR[current.variant];
    return (_jsxs(Box, { position: "absolute", alignItems: "flex-start", 
        // Push the toast to the right edge of the terminal. ink doesn't support
        // absolute right positioning, so we offset the left margin instead.
        marginLeft: Math.max(0, width - maxWidth - 2), marginTop: 2, width: maxWidth, flexDirection: "column", paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1, borderStyle: "single", borderColor: variantColor, children: [current.title ? (_jsx(Box, { marginBottom: 1, children: _jsx(Text, { bold: true, color: DEFAULT_COLORS.text, children: current.title }) })) : null, _jsx(Text, { color: DEFAULT_COLORS.text, wrap: "wrap", children: current.message })] }));
}
// `backgroundPanel` was referenced from the OpenCode port; keep the export so
// downstream consumers that pulled it don't break.
export const DEFAULT_TOAST_COLORS = DEFAULT_COLORS;
export default ToastProvider;
