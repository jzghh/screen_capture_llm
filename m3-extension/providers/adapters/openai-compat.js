/**
 * OpenAI-compatible Chat Completions adapter.
 *
 * Covers OpenAI, DeepSeek, Groq, Together, Mistral, Ollama (`/v1`), and most
 * proxies that mirror the same endpoint.
 *
 * Each provider entry in providers.json supplies `defaultBaseUrl` and
 * `defaultModel`; the user may override `baseUrl` per provider via popup.
 */

/**
 * @param {{
 *   apiKey: string,
 *   baseUrl: string,
 *   model: string,
 *   system: string,
 *   user: string,
 *   provider: { id: string, noAuth?: boolean },
 *   signal?: AbortSignal,
 * }} params
 * @returns {Promise<string>}
 */
async function complete({ apiKey, baseUrl, model, system, user, provider, signal }) {
  const url = `${trimSlash(baseUrl)}/chat/completions`;

  /** @type {Record<string, string>} */
  const headers = { "content-type": "application/json" };
  if (!provider.noAuth) {
    headers["authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal,
  });

  const raw = await res.text();
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `${provider.id} returned non-JSON (HTTP ${res.status}): ${raw.slice(0, 240)}`,
    );
  }

  if (!res.ok) {
    throw new Error(extractError(data) || `HTTP ${res.status}: ${raw.slice(0, 240)}`);
  }

  const text = extractText(data);
  if (!text.trim()) {
    throw new Error("Empty model reply");
  }
  return text;
}

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

function extractText(data) {
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
          // Some providers return an array of content parts
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
  throw new Error("Unexpected response: missing choices[0].message.content");
}

export default { complete };
