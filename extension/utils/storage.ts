import { STORAGE_KEYS, type ProviderParams } from "./types";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export async function loadProviderParams(): Promise<ProviderParams> {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.provider,
    STORAGE_KEYS.keys,
    STORAGE_KEYS.models,
    STORAGE_KEYS.baseUrls,
  ]);

  const providerId = String(data[STORAGE_KEYS.provider] || "").trim();
  const keys = isPlainObject(data[STORAGE_KEYS.keys]) ? data[STORAGE_KEYS.keys] : {};
  const models = isPlainObject(data[STORAGE_KEYS.models]) ? data[STORAGE_KEYS.models] : {};
  const baseUrls = isPlainObject(data[STORAGE_KEYS.baseUrls]) ? data[STORAGE_KEYS.baseUrls] : {};

  return {
    providerId,
    apiKey: String((keys as Record<string, string>)[providerId] ?? "").trim(),
    model: String((models as Record<string, string>)[providerId] ?? "").trim(),
    baseUrl: String((baseUrls as Record<string, string>)[providerId] ?? "").trim(),
  };
}
