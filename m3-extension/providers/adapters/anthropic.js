/**
 * Anthropic Messages API adapter.
 * @see https://docs.anthropic.com/en/api/messages
 */

const ANTHROPIC_VERSION = "2023-06-01";

/**
 * @param {{
 *   apiKey: string,
 *   baseUrl: string,
 *   model: string,
 *   system: string,
 *   user: string,
 *   provider: { id: string },
 *   signal?: AbortSignal,
 * }} params
 * @returns {Promise<string>}
 */
async function complete({ apiKey, baseUrl, model, system, user, provider, signal }) {
  const url = `${trimSlash(baseUrl)}/v1/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }],
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

  if (
    !data ||
    typeof data !== "object" ||
    !("content" in data) ||
    !Array.isArray(/** @type {{ content?: unknown }} */ (data).content)
  ) {
    throw new Error("Unexpected API response: missing content[]");
  }

  const parts = /** @type {{ content: Array<{ type?: string; text?: string }> }} */ (
    data
  ).content;
  const text = parts
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => /** @type {{ text: string }} */ (b).text)
    .join("");

  if (!text.trim()) {
    throw new Error("Empty model reply (no text blocks)");
  }
  return text;
}

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

export default { complete };
