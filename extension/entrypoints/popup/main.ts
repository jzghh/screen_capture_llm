import { STORAGE_KEYS } from "@/utils/types";
import type { ConnectionMode, ProviderEntry } from "@/utils/types";

interface Draft {
  apiKey: string;
  model: string;
  baseUrl: string;
}

const $ = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

const modeSelectEl = $<HTMLSelectElement>("#mode-select");
const backendSettingsEl = $<HTMLDivElement>("#backend-settings");
const selfHostedSettingsEl = $<HTMLDivElement>("#self-hosted-settings");
const backendUrlEl = $<HTMLInputElement>("#backend-url");
const backendTokenEl = $<HTMLInputElement>("#backend-token");
const selfHostedWarningEl = $<HTMLParagraphElement>("#self-hosted-warning");

const providerSelectEl = $<HTMLSelectElement>("#provider-select");
const apiKeyEl = $<HTMLInputElement>("#api-key");
const apiHintEl = $<HTMLParagraphElement>("#api-hint");
const modelEl = $<HTMLInputElement>("#model-id");
const baseUrlEl = $<HTMLInputElement>("#base-url");
const saveBtn = $<HTMLButtonElement>("#btn-save");
const saveStatus = $<HTMLParagraphElement>("#save-status");
const toggleEl = $<HTMLInputElement>("#toggle-enabled");
const pingBtn = $<HTMLButtonElement>("#btn-ping");
const pingResult = $<HTMLParagraphElement>("#ping-result");

let providers: ProviderEntry[] = [];
const drafts: Record<string, Draft> = Object.create(null);
let currentProviderId = "";
let currentMode: ConnectionMode = "self-hosted";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

interface RegistryResponse {
  ok: boolean;
  default?: string;
  providers?: ProviderEntry[];
  error?: string;
}

async function loadProviderRegistry(): Promise<RegistryResponse> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "ASK_LLM_LIST_PROVIDERS",
    })) as RegistryResponse | undefined;
    return response ?? { ok: false, error: "No response" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function setSaveStatus(text: string, ok = true): void {
  if (!saveStatus) return;
  saveStatus.hidden = false;
  saveStatus.style.color = ok ? "#059669" : "#b91c1c";
  saveStatus.textContent = text;
}

function applyModeVisibility(): void {
  const isBackend = currentMode === "backend";
  if (backendSettingsEl) backendSettingsEl.hidden = !isBackend;
  if (selfHostedSettingsEl) selfHostedSettingsEl.hidden = isBackend;
  if (selfHostedWarningEl) selfHostedWarningEl.hidden = isBackend;
}

function fillFormForCurrentProvider(): void {
  const p = providers.find((x) => x.id === currentProviderId);
  if (!p) return;
  const draft = drafts[p.id] ?? { apiKey: "", model: "", baseUrl: "" };

  if (apiKeyEl) {
    apiKeyEl.value = draft.apiKey;
    apiKeyEl.placeholder = p.authHint || (p.noAuth ? "(no key required)" : "");
    apiKeyEl.disabled = Boolean(p.noAuth);
  }
  if (modelEl) {
    modelEl.value = draft.model;
    modelEl.placeholder = p.defaultModel;
  }
  if (baseUrlEl) {
    baseUrlEl.value = draft.baseUrl;
    baseUrlEl.placeholder = p.defaultBaseUrl;
  }
  if (apiHintEl) {
    if (p.noAuth) {
      apiHintEl.hidden = false;
      apiHintEl.textContent = "This provider runs without an API key.";
    } else if (p.authHint) {
      apiHintEl.hidden = false;
      apiHintEl.textContent = `Format: ${p.authHint}`;
    } else {
      apiHintEl.hidden = true;
    }
  }
}

function captureFormIntoDraft(): void {
  if (!currentProviderId) return;
  drafts[currentProviderId] = {
    apiKey: apiKeyEl?.value ?? "",
    model: modelEl?.value.trim() ?? "",
    baseUrl: baseUrlEl?.value.trim() ?? "",
  };
}

async function init(): Promise<void> {
  const reg = await loadProviderRegistry();
  if (!reg.ok) {
    setSaveStatus(`Provider registry error: ${reg.error}`, false);
    return;
  }
  providers = reg.providers ?? [];

  if (providerSelectEl) {
    providerSelectEl.innerHTML = "";
    for (const p of providers) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label;
      providerSelectEl.appendChild(opt);
    }
  }

  const data = await chrome.storage.local.get([
    STORAGE_KEYS.enabled,
    STORAGE_KEYS.provider,
    STORAGE_KEYS.keys,
    STORAGE_KEYS.models,
    STORAGE_KEYS.baseUrls,
    STORAGE_KEYS.mode,
    STORAGE_KEYS.backendUrl,
    STORAGE_KEYS.backendToken,
  ]);
  const keys = isPlainObject(data[STORAGE_KEYS.keys]) ? data[STORAGE_KEYS.keys] : {};
  const models = isPlainObject(data[STORAGE_KEYS.models]) ? data[STORAGE_KEYS.models] : {};
  const baseUrls = isPlainObject(data[STORAGE_KEYS.baseUrls]) ? data[STORAGE_KEYS.baseUrls] : {};

  for (const p of providers) {
    drafts[p.id] = {
      apiKey: String((keys as Record<string, string>)[p.id] ?? ""),
      model: String((models as Record<string, string>)[p.id] ?? ""),
      baseUrl: String((baseUrls as Record<string, string>)[p.id] ?? ""),
    };
  }

  currentProviderId = String(data[STORAGE_KEYS.provider] || reg.default || providers[0]?.id || "");
  if (providerSelectEl) providerSelectEl.value = currentProviderId;
  fillFormForCurrentProvider();

  currentMode = (data[STORAGE_KEYS.mode] as ConnectionMode) || "self-hosted";
  if (modeSelectEl) modeSelectEl.value = currentMode;
  if (backendUrlEl) backendUrlEl.value = String(data[STORAGE_KEYS.backendUrl] ?? "");
  if (backendTokenEl) backendTokenEl.value = String(data[STORAGE_KEYS.backendToken] ?? "");
  applyModeVisibility();

  const enabled = data[STORAGE_KEYS.enabled] !== false;
  if (toggleEl) toggleEl.checked = enabled;
}

modeSelectEl?.addEventListener("change", () => {
  currentMode = (modeSelectEl?.value as ConnectionMode) || "self-hosted";
  applyModeVisibility();
});

providerSelectEl?.addEventListener("change", () => {
  captureFormIntoDraft();
  if (providerSelectEl) currentProviderId = providerSelectEl.value;
  fillFormForCurrentProvider();
});

saveBtn?.addEventListener("click", async () => {
  captureFormIntoDraft();

  const saveData: Record<string, unknown> = {
    [STORAGE_KEYS.mode]: currentMode,
    [STORAGE_KEYS.provider]: currentProviderId,
    [STORAGE_KEYS.backendUrl]: backendUrlEl?.value.trim() ?? "",
    [STORAGE_KEYS.backendToken]: backendTokenEl?.value ?? "",
  };

  if (currentMode === "self-hosted") {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.keys,
      STORAGE_KEYS.models,
      STORAGE_KEYS.baseUrls,
    ]);
    const keys = isPlainObject(data[STORAGE_KEYS.keys])
      ? { ...(data[STORAGE_KEYS.keys] as Record<string, string>) }
      : ({} as Record<string, string>);
    const models = isPlainObject(data[STORAGE_KEYS.models])
      ? { ...(data[STORAGE_KEYS.models] as Record<string, string>) }
      : ({} as Record<string, string>);
    const baseUrls = isPlainObject(data[STORAGE_KEYS.baseUrls])
      ? { ...(data[STORAGE_KEYS.baseUrls] as Record<string, string>) }
      : ({} as Record<string, string>);

    for (const [id, draft] of Object.entries(drafts)) {
      keys[id] = draft.apiKey ?? "";
      models[id] = draft.model ?? "";
      baseUrls[id] = draft.baseUrl ?? "";
    }

    saveData[STORAGE_KEYS.keys] = keys;
    saveData[STORAGE_KEYS.models] = models;
    saveData[STORAGE_KEYS.baseUrls] = baseUrls;
  }

  await chrome.storage.local.set(saveData);
  setSaveStatus("Saved.", true);
});

toggleEl?.addEventListener("change", async () => {
  if (!toggleEl) return;
  await chrome.storage.local.set({ [STORAGE_KEYS.enabled]: toggleEl.checked });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "ASK_LLM_REFRESH" });
    } catch {
      /* Tab may have no content script */
    }
  }
});

pingBtn?.addEventListener("click", async () => {
  try {
    const response = (await chrome.runtime.sendMessage({ type: "ASK_LLM_PING" })) as
      | { from?: string; ts?: number }
      | undefined;
    if (pingResult) {
      pingResult.hidden = false;
      pingResult.style.color = "#059669";
      pingResult.textContent = response
        ? `OK \u00B7 ${response.from} \u00B7 ts=${response.ts}`
        : "No response";
    }
  } catch (e) {
    if (pingResult) {
      pingResult.hidden = false;
      pingResult.style.color = "#b91c1c";
      pingResult.textContent = e instanceof Error ? e.message : String(e);
    }
  }
});

void init();
