import { Hono } from "hono";
import type { Env, TokenRecord } from "../types";

const app = new Hono<{ Bindings: Env }>();

/**
 * POST /api/token/create
 * Creates a new auth token. Protected by a simple admin secret for now.
 * Body: { adminSecret: string, userId: string, rateLimit?: number }
 */
app.post("/create", async (c) => {
  const body = await c.req.json<{
    adminSecret: string;
    userId: string;
    rateLimit?: number;
  }>();

  const adminSecret = c.env.ADMIN_SECRET as string | undefined;
  if (!adminSecret || body.adminSecret !== adminSecret) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const token = crypto.randomUUID().replace(/-/g, "");
  const record: TokenRecord = {
    userId: body.userId,
    createdAt: Date.now(),
    rateLimit: body.rateLimit ?? 20,
  };

  await c.env.KV.put(`token:${token}`, JSON.stringify(record));

  return c.json({ token, userId: record.userId, rateLimit: record.rateLimit });
});

export default app;
