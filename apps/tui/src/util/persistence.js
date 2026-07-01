// @ts-nocheck
import path from "path";
import { appendFile, mkdir, rename, rm } from "fs/promises";
export function readText(filePath) {
    return Bun.file(filePath).text();
}
export function readJson(filePath) {
    return Bun.file(filePath).json();
}
export async function writeText(filePath, content) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await Bun.write(filePath, content);
}
export async function appendText(filePath, content) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, content);
}
export async function writeJsonAtomic(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await Bun.write(temporary, JSON.stringify(value)).catch(async (error) => {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
    });
    await rename(temporary, filePath).catch(async (error) => {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
    });
}
