import { listProviders, getProvider, streamProvider } from "@/providers";
import { buildSystemPrompt } from "@/utils/prompts";
import { loadProviderParams } from "@/utils/storage";
import { STORAGE_KEYS, PORT_NAME } from "@/utils/types";
import type { StreamStartMessage, StreamPortMessage } from "@/utils/types";

export default defineBackground(() => {
  // ─── Migrations ───────────────────────────────────────────────────────────

  chrome.runtime.onInstalled.addListener(async () => {
    await runMigrations();
  });

  function isPlainObject(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  async function runMigrations(): Promise<void> {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.enabled,
      STORAGE_KEYS.provider,
      STORAGE_KEYS.keys,
      STORAGE_KEYS.models,
      STORAGE_KEYS.baseUrls,
      STORAGE_KEYS.legacyApiKey,
      STORAGE_KEYS.legacyModel,
    ]);

    const patch: Record<string, unknown> = {};
    const remove: string[] = [];

    if (data[STORAGE_KEYS.enabled] === undefined) patch[STORAGE_KEYS.enabled] = true;

    if (!data[STORAGE_KEYS.provider]) {
      try {
        const reg = await listProviders();
        patch[STORAGE_KEYS.provider] = reg.default || "anthropic";
      } catch {
        patch[STORAGE_KEYS.provider] = "anthropic";
      }
    }

    const keys = isPlainObject(data[STORAGE_KEYS.keys])
      ? { ...(data[STORAGE_KEYS.keys] as Record<string, string>) }
      : ({} as Record<string, string>);
    const models = isPlainObject(data[STORAGE_KEYS.models])
      ? { ...(data[STORAGE_KEYS.models] as Record<string, string>) }
      : ({} as Record<string, string>);
    const baseUrls = isPlainObject(data[STORAGE_KEYS.baseUrls])
      ? { ...(data[STORAGE_KEYS.baseUrls] as Record<string, string>) }
      : ({} as Record<string, string>);

    const legKey = String(data[STORAGE_KEYS.legacyApiKey] ?? "").trim();
    const legModel = String(data[STORAGE_KEYS.legacyModel] ?? "").trim();
    if (legKey && !keys.anthropic) keys.anthropic = legKey;
    if (legModel && !models.anthropic) models.anthropic = legModel;
    if (legKey || legModel) remove.push(STORAGE_KEYS.legacyApiKey, STORAGE_KEYS.legacyModel);

    patch[STORAGE_KEYS.keys] = keys;
    patch[STORAGE_KEYS.models] = models;
    patch[STORAGE_KEYS.baseUrls] = baseUrls;

    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
    if (remove.length) await chrome.storage.local.remove(remove);
  }

  // ─── Streaming via Ports ──────────────────────────────────────────────────

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;

    let controller: AbortController | null = null;

    port.onDisconnect.addListener(() => {
      controller?.abort();
    });

    const send = (msg: StreamPortMessage) => {
      try {
        port.postMessage(msg);
      } catch {
        /* port closed */
      }
    };

    port.onMessage.addListener(async (msg: StreamStartMessage) => {
      if (msg?.type !== "STREAM_START") return;

      const { question, selection, messages } = msg;

      if (!String(question ?? "").trim()) {
        send({ type: "ERROR", error: "Enter a question." });
        return;
      }
      if (!String(selection ?? "").trim()) {
        send({ type: "ERROR", error: "No selected text." });
        return;
      }

      const params = await loadProviderParams();

      if (!params.providerId) {
        send({ type: "ERROR", error: "No provider selected. Open the popup." });
        return;
      }

      const provider = await getProvider(params.providerId);
      if (!provider) {
        send({ type: "ERROR", error: `Unknown provider: ${params.providerId}` });
        return;
      }
      if (!provider.noAuth && !params.apiKey) {
        send({
          type: "ERROR",
          error: `No API key for ${provider.label}. Open the popup and save one.`,
        });
        return;
      }

      controller = new AbortController();

      try {
        const gen = await streamProvider(params.providerId, {
          apiKey: params.apiKey,
          baseUrl: params.baseUrl,
          model: params.model,
          system: buildSystemPrompt(),
          messages: Array.isArray(messages) ? messages : [],
          signal: controller.signal,
        });

        for await (const chunk of gen) {
          send({ type: "CHUNK", text: chunk });
        }
        send({ type: "DONE", provider: params.providerId });
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        const errMsg = e instanceof Error ? e.message : String(e);
        send({ type: "ERROR", error: errMsg });
      }
    });
  });

  // ─── One-shot messages ────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "ASK_LLM_PING") {
      sendResponse({ ok: true, from: "background", ts: Date.now() });
      return;
    }

    if (message?.type === "ASK_LLM_LIST_PROVIDERS") {
      listProviders()
        .then((reg) => sendResponse({ ok: true, ...reg }))
        .catch((e) =>
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
        );
      return true;
    }
  });
});
