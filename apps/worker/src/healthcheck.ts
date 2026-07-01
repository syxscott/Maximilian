/**
 * Worker healthcheck — verifies the queue heartbeat key is present
 * in Redis. The worker writes a heartbeat with TTL=30s every few
 * seconds while polling the queue (see packages/queue). If this key
 * is missing, either the worker crashed or its polling loop is stuck,
 * and orchestrators (Docker / Kubernetes) should restart it.
 *
 * Exit codes:
 *   0 — heartbeat present (worker is alive and processing)
 *   1 — heartbeat missing or Redis unreachable
 *
 * Usage:
 *   REDIS_URL=redis://redis:6379 node apps/worker/dist/healthcheck.js
 */
import { Redis } from "ioredis";
import { HEARTBEAT_KEY } from "@max/queue";

async function main() {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.error("REDIS_URL not set");
    process.exit(1);
  }
  const redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  try {
    await redis.connect();
    const v = await redis.get(HEARTBEAT_KEY);
    if (!v) {
      console.error("heartbeat key missing");
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    console.error("redis error:", err);
    process.exit(1);
  } finally {
    redis.disconnect();
  }
}

main();