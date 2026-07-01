declare module "diff" {
  export function diffLines(oldStr: string, newStr: string): unknown[]
  export function diffWords(oldStr: string, newStr: string): unknown[]
  export function createPatch(filename: string, oldStr: string, newStr: string): string
}
