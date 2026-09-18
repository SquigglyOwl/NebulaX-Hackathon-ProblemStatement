import { Redis } from "@upstash/redis";

// Serverless functions (Vercel's default for Next.js) share no memory
// between invocations — a different instance can handle the next request,
// so a module-level `let cache = ...` (what the old Express version used)
// silently stops working in production. This is the actual thing that
// needed rebuilding when moving off a long-running Express process, not
// just a framework swap.
//
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (from a free
// upstash.com account) give real cross-invocation persistence in
// production. Without them, this falls back to an in-memory Map so local
// `next dev` still works with zero extra setup — that fallback is NOT
// correct once deployed to multiple serverless instances, only for local,
// single-process development.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const memory = new Map<string, unknown>();

export function usingRedis(): boolean {
  return redis !== null;
}

export async function getJSON<T>(key: string): Promise<T | null> {
  if (redis) {
    const val = await redis.get<T>(key);
    return val ?? null;
  }
  return (memory.has(key) ? (memory.get(key) as T) : null);
}

export async function setJSON<T>(key: string, value: T): Promise<void> {
  if (redis) {
    await redis.set(key, value);
    return;
  }
  memory.set(key, value);
}

export async function deleteKey(key: string): Promise<void> {
  if (redis) {
    await redis.del(key);
    return;
  }
  memory.delete(key);
}

export async function incr(key: string): Promise<number> {
  if (redis) {
    return redis.incr(key);
  }
  const next = ((memory.get(key) as number) ?? 0) + 1;
  memory.set(key, next);
  return next;
}
