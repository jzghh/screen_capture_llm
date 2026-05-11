import type {
  Adapter,
  AdapterParams,
  ChatMessage,
  ProviderEntry,
  ProviderRegistry,
} from "@/utils/types";
import openaiCompat from "./adapters/openai-compat";
import anthropic from "./adapters/anthropic";

const ADAPTERS: Record<string, Adapter> = {
  "openai-compat": openaiCompat,
  anthropic: anthropic,
};

let registryCache: ProviderRegistry | null = null;

export function clearRegistryCache(): void {
  registryCache = null;
}

async function loadRegistry(): Promise<ProviderRegistry> {
  if (registryCache) return registryCache;
  const url = chrome.runtime.getURL("providers.json");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load providers.json: HTTP ${res.status}`);
  const json: ProviderRegistry = await res.json();
  if (!json || !Array.isArray(json.providers)) throw new Error("Invalid providers.json");
  registryCache = json;
  return json;
}

export async function listProviders(): Promise<{
  default: string;
  providers: ProviderEntry[];
}> {
  const reg = await loadRegistry();
  return {
    default: reg.default ?? reg.providers[0]?.id ?? "",
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

export async function getProvider(id: string): Promise<ProviderEntry | null> {
  const reg = await loadRegistry();
  return reg.providers.find((p) => p.id === id) ?? null;
}

interface RunParams {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  system: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}

async function resolveAdapter(
  providerId: string,
  params: RunParams,
): Promise<{ adapter: Adapter; adapterParams: AdapterParams }> {
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
    adapterParams: {
      apiKey: params.apiKey,
      baseUrl,
      model,
      system: params.system,
      messages: params.messages,
      provider,
      signal: params.signal,
    },
  };
}

export async function runProvider(providerId: string, params: RunParams): Promise<string> {
  const { adapter, adapterParams } = await resolveAdapter(providerId, params);
  return adapter.complete(adapterParams);
}

export async function streamProvider(
  providerId: string,
  params: RunParams,
): Promise<AsyncGenerator<string>> {
  const { adapter, adapterParams } = await resolveAdapter(providerId, params);
  return adapter.stream(adapterParams);
}
