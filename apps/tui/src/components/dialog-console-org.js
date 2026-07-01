import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { DialogSelect } from "../ui/dialog-select";
import { useSDK } from "../context/sdk";
import { useDialog } from "./dialog";
import { useToast } from "./toast";
import { useTheme } from "../context/theme";
import { errorMessage } from "../util/error";
function accountHost(url) {
    try {
        return new URL(url).host;
    }
    catch {
        return url;
    }
}
function accountLabel(item) {
    return `${item.accountEmail}  ${accountHost(item.accountUrl)}`;
}
export function DialogConsoleOrg() {
    const sdk = useSDK();
    const dialog = useDialog();
    const toast = useToast();
    const { theme } = useTheme();
    const [orgs, setOrgs] = useState(undefined);
    const [loadError, setLoadError] = useState(undefined);
    useEffect(() => {
        let cancelled = false;
        setLoadError(undefined);
        void sdk.client.experimental.console
            .listOrgs({}, { throwOnError: true })
            .then((result) => {
            if (cancelled)
                return;
            setOrgs(result.data?.orgs ?? []);
        })
            .catch((error) => {
            if (cancelled)
                return;
            setLoadError(error);
            setOrgs(undefined);
        });
        return () => {
            cancelled = true;
        };
    }, [sdk]);
    const showError = Boolean(loadError);
    const current = useMemo(() => orgs?.find((item) => item.active), [orgs]);
    const options = useMemo(() => {
        if (showError)
            return [];
        if (orgs === undefined) {
            return [
                {
                    title: "Loading orgs...",
                    value: "loading",
                    onSelect: () => { },
                },
            ];
        }
        if (orgs.length === 0) {
            return [
                {
                    title: "No orgs found",
                    value: "empty",
                    onSelect: () => { },
                },
            ];
        }
        return [...orgs]
            .sort((a, b) => {
            const activeAccountA = a.active ? 0 : 1;
            const activeAccountB = b.active ? 0 : 1;
            if (activeAccountA !== activeAccountB)
                return activeAccountA - activeAccountB;
            const accountCompare = accountLabel(a).localeCompare(accountLabel(b));
            if (accountCompare !== 0)
                return accountCompare;
            return a.orgName.localeCompare(b.orgName);
        })
            .map((item) => ({
            title: item.orgName,
            value: item,
            category: accountLabel(item),
            onSelect: async () => {
                if (item.active) {
                    dialog.clear();
                    return;
                }
                await sdk.client.experimental.console.switchOrg({ accountID: item.accountID, orgID: item.orgID }, { throwOnError: true });
                await sdk.client.instance.dispose();
                toast.show({ message: `Switched to ${item.orgName}`, variant: "info" });
                dialog.clear();
            },
        }));
    }, [orgs, showError, sdk, dialog, toast]);
    return (_jsx(Box, { flexDirection: "column", children: showError ? (_jsxs(Box, { flexDirection: "column", paddingLeft: 4, paddingRight: 4, children: [_jsx(Text, { bold: true, color: theme.error, children: "Could not load orgs" }), _jsx(Text, { color: theme.textMuted, children: errorMessage(loadError) })] })) : (_jsx(DialogSelect, { title: "Switch org", options: options, current: current, renderFilter: !showError, locked: showError })) }));
}
