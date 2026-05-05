/**
 * Provider registry + dispatcher.
 *
 * Loads providers.json once and routes runProvider() to the adapter
 * matching the provider's `kind`.
 *
 * Adapter contract (see providers/adapters/*.js):
 *   default export: {
 *     async complete({ apiKey, baseUrl, model, system, user, provider, signal }) -> string
 *     // M4 will add: async *stream(...) -> AsyncIterable<string>
 *   }
 *
 * To add a new OpenAI-compatible provider: append an entry to providers.json
 * with kind "openai-compat". To add a heterogeneous family, write a new
 * adapter file under providers/adapters/ and register its kind in ADAPTERS.
 */

import openaiCompat from "./adapters/openai-compat.js";
import anthropic from "./adapters/anthropic.js";

/** @type {Record<string, { complete: Function }>} */
const ADAPTERS = {
  "openai-compat": openaiCompat,
  anthropic: anthropic,
};

/** @type {{ default: string, providers: Array<ProviderEntry> } | null} */
let registryCache = null;

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   kind: string,
 *   defaultBaseUrl: string,
 *   defaultModel: string,
 *   authHint?: string,
 *   noAuth?: boolean,
 * }} ProviderEntry
 */

async function loadRegistry() {
  if (registryCache) return registryCache;
  const url = chrome.runtime.getURL("providers/providers.json");
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load providers.json: HTTP ${res.status}`);
  }
  const json = await res.json();
  if (!json || !Array.isArray(json.providers)) {
    throw new Error("Invalid providers.json: missing providers[]");
  }
  registryCache = json;
  return json;
}

/** Returns the parsed registry (used by popup for the dropdown). */
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

/** Lookup a provider entry by id. */
export async function getProvider(id) {
  const reg = await loadRegistry();
  return reg.providers.find((p) => p.id === id) ?? null;
}

/**
 * Dispatch a non-streaming completion to the right adapter.
 * @param {string} providerId
 * @param {{
 *   apiKey: string,
 *   baseUrl?: string,
 *   model?: string,
 *   system: string,
 *   user: string,
 *   signal?: AbortSignal,
 * }} params
 */
export async function runProvider(providerId, params) {
  const provider = await getProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  const adapter = ADAPTERS[provider.kind];
  if (!adapter) {
    throw new Error(
      `No adapter registered for kind="${provider.kind}" (provider ${providerId})`,
    );
  }

  const baseUrl = (params.baseUrl?.trim() || provider.defaultBaseUrl).trim();
  const model = (params.model?.trim() || provider.defaultModel).trim();

  if (!provider.noAuth && !params.apiKey?.trim()) {
    throw new Error(
      `No API key for ${provider.label}. Open the popup and save one.`,
    );
  }

  return adapter.complete({
    apiKey: params.apiKey ?? "",
    baseUrl,
    model,
    system: params.system,
    user: params.user,
    provider,
    signal: params.signal,
  });
}
