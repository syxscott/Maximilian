import React, { createContext, useContext } from "react"
import { Box, Text } from "ink"
import { useTheme } from "../../context/theme"

export type Axis = "x" | "y"
export type SeparatorEdge = "edge" | "edge-in" | "edge-out"
export type PanelBorder = "start" | "end" | "both" | "none"

const PanelGroupContext = createContext<{ axis: Axis } | undefined>(undefined)

function crossAxis(axis: Axis) {
  return axis === "x" ? "y" : "x"
}

function usePanelGroup() {
  return useContext(PanelGroupContext)
}

export function PanelGroup(props: { axis: Axis; children: React.ReactNode; [key: string]: unknown }) {
  const { axis, children, ...boxProps } = props
  return (
    <PanelGroupContext.Provider value={{ axis }}>
      <Box minWidth={0} minHeight={0} padding={0} flexDirection={axis === "x" ? "row" : "column"} {...(boxProps as any)}>
        {children}
      </Box>
    </PanelGroupContext.Provider>
  )
}

export function Panel(props: { border?: PanelBorder; children?: React.ReactNode; [key: string]: unknown }) {
  const group = usePanelGroup()
  const { theme } = useTheme()
  const { border: borderProp, children, ...boxProps } = props
  const border = borderProp ?? "start"
  const borderStyle =
    border === "none"
      ? {}
      : {
          borderStyle: panelBorderSides(group?.axis ?? "y", border),
          borderColor: theme.border,
        }

  return (
    <Box
      minWidth={0}
      minHeight={0}
      flexDirection={crossAxis(group?.axis ?? "y") === "x" ? "row" : "column"}
      {...borderStyle}
      {...(boxProps as any)}
    >
      {children}
    </Box>
  )
}

function panelBorderSides(axis: Axis, border: Exclude<PanelBorder, "none">) {
  if (axis === "x") return border === "both" ? ["top", "bottom"] : [border === "start" ? "top" : "bottom"]
  return border === "both" ? ["left", "right"] : [border === "start" ? "left" : "right"]
}

export function Separator(props: { axis?: Axis; color?: string; start?: SeparatorEdge; end?: SeparatorEdge }) {
  const group = usePanelGroup()
  const { theme } = useTheme()
  const color = props.color ?? theme.border
  const axis = props.axis ?? crossAxis(group?.axis ?? "y")
  if (axis === "y") {
    if (props.start || props.end) {
      return (
        <Box width={1} flexShrink={0} flexDirection="column">
          {props.start && <Text color={color}>{verticalEdge(props.start, "start")}</Text>}
          <Box flexGrow={1} borderLeft borderColor={color} />
          {props.end && <Text color={color}>{verticalEdge(props.end, "end")}</Text>}
        </Box>
      )
    }
    return <Box width={1} flexShrink={0} borderLeft borderColor={color} />
  }
  if (props.start || props.end) {
    return (
      <Box height={1} flexShrink={0} flexDirection="row">
        {props.start && <Text color={color}>{horizontalEdge(props.start, "start")}</Text>}
        <Box flexGrow={1} borderTop borderColor={color} />
        {props.end && <Text color={color}>{horizontalEdge(props.end, "end")}</Text>}
      </Box>
    )
  }
  return <Box height={1} flexShrink={0} borderTop borderColor={color} />
}

function horizontalEdge(edge: SeparatorEdge, side: "start" | "end") {
  if (edge === "edge") return side === "start" ? "├" : "┤"
  if (edge === "edge-in") return "┴"
  return "┬"
}

function verticalEdge(edge: SeparatorEdge, side: "start" | "end") {
  if (edge === "edge") return side === "start" ? "┬" : "┴"
  if (edge === "edge-in") return "┤"
  return "├"
}
