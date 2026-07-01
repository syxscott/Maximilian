export function copy(renderer, toast, clipboard) {
    const selection = renderer.getSelection();
    if (!selection)
        return false;
    const text = selection.getSelectedText();
    if (!text)
        return false;
    const focus = renderer.currentFocusedRenderable;
    const clipboardText = focus?.getClipboardText && selection.selectedRenderables.includes(focus) ? focus.getClipboardText(text) : text;
    clipboard
        ?.write?.(clipboardText)
        .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
        .catch(toast.error);
    renderer.clearSelection();
    return true;
}
export function handleSelectionKey(renderer, toast, event, clipboard) {
    const selection = renderer.getSelection();
    if (!selection)
        return;
    if (event.ctrl && event.name === "c") {
        if (!copy(renderer, toast, clipboard)) {
            renderer.clearSelection();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    if (event.name === "escape") {
        renderer.clearSelection();
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    const focus = renderer.currentFocusedRenderable;
    if (focus?.hasSelection() && selection.selectedRenderables.includes(focus))
        return;
    renderer.clearSelection();
}
export * as Selection from "./selection";
