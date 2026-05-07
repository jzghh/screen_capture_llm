import type { ChatMessage } from "@/utils/types";

interface BackendStreamParams {
  backendUrl: string;
  backendToken: string;
  providerId: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}

/**
 * Streams from the backend proxy.
 * The backend forwards SSE from the upstream LLM; we parse the same SSE
 * format depending on provider kind (openai-compat vs anthropic).
 * Since the backend passes the raw upstream SSE through, we parse both formats.
 */
export async function* streamViaBackend(params: BackendStreamParams): AsyncGenerator<string> {
  const { backendUrl, backendToken, providerId, model, system, messages, signal } = params;

  const url = `${backendUrl.replace(/\/+$/, "")}/api/chat/stream`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${backendToken}`,
    },
    body: JSON.stringify({ provider: providerId, model, system, messages }),
    signal,
  });

  if (!res.ok) {
    const raw = await res.text();
    let msg: string;
    try {
      const data = JSON.parse(raw) as { error?: string };
      msg = data.error || raw.slice(0, 300);
    } catch {
      msg = raw.slice(0, 300);
    }
    throw new Error(`Backend error (${res.status}): ${msg}`);
  }

  if (!res.body) throw new Error("Backend returned no body");

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

        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }

        // Anthropic format
        if (eventName === "content_block_delta") {
          const delta = evt.delta as { type?: string; text?: string } | undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text) {
            yield delta.text;
          }
          continue;
        }

        // OpenAI-compatible format
        const choices = evt.choices as { delta?: { content?: string } }[] | undefined;
        const content = choices?.[0]?.delta?.content;
        if (typeof content === "string" && content) {
          yield content;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
