import type { Adapter, AdapterParams } from "@/utils/types";
import { MAX_RESPONSE_TOKENS } from "@/utils/types";
import { trimSlash, extractError, withTimeout } from "./helpers";

const ANTHROPIC_VERSION = "2023-06-01";

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

async function complete(params: AdapterParams): Promise<string> {
  const { apiKey, baseUrl, model, system, messages, provider, signal } = params;
  const url = `${trimSlash(baseUrl)}/v1/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify({ model, max_tokens: MAX_RESPONSE_TOKENS, system, messages }),
    signal: withTimeout(signal),
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

  const obj = data as { content?: { type?: string; text?: string }[] };
  if (!Array.isArray(obj.content)) throw new Error("Missing content[]");
  const text = obj.content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text!)
    .join("");
  if (!text.trim()) throw new Error("Empty model reply");
  return text;
}

async function* stream(params: AdapterParams): AsyncGenerator<string> {
  const { apiKey, baseUrl, model, system, messages, signal } = params;
  const url = `${trimSlash(baseUrl)}/v1/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify({ model, max_tokens: MAX_RESPONSE_TOKENS, system, messages, stream: true }),
    signal: withTimeout(signal),
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
  let eventName = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          eventName = "";
          continue;
        }

        if (trimmed.startsWith("event:")) {
          eventName = trimmed.slice(6).trim();
          continue;
        }
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return;
        if (eventName !== "content_block_delta") continue;

        let evt: { delta?: { type?: string; text?: string } };
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }

        if (evt?.delta?.type === "text_delta" && typeof evt.delta.text === "string") {
          if (evt.delta.text) yield evt.delta.text;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

const adapter: Adapter = { complete, stream };
export default adapter;
