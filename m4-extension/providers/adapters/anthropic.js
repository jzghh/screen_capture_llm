/**
 * Anthropic Messages API adapter — non-streaming complete() + SSE stream().
 * @see https://docs.anthropic.com/en/api/messages
 * @see https://docs.anthropic.com/en/api/messages-streaming
 */

const ANTHROPIC_VERSION = "2023-06-01";

function trimSlash(s) {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function extractError(data) {
  if (data && typeof data === "object" && "error" in data) {
    const err = /** @type {{ error?: unknown }} */ (data).error;
    if (err && typeof err === "object" && "message" in err) {
      const m = /** @type {{ message?: unknown }} */ (err).message;
      if (typeof m === "string") return m;
    }
  }
  return "";
}

function buildHeaders(apiKey) {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

/**
 * @param {{
 *   apiKey: string,
 *   baseUrl: string,
 *   model: string,
 *   system: string,
 *   messages: Array<{ role: string, content: string }>,
 *   provider: { id: string },
 *   signal?: AbortSignal,
 * }} params
 */
async function complete({ apiKey, baseUrl, model, system, messages, provider, signal }) {
  const url = `${trimSlash(baseUrl)}/v1/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify({ model, max_tokens: 2048, system, messages }),
    signal,
  });

  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch {
    throw new Error(`${provider.id}: non-JSON (HTTP ${res.status}): ${raw.slice(0, 240)}`);
  }
  if (!res.ok) throw new Error(extractError(data) || `HTTP ${res.status}: ${raw.slice(0, 240)}`);

  if (!data || !Array.isArray(data.content)) throw new Error("Missing content[]");
  const text = data.content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) throw new Error("Empty model reply");
  return text;
}

/**
 * Yields text delta strings from an Anthropic SSE stream.
 * Events: content_block_delta (delta.type === "text_delta" has delta.text).
 * @param {{
 *   apiKey: string,
 *   baseUrl: string,
 *   model: string,
 *   system: string,
 *   messages: Array<{ role: string, content: string }>,
 *   provider: { id: string },
 *   signal?: AbortSignal,
 * }} params
 * @returns {AsyncGenerator<string>}
 */
async function* stream({ apiKey, baseUrl, model, system, messages, provider, signal }) {
  const url = `${trimSlash(baseUrl)}/v1/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify({ model, max_tokens: 2048, system, messages, stream: true }),
    signal,
  });

  if (!res.ok) {
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = null; }
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
        if (!trimmed) { eventName = ""; continue; }

        if (trimmed.startsWith("event:")) {
          eventName = trimmed.slice(6).trim();
          continue;
        }
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return;

        // Only process content deltas
        if (eventName !== "content_block_delta") continue;

        let evt;
        try { evt = JSON.parse(payload); } catch { continue; }

        if (evt?.delta?.type === "text_delta" && typeof evt.delta.text === "string") {
          if (evt.delta.text) yield evt.delta.text;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export default { complete, stream };
