/**
 * OpenAI-compatible adapter — non-streaming complete() + SSE stream().
 * Covers OpenAI, DeepSeek, Groq, Together, Mistral, Ollama /v1, etc.
 */

function trimSlash(s) {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function extractError(data) {
  if (data && typeof data === "object") {
    const err = /** @type {{ error?: unknown }} */ (data).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && "message" in err) {
      const m = /** @type {{ message?: unknown }} */ (err).message;
      if (typeof m === "string") return m;
    }
  }
  return "";
}

function extractTextFromChoice(data) {
  if (
    data &&
    typeof data === "object" &&
    "choices" in data &&
    Array.isArray(/** @type {{ choices?: unknown }} */ (data).choices)
  ) {
    const first = /** @type {{ choices: Array<unknown> }} */ (data).choices[0];
    if (first && typeof first === "object" && "message" in first) {
      const msg = /** @type {{ message?: unknown }} */ (first).message;
      if (msg && typeof msg === "object" && "content" in msg) {
        const c = /** @type {{ content?: unknown }} */ (msg).content;
        if (typeof c === "string") return c;
        if (Array.isArray(c)) {
          return c
            .map((p) =>
              p && typeof p === "object" && "text" in p
                ? String(/** @type {{ text?: unknown }} */ (p).text ?? "")
                : "",
            )
            .join("");
        }
      }
    }
  }
  return null;
}

function buildHeaders(apiKey, provider) {
  /** @type {Record<string, string>} */
  const h = { "content-type": "application/json" };
  if (!provider.noAuth) {
    h["authorization"] = `Bearer ${apiKey}`;
  }
  return h;
}

/**
 * @param {{
 *   apiKey: string,
 *   baseUrl: string,
 *   model: string,
 *   system: string,
 *   messages: Array<{ role: string, content: string }>,
 *   provider: { id: string, noAuth?: boolean },
 *   signal?: AbortSignal,
 * }} params
 */
async function complete({ apiKey, baseUrl, model, system, messages, provider, signal }) {
  const url = `${trimSlash(baseUrl)}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(apiKey, provider),
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, ...messages],
    }),
    signal,
  });

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${provider.id}: non-JSON (HTTP ${res.status}): ${raw.slice(0, 240)}`);
  }
  if (!res.ok) {
    throw new Error(extractError(data) || `HTTP ${res.status}: ${raw.slice(0, 240)}`);
  }
  const text = extractTextFromChoice(data);
  if (text === null) throw new Error("Unexpected response: missing choices[0].message.content");
  if (!text.trim()) throw new Error("Empty model reply");
  return text;
}

/**
 * Yields text delta chunks from an SSE stream.
 * @param {{
 *   apiKey: string,
 *   baseUrl: string,
 *   model: string,
 *   system: string,
 *   messages: Array<{ role: string, content: string }>,
 *   provider: { id: string, noAuth?: boolean },
 *   signal?: AbortSignal,
 * }} params
 * @returns {AsyncGenerator<string>}
 */
async function* stream({ apiKey, baseUrl, model, system, messages, provider, signal }) {
  const url = `${trimSlash(baseUrl)}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(apiKey, provider),
    body: JSON.stringify({
      model,
      stream: true,
      messages: [{ role: "system", content: system }, ...messages],
    }),
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

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE lines: "data: {...}\n\n"
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return;

        let evt;
        try { evt = JSON.parse(payload); } catch { continue; }

        const delta = evt?.choices?.[0]?.delta;
        if (delta && typeof delta.content === "string" && delta.content) {
          yield delta.content;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export default { complete, stream };
