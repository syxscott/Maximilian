const previousByParent = new WeakMap();
export function setPreLayoutSiblingMargin(el, margin) {
    // Run before Yoga layout so scroll geometry matches the rendered frame.
    el.onLifecyclePass = () => {
        const parent = el.parent;
        if (!parent)
            return;
        const cached = previousByParent.get(parent);
        const previous = cached?.frameID === el.ctx.frameId ? cached.previous : previousSiblings(parent, el.ctx.frameId);
        const value = margin(previous.get(el));
        if (el.marginTop !== value)
            el.marginTop = value;
    };
}
function previousSiblings(parent, frameID) {
    const previous = new WeakMap();
    parent.getChildren().forEach((child, index, children) => previous.set(child, children[index - 1]));
    previousByParent.set(parent, { frameID, previous });
    return previous;
}
