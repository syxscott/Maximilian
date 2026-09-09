import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Redis } from "ioredis";
import type { ResourceBudget } from "./index.js";

const execFileAsync = promisify(execFile);

// Timeout for nvidia-smi probes in milliseconds.
const NVIDIA_SMI_TIMEOUT_MS = 10_000;
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
    let lastGpuProbeTime = 0;
    const GPU_PROBE_INTERVAL_MS = 5000; // Re-probe GPU every 5 seconds
    while (Date.now() <= deadline) {
      if (budget.vramMb) {
        // Probe nvidia-smi periodically or if freeVramMb returned 0 (GPU state may have changed).
        // If the binary is missing or errors out, fail fast instead of busy-waiting until the
        // deadline — the operator asked for VRAM but the box has no GPU.
        const now = Date.now();
        if (!gpuProbe || !gpuProbe.available || (now - lastGpuProbeTime) > GPU_PROBE_INTERVAL_MS) {
          gpuProbe = await probeGpu();
          lastGpuProbeTime = now;
          if (!gpuProbe.available) {
            conn.disconnect();
            throw new Error(
              `resource budget requires ${budget.vramMb}MB of VRAM but nvidia-smi is unavailable on this host`,
            );
          }
        }
        const freeVram = await freeVramMb();
        // If free VRAM is 0, GPU state may have changed — re-probe on next iteration
        const enoughVram = freeVram >= budget.vramMb;
        if (enoughVram) {
          const acquired = await conn.set(GPU_LOCK_KEY, token, "PX", leaseMs, "NX");
          if (acquired === "OK") {
            // Lua script atomically checks token and deletes — prevents TOCTOU race
            // where another process acquires the lock between GET and DEL.
            const releaseScript = `
              if redis.call("GET", KEYS[1]) == ARGV[1] then
                return redis.call("DEL", KEYS[1])
              else
                return 0
              end
            `;
            return {
              release: async () => {
                try {
                  await conn.eval(releaseScript, 1, GPU_LOCK_KEY, token);
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
          // Lua script atomically checks token and deletes — prevents TOCTOU race
          // where another process acquires the lock between GET and DEL.
          const releaseScript = `
            if redis.call("GET", KEYS[1]) == ARGV[1] then
              return redis.call("DEL", KEYS[1])
            else
              return 0
            end
          `;
          return {
            release: async () => {
              try {
                await conn.eval(releaseScript, 1, GPU_LOCK_KEY, token);
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
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      ["--query-gpu=memory.free", "--format=csv,noheader,nounits"],
      { timeout: NVIDIA_SMI_TIMEOUT_MS },
    );
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
    await execFileAsync(
      "nvidia-smi",
      ["--query-gpu=name", "--format=csv,noheader"],
      { timeout: NVIDIA_SMI_TIMEOUT_MS },
    );
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
