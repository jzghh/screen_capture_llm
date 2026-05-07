import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

export const cors = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const origin = c.req.header("Origin") ?? "";
  const allowed = c.env.ALLOWED_ORIGIN ?? "";

  const isAllowed =
    origin.startsWith("chrome-extension://") ||
    origin === allowed ||
    allowed === "*";

  c.header("Access-Control-Allow-Origin", isAllowed ? origin : "");
  c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  c.header("Access-Control-Max-Age", "86400");

  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }

  await next();
});
