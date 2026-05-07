import { Hono } from "hono";
import type { Env } from "../types";
import { PROVIDERS } from "../providers";

const app = new Hono<{ Bindings: Env }>();

/**
 * GET /api/providers
 * Returns the list of available providers (only those with a key configured).
 */
app.get("/", (c) => {
  const available = PROVIDERS.filter((p) => {
    const key = c.env[p.envKey] as string | undefined;
    return Boolean(key?.trim());
  }).map((p) => ({
    id: p.id,
    label: p.label,
    defaultModel: p.defaultModel,
  }));

  return c.json({ providers: available, default: available[0]?.id ?? "" });
});

export default app;
