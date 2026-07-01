// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react"
import { t } from "@max/i18n"
import { Box, Text, useInput } from "ink"
import TextInput from "ink-text-input"
import SelectInput from "ink-select-input"

export type SkillItem = {
  name: string
  description?: string
}

export type DialogSkillProps = {
  skills?: SkillItem[]
  loading?: boolean
  onSelect?: (skill: string) => void
  onLoad?: () => Promise<SkillItem[]> | SkillItem[]
}

export function DialogSkill(props: DialogSkillProps) {
  const [skills, setSkills] = useState<SkillItem[]>(props.skills ?? [])
  const [loading, setLoading] = useState<boolean>(props.loading ?? false)
  const [query, setQuery] = useState("")

  useEffect(() => {
    if (props.skills) setSkills(props.skills)
  }, [props.skills])

  useEffect(() => {
    if (!props.onLoad || (props.skills && props.skills.length > 0)) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const data = await props.onLoad?.()
        if (!cancelled) setSkills(data ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [props.onLoad, props.skills])

  const items = useMemo(() => {
    const maxWidth = Math.max(0, ...skills.map((s) => s.name.length))
    return skills.map((skill) => ({
      label: skill.name.padEnd(maxWidth),
      value: skill.name,
      description: skill.description?.replace(/\s+/g, " ").trim(),
    }))
  }, [skills])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => i.value.toLowerCase().includes(q))
  }, [items, query])

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{t("tui.skills")}</Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginY={1}>
        <Text>Search: </Text>
        <TextInput value={query} onChange={setQuery} placeholder="Search skills..." />
      </Box>
      <Box>
        {loading ? (
          <Text dimColor>Loading skills...</Text>
        ) : (
          <SelectInput
            items={filtered}
            onSelect={(item) => {
              props.onSelect?.(item.value)
            }}
            itemComponent={({ isSelected, label, description }) => (
              <Box flexDirection="row">
                <Text color={isSelected ? "green" : undefined}>{label}</Text>
                {description && (
                  <Text dimColor>  {description}</Text>
                )}
              </Box>
            )}
          />
        )}
      </Box>
    </Box>
  )
}

export default DialogSkill
