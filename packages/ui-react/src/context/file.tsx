import * as React from "react"
import { createSimpleContext } from "./helper.js"

export type FileComponent = React.ComponentType<any>

export interface FileComponentProviderProps {
  component: FileComponent
  children?: React.ReactNode
}

const ctx = createSimpleContext<FileComponent, { component: FileComponent }>({
  name: "FileComponent",
  init: (props) => props.component,
})

export function FileComponentProvider(props: FileComponentProviderProps) {
  return ctx.provider({ component: props.component, children: props.children })
}

export function useFileComponent(): FileComponent {
  return ctx.use()
}