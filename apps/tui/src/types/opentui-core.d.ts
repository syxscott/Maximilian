declare module "@opentui/core" {
  export interface KeyEvent {
    key: string
    ctrl: boolean
    meta: boolean
    shift: boolean
    alt: boolean
    sequence?: string
    [key: string]: unknown
  }
  export interface Renderable {
    [key: string]: unknown
  }
  export interface BaseRenderable {
    [key: string]: unknown
  }
  export interface BoxRenderable extends BaseRenderable {
    width?: number
    height?: number
    [key: string]: unknown
  }
  export class SyntaxStyle {
    static default: SyntaxStyle
    [key: string]: unknown
  }
  export class RGBA {
    constructor(r: number, g: number, b: number, a?: number)
    r: number
    g: number
    b: number
    a: number
    static fromHex(hex: string): RGBA
    static fromInts(r: number, g: number, b: number, a?: number): RGBA
    static fromString(s: string): RGBA
    toHex(): string
    [key: string]: unknown
  }
  export interface TerminalColors {
    background: RGBA
    foreground: RGBA
    [key: string]: unknown
  }
  export interface CliRenderer {
    width: number
    height: number
    [key: string]: unknown
  }
  export interface ScrollAcceleration {
    [key: string]: unknown
  }
  export class MacOSScrollAccel implements ScrollAcceleration {
    [key: string]: unknown
  }
  export function formatSequence(seq: string): string
}
