// @ts-nocheck
// Paths branch softly through the screen,
// A quiet tree of changed designs;
// Each leaf remembers what has been,
// And waits where careful light aligns.
export function buildFileTree(files) {
    const roots = [];
    const nodes = [];
    const directoryByPath = new Map();
    files.forEach((file, fileIndex) => {
        const segments = file.file.split("/").filter(Boolean);
        if (segments.length === 0)
            return;
        const parent = segments.slice(0, -1).reduce((state, segment) => {
            const directoryPath = state.path ? `${state.path}/${segment}` : segment;
            const existing = directoryByPath.get(directoryPath);
            if (existing !== undefined)
                return { id: existing, path: directoryPath, depth: state.depth + 1 };
            const id = addFileTreeNode(nodes, roots, {
                name: segment,
                parent: state.id,
                depth: state.depth,
                kind: "directory",
            });
            directoryByPath.set(directoryPath, id);
            return { id, path: directoryPath, depth: state.depth + 1 };
        }, { id: undefined, path: "", depth: 0 });
        addFileTreeNode(nodes, roots, {
            name: segments[segments.length - 1],
            parent: parent.id,
            depth: parent.depth,
            kind: "file",
            fileIndex,
        });
    });
    const tree = { roots, nodes };
    tree.roots.sort((left, right) => compareFileTreeNodes(tree, left, right));
    tree.nodes.forEach((node) => node.children.sort((left, right) => compareFileTreeNodes(tree, left, right)));
    return tree;
}
export function flattenFileTree(tree, expanded) {
    const rows = [];
    const visit = (id, depth) => {
        const node = tree.nodes[id];
        if (node.kind === "file") {
            rows.push({
                id: node.id,
                depth,
                kind: node.kind,
                name: node.name,
                fileIndex: node.fileIndex,
            });
            return;
        }
        const chain = collapsedFileTreeDirectoryChain(tree, node.id);
        const last = chain[chain.length - 1];
        rows.push({
            id: node.id,
            depth,
            kind: node.kind,
            name: chain.map((item) => item.name).join("/"),
            fileIndex: node.fileIndex,
        });
        if (!expanded || expanded.has(node.id))
            last.children.forEach((child) => visit(child, depth + 1));
    };
    tree.roots.forEach((root) => visit(root, 0));
    return rows;
}
function collapsedFileTreeDirectoryChain(tree, id) {
    const node = tree.nodes[id];
    const child = node.children.length === 1 ? tree.nodes[node.children[0]] : undefined;
    if (child?.kind !== "directory")
        return [node];
    return [node, ...collapsedFileTreeDirectoryChain(tree, child.id)];
}
export function compareFileTreeNodes(tree, left, right) {
    const leftNode = tree.nodes[left];
    const rightNode = tree.nodes[right];
    if (leftNode.kind !== rightNode.kind)
        return leftNode.kind === "directory" ? -1 : 1;
    if (leftNode.name < rightNode.name)
        return -1;
    if (leftNode.name > rightNode.name)
        return 1;
    return left - right;
}
export function moveFileTreeSelection(rows, selected, offset) {
    if (rows.length === 0)
        return undefined;
    const index = selected === undefined ? -1 : rows.findIndex((row) => row.id === selected);
    if (index === -1)
        return rows[0].id;
    return rows[Math.max(0, Math.min(rows.length - 1, index + offset))].id;
}
export function moveFileTreeSelectionToFirstChild(rows, selected) {
    const index = selected === undefined ? -1 : rows.findIndex((row) => row.id === selected);
    const row = index === -1 ? undefined : rows[index];
    if (row?.kind !== "directory")
        return selected;
    const child = rows[index + 1];
    return child && child.depth > row.depth ? child.id : selected;
}
export function moveFileTreeSelectionToParent(rows, selected) {
    const index = selected === undefined ? -1 : rows.findIndex((row) => row.id === selected);
    const row = index === -1 ? undefined : rows[index];
    if (!row || row.depth === 0)
        return selected;
    return rows.findLast((item, itemIndex) => itemIndex < index && item.depth < row.depth)?.id ?? selected;
}
export function moveFileTreeSelectionToFile(rows, selected, offset) {
    const fileRows = rows.filter((row) => row.fileIndex !== undefined);
    if (fileRows.length === 0)
        return undefined;
    const selectedIndex = selected === undefined ? -1 : rows.findIndex((row) => row.id === selected);
    if (selectedIndex === -1)
        return offset < 0 ? fileRows[fileRows.length - 1].id : fileRows[0].id;
    const next = offset < 0
        ? fileRows.findLast((row) => rows.findIndex((item) => item.id === row.id) < selectedIndex)
        : fileRows.find((row) => rows.findIndex((item) => item.id === row.id) > selectedIndex);
    return next?.id ?? (offset < 0 ? fileRows[0].id : fileRows[fileRows.length - 1].id);
}
export function fileTreeFileSelection(tree, fileIndex) {
    const node = tree.nodes.find((item) => item.kind === "file" && item.fileIndex === fileIndex);
    if (!node)
        return undefined;
    return {
        highlightedNode: node.id,
        expandedNodes: fileTreeParentDirectories(tree, node.id),
    };
}
export function singlePatchFileIndex(selected, active, current, first) {
    return selected ?? active ?? current ?? first;
}
export function orderedPatchFileIndexes(rows) {
    return rows.flatMap((row) => (row.fileIndex === undefined ? [] : [row.fileIndex]));
}
export function showDiffViewerFileTree(showFileTree, fileCount) {
    return showFileTree && fileCount > 0;
}
export function movePatchFileIndex(fileIndexes, current, offset) {
    if (fileIndexes.length === 0)
        return undefined;
    const index = current === undefined ? -1 : fileIndexes.indexOf(current);
    if (index === -1)
        return fileIndexes[0];
    return fileIndexes[Math.max(0, Math.min(fileIndexes.length - 1, index + offset))];
}
export function allExpandedFileTreeDirectories(tree) {
    return new Set(tree.nodes.filter((node) => node.kind === "directory").map((node) => node.id));
}
export function toggleFileTreeDirectory(tree, expanded, selected) {
    if (selected === undefined || tree.nodes[selected]?.kind !== "directory")
        return expanded;
    const next = new Set(expanded);
    if (next.has(selected))
        next.delete(selected);
    else
        next.add(selected);
    return next;
}
export function setFileTreeDirectoryExpanded(tree, expanded, selected, value) {
    if (selected === undefined || tree.nodes[selected]?.kind !== "directory")
        return expanded;
    const next = new Set(expanded);
    if (value)
        next.add(selected);
    else
        next.delete(selected);
    return next;
}
function addFileTreeNode(nodes, roots, input) {
    const id = nodes.length;
    nodes.push({ ...input, id, children: [] });
    if (input.parent === undefined)
        roots.push(id);
    else
        nodes[input.parent].children.push(id);
    return id;
}
function fileTreeParentDirectories(tree, id) {
    const result = new Set();
    for (let parent = tree.nodes[id]?.parent; parent !== undefined; parent = tree.nodes[parent]?.parent) {
        result.add(parent);
    }
    return result;
}
