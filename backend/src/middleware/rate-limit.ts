import { createMiddleware } from "hono/factory";
import type { Env, TokenRecord } from "../types";

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 20;

/**
 * Sliding-window rate limiter backed by KV.
 * Key: `rl:<userId>` → JSON { count, windowStart }.
 * Simple per-minute counter; resets when window expires.
 */
export const rateLimit = createMiddleware<{
  Bindings: Env;
  Variables: { tokenRecord: TokenRecord };
}>(async (c, next) => {
  const record = c.get("tokenRecord");
  const userId = record.userId;
  const limit = record.rateLimit || DEFAULT_LIMIT;
  const key = `rl:${userId}`;
  const now = Date.now();

  const existing = await c.env.KV.get<{ count: number; windowStart: number }>(key, "json");

  let count: number;
  let windowStart: number;

  if (!existing || now - existing.windowStart > WINDOW_MS) {
    count = 1;
    windowStart = now;
  } else {
    count = existing.count + 1;
    windowStart = existing.windowStart;
  }

  if (count > limit) {
    const retryAfter = Math.ceil((windowStart + WINDOW_MS - now) / 1000);
    c.header("Retry-After", String(retryAfter));
    return c.json({ error: `Rate limit exceeded. Try again in ${retryAfter}s.` }, 429);
  }

  const ttl = Math.ceil(WINDOW_MS / 1000) + 5;
  await c.env.KV.put(key, JSON.stringify({ count, windowStart }), { expirationTtl: ttl });

  c.header("X-RateLimit-Limit", String(limit));
  c.header("X-RateLimit-Remaining", String(Math.max(0, limit - count)));

  await next();
});
