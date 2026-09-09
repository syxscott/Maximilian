import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { Box } from "ink";
import TextInput from "ink-text-input";
import { DialogSelect } from "../ui/dialog-select";
import { useDialog } from "./dialog";
import { useProject } from "../context/project";
import { useSDK } from "../context/sdk";
export function DialogTag(props) {
    const sdk = useSDK();
    const dialog = useDialog();
    const project = useProject();
    const [filter, setFilter] = useState("");
    const [files, setFiles] = useState([]);
    const [loaded, setLoaded] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setLoaded(false);
        void sdk.client.find
            ?.files?.({ query: filter, workspace: project.workspace.current() ?? undefined })
            .then((result) => {
            if (cancelled)
                return;
            if (result.error) {
                setFiles([]);
            }
            else {
                const list = (result.data ?? []).slice(0, 5);
                setFiles(list);
            }
            setLoaded(true);
        })
            .catch(() => {
            if (cancelled)
                return;
            setFiles([]);
            setLoaded(true);
        });
        return () => {
            cancelled = true;
        };
    }, [filter, project]);
    const options = useMemo(() => files.map((file) => ({ value: file, title: file })), [files]);
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Box, { paddingLeft: 1, paddingRight: 1, children: _jsx(TextInput, { value: filter, onChange: setFilter }) }), loaded && (_jsx(DialogSelect, { title: "Autocomplete", options: options, onSelect: (option) => {
                    props.onSelect?.(option.value);
                    dialog.clear();
                } }))] }));
}
