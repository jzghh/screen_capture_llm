/**
 * Provider registry + dispatcher (M4: adds streamProvider).
 *
 * Adapter contract:
 *   default export: {
 *     async complete({ apiKey, baseUrl, model, system, messages, provider, signal }) -> string
 *     async *stream({ ... same ... }) -> AsyncGenerator<string>
 *   }
 */

import openaiCompat from "./adapters/openai-compat.js";
import anthropic from "./adapters/anthropic.js";

const ADAPTERS = {
  "openai-compat": openaiCompat,
  anthropic: anthropic,
};

let registryCache = null;

async function loadRegistry() {
  if (registryCache) return registryCache;
  const url = chrome.runtime.getURL("providers/providers.json");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load providers.json: HTTP ${res.status}`);
  const json = await res.json();
  if (!json || !Array.isArray(json.providers)) throw new Error("Invalid providers.json");
  registryCache = json;
  return json;
}

export async function listProviders() {
  const reg = await loadRegistry();
  return {
    default: String(reg.default ?? reg.providers[0]?.id ?? ""),
    providers: reg.providers.map((p) => ({
      id: p.id,
      label: p.label,
      kind: p.kind,
      defaultBaseUrl: p.defaultBaseUrl,
      defaultModel: p.defaultModel,
      authHint: p.authHint ?? "",
      noAuth: Boolean(p.noAuth),
    })),
  };
}

export async function getProvider(id) {
  const reg = await loadRegistry();
  return reg.providers.find((p) => p.id === id) ?? null;
}

async function resolveParams(providerId, params) {
  const provider = await getProvider(providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  const adapter = ADAPTERS[provider.kind];
  if (!adapter) throw new Error(`No adapter for kind="${provider.kind}"`);

  const baseUrl = (params.baseUrl?.trim() || provider.defaultBaseUrl).trim();
  const model = (params.model?.trim() || provider.defaultModel).trim();

  if (!provider.noAuth && !params.apiKey?.trim()) {
    throw new Error(`No API key for ${provider.label}. Open the popup and save one.`);
  }

  return {
    adapter,
    provider,
    resolved: { apiKey: params.apiKey ?? "", baseUrl, model },
  };
}

/** Non-streaming: returns full response string. */
export async function runProvider(providerId, params) {
  const { adapter, provider, resolved } = await resolveParams(providerId, params);
  return adapter.complete({
    ...resolved,
    system: params.system,
    messages: params.messages,
    provider,
    signal: params.signal,
  });
}

/**
 * Streaming: returns an AsyncGenerator<string> of text chunks.
 * Caller must consume (or abort via params.signal).
 */
export async function streamProvider(providerId, params) {
  const { adapter, provider, resolved } = await resolveParams(providerId, params);
  if (typeof adapter.stream !== "function") {
    throw new Error(`Provider ${providerId} does not support streaming`);
  }
  return adapter.stream({
    ...resolved,
    system: params.system,
    messages: params.messages,
    provider,
    signal: params.signal,
  });
}
