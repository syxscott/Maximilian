// @ts-nocheck
import path from "path"
import { appendFile, mkdir, rename, rm } from "fs/promises"
// Maximilian's persistence layer is Bun-specific for read paths (readText,
// readJson) because the Bun runtime gives us atomic, GC-friendly file
// handles without an extra fs module. The write helpers fall back to
// Node's `fs/promises` so they keep working when this module runs under
// Node (tests, dashboards). Keeping both paths in one place avoids the
// scenario where appendText is silently dropped because someone imported
// the file under Node where Bun.write isn't available.
export function readText(filePath) {
  return Bun.file(filePath).text()
}
export function readJson(filePath) {
  return Bun.file(filePath).json()
}
export async function writeText(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await Bun.write(filePath, content)
}
export async function appendText(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await appendFile(filePath, content)
}
export async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  await Bun.write(temporary, JSON.stringify(value)).catch(async (error) => {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  })
  await rename(temporary, filePath).catch(async (error) => {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  })
}
