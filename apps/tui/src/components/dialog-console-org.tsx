// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react"
import { Box, Text } from "ink"
import { DialogSelect } from "../ui/dialog-select"
import { useSDK } from "../context/sdk"
import { useDialog } from "./dialog"
import { useToast } from "./toast"
import { useTheme } from "../context/theme"
import { errorMessage } from "../util/error"

// The Maximilian SDK client is intentionally minimal at this stage; the
// org-switching endpoints come from OpenCode's typed SDK. Cast through
// `any` so callers can wire the dialog into a real client later.
type ConsoleSdk = {
  client: any
}

type OrgOption = {
  active?: boolean
  accountEmail: string
  accountUrl: string
  accountID: string
  orgID: string
  orgName: string
}

function accountHost(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function accountLabel(item: Pick<OrgOption, "accountEmail" | "accountUrl">) {
  return `${item.accountEmail}  ${accountHost(item.accountUrl)}`
}

type Option = {
  title: string
  value: string | OrgOption
  category?: string
  onSelect: () => void | Promise<void>
}

export function DialogConsoleOrg() {
  const sdk = useSDK() as ConsoleSdk
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()

  const [orgs, setOrgs] = useState<OrgOption[] | undefined>(undefined)
  const [loadError, setLoadError] = useState<unknown>(undefined)

  useEffect(() => {
    let cancelled = false
    setLoadError(undefined)
    void sdk.client.experimental.console
      .listOrgs({}, { throwOnError: true })
      .then((result: any) => {
        if (cancelled) return
        setOrgs(result.data?.orgs ?? [])
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(error)
        setOrgs(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [sdk])

  const showError = Boolean(loadError)

  const current = useMemo(
    () => orgs?.find((item) => item.active),
    [orgs],
  )

  const options: Option[] = useMemo(() => {
    if (showError) return []
    if (orgs === undefined) {
      return [
        {
          title: "Loading orgs...",
          value: "loading",
          onSelect: () => {},
        },
      ]
    }
    if (orgs.length === 0) {
      return [
        {
          title: "No orgs found",
          value: "empty",
          onSelect: () => {},
        },
      ]
    }
    return [...orgs]
      .sort((a, b) => {
        const activeAccountA = a.active ? 0 : 1
        const activeAccountB = b.active ? 0 : 1
        if (activeAccountA !== activeAccountB) return activeAccountA - activeAccountB
        const accountCompare = accountLabel(a).localeCompare(accountLabel(b))
        if (accountCompare !== 0) return accountCompare
        return a.orgName.localeCompare(b.orgName)
      })
      .map((item) => ({
        title: item.orgName,
        value: item,
        category: accountLabel(item),
        onSelect: async () => {
          if (item.active) {
            dialog.clear()
            return
          }
          await sdk.client.experimental.console.switchOrg(
            { accountID: item.accountID, orgID: item.orgID },
            { throwOnError: true },
          )
          await sdk.client.instance.dispose()
          toast.show({ message: `Switched to ${item.orgName}`, variant: "info" })
          dialog.clear()
        },
      }))
  }, [orgs, showError, sdk, dialog, toast])

  return (
    <Box flexDirection="column">
      {showError ? (
        <Box flexDirection="column" paddingLeft={4} paddingRight={4}>
          <Text bold color={theme.error}>
            Could not load orgs
          </Text>
          <Text color={theme.textMuted}>{errorMessage(loadError)}</Text>
        </Box>
      ) : (
        <DialogSelect
          title="Switch org"
          options={options as any}
          current={current}
          renderFilter={!showError}
          locked={showError}
        />
      )}
    </Box>
  )
}
