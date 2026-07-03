import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Redis } from "ioredis";
import type { ResourceBudget } from "./index.js";

const execFileAsync = promisify(execFile);
const GPU_LOCK_KEY = "maximilian:resource:gpu:exclusive";
const DEFAULT_WAIT_MS = 300_000;
const DEFAULT_POLL_MS = 2_000;
const DEFAULT_LEASE_MS = 900_000;

export interface ResourceLease {
  release(): Promise<void>;
}

export interface AcquireResourceOptions {
  waitMs?: number;
  pollMs?: number;
  leaseMs?: number;
}

export async function acquireResourceLease(
  redisUrl: string,
  budget: ResourceBudget | undefined,
  options: AcquireResourceOptions = {},
): Promise<ResourceLease> {
  if (!budget?.vramMb && !budget?.exclusive) return noopLease();

  const conn = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const deadline = Date.now() + waitMs;

  try {
    let gpuProbe: { available: boolean } | undefined;
    while (Date.now() <= deadline) {
      if (budget.vramMb) {
        // Probe nvidia-smi once per loop; if the binary is missing or
        // errors out, fail fast instead of busy-waiting until the
        // deadline — the operator asked for VRAM but the box has no GPU.
        if (!gpuProbe) {
          gpuProbe = await probeGpu();
          if (!gpuProbe.available) {
            conn.disconnect();
            throw new Error(
              `resource budget requires ${budget.vramMb}MB of VRAM but nvidia-smi is unavailable on this host`,
            );
          }
        }
        const enoughVram = (await freeVramMb()) >= budget.vramMb;
        if (enoughVram) {
          const acquired = await conn.set(GPU_LOCK_KEY, token, "PX", leaseMs, "NX");
          if (acquired === "OK") {
            return {
              release: async () => {
                try {
                  const current = await conn.get(GPU_LOCK_KEY);
                  if (current === token) await conn.del(GPU_LOCK_KEY);
                } finally {
                  conn.disconnect();
                }
              },
            };
          }
        }
      } else if (budget.exclusive) {
        const acquired = await conn.set(GPU_LOCK_KEY, token, "PX", leaseMs, "NX");
        if (acquired === "OK") {
          return {
            release: async () => {
              try {
                const current = await conn.get(GPU_LOCK_KEY);
                if (current === token) await conn.del(GPU_LOCK_KEY);
              } finally {
                conn.disconnect();
              }
            },
          };
        }
      }
      await delay(pollMs);
    }
  } catch (err) {
    conn.disconnect();
    throw err;
  }

  conn.disconnect();
  throw new Error(`resource budget unavailable: vramMb=${budget.vramMb ?? 0}, exclusive=${budget.exclusive === true}`);
}

async function freeVramMb(): Promise<number> {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", [
      "--query-gpu=memory.free",
      "--format=csv,noheader,nounits",
    ]);
    const values = stdout
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((n) => Number.isFinite(n));
    return values.length > 0 ? Math.max(...values) : 0;
  } catch {
    return 0;
  }
}

async function probeGpu(): Promise<{ available: boolean }> {
  try {
    await execFileAsync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"]);
    return { available: true };
  } catch {
    return { available: false };
  }
}

function noopLease(): ResourceLease {
  return { release: async () => {} };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
