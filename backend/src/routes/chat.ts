import { Hono } from "hono";
import type { Env, ChatRequest } from "../types";
import { getProvider } from "../providers";

const ANTHROPIC_VERSION = "2023-06-01";

const app = new Hono<{ Bindings: Env }>();

/**
 * POST /api/chat/stream
 * Proxies a streaming request to the chosen LLM provider.
 * The backend holds the API key; the client never sees it.
 */
app.post("/stream", async (c) => {
  const body = await c.req.json<ChatRequest>();

  if (!body.provider) return c.json({ error: "Missing provider" }, 400);
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: "Missing messages" }, 400);
  }

  const provider = getProvider(body.provider);
  if (!provider) return c.json({ error: `Unknown provider: ${body.provider}` }, 400);

  const apiKey = c.env[provider.envKey] as string | undefined;
  if (!apiKey) {
    return c.json({ error: `Server has no API key configured for ${provider.label}` }, 503);
  }

  const model = body.model?.trim() || provider.defaultModel;
  const system = body.system || "";

  let upstreamUrl: string;
  let headers: Record<string, string>;
  let payload: string;

  if (provider.kind === "anthropic") {
    upstreamUrl = `${provider.defaultBaseUrl}/v1/messages`;
    headers = {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    };
    payload = JSON.stringify({
      model,
      max_tokens: 2048,
      system,
      messages: body.messages,
      stream: true,
    });
  } else {
    upstreamUrl = `${provider.defaultBaseUrl}/chat/completions`;
    headers = {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    };
    payload = JSON.stringify({
      model,
      stream: true,
      messages: [{ role: "system", content: system }, ...body.messages],
    });
  }

  const upstream = await fetch(upstreamUrl, {
    method: "POST",
    headers,
    body: payload,
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return c.json(
      { error: `Upstream ${provider.id} error: ${errText.slice(0, 300)}` },
      upstream.status as 400,
    );
  }

  if (!upstream.body) {
    return c.json({ error: "Upstream returned no body" }, 502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

export default app;
