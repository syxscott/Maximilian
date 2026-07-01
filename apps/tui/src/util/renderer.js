export function destroyRenderer(renderer) {
    renderer.setTerminalTitle("");
    if (renderer.isDestroyed)
        return;
    renderer.destroy();
}
