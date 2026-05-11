import type { Adapter, AdapterParams, ProviderEntry } from "@/utils/types";
import { MAX_RESPONSE_TOKENS } from "@/utils/types";
import { trimSlash, extractError } from "./helpers";

function extractText(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.choices)) return null;
  const first = obj.choices[0] as Record<string, unknown> | undefined;
  if (!first || typeof first !== "object" || !("message" in first)) return null;
  const msg = first.message as Record<string, unknown> | undefined;
  if (!msg || typeof msg !== "object" || !("content" in msg)) return null;
  const c = msg.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p) =>
        p && typeof p === "object" && "text" in p
          ? String((p as { text: unknown }).text ?? "")
          : "",
      )
      .join("");
  }
  return null;
}

function buildHeaders(apiKey: string, provider: ProviderEntry): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (!provider.noAuth) {
    h["authorization"] = `Bearer ${apiKey}`;
  }
  return h;
}

async function complete(params: AdapterParams): Promise<string> {
  const { apiKey, baseUrl, model, system, messages, provider, signal } = params;
  const url = `${trimSlash(baseUrl)}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(apiKey, provider),
    body: JSON.stringify({
      model,
      max_tokens: MAX_RESPONSE_TOKENS,
      messages: [{ role: "system", content: system }, ...messages],
    }),
    signal,
  });

  const raw = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${provider.id}: non-JSON (HTTP ${res.status}): ${raw.slice(0, 240)}`);
  }
  if (!res.ok) {
    throw new Error(extractError(data) || `HTTP ${res.status}: ${raw.slice(0, 240)}`);
  }
  const text = extractText(data);
  if (text === null) throw new Error("Missing choices[0].message.content");
  if (!text.trim()) throw new Error("Empty model reply");
  return text;
}

async function* stream(params: AdapterParams): AsyncGenerator<string> {
  const { apiKey, baseUrl, model, system, messages, provider, signal } = params;
  const url = `${trimSlash(baseUrl)}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(apiKey, provider),
    body: JSON.stringify({
      model,
      max_tokens: MAX_RESPONSE_TOKENS,
      stream: true,
      messages: [{ role: "system", content: system }, ...messages],
    }),
    signal,
  });

  if (!res.ok) {
    const raw = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
    throw new Error(extractError(data) || `HTTP ${res.status}: ${raw.slice(0, 240)}`);
  }

  if (!res.body) throw new Error("Response body is null");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return;

        let evt: { choices?: { delta?: { content?: string } }[] };
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }

        const content = evt?.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content) {
          yield content;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

const adapter: Adapter = { complete, stream };
export default adapter;
