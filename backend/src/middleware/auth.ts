import { createMiddleware } from "hono/factory";
import type { Env, TokenRecord } from "../types";

/**
 * Token-based auth.
 * Tokens are stored in KV as `token:<hex>` → JSON { userId, createdAt, rateLimit }.
 * Generate tokens via a CLI command or admin endpoint later.
 */
export const auth = createMiddleware<{
  Bindings: Env;
  Variables: { tokenRecord: TokenRecord };
}>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    return c.json({ error: "Missing Authorization header" }, 401);
  }

  const record = await c.env.KV.get<TokenRecord>(`token:${token}`, "json");
  if (!record) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  c.set("tokenRecord", record);
  await next();
});
