export function createRuntime(config) { return config; }
export function useRuntime() { return {}; }
export function abbreviateHome(path, home) {
    if (!home || !path.startsWith(home))
        return path;
    // Require a path boundary: next char must be "/" or end-of-string.
    if (path.length !== home.length && path[home.length] !== "/")
        return path;
    return "~" + path.slice(home.length);
}
