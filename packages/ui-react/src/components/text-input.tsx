import React from "react"
export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {}
export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>((props, ref) => (
  <input ref={ref} {...props} />
))
TextInput.displayName = "TextInput"
export default TextInput
