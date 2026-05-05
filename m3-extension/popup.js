"use strict";

const STORAGE_KEYS = {
  enabled: "askLlmEnabled",
  provider: "askLlmProvider",
  keys: "askLlmKeys",
  models: "askLlmModels",
  baseUrls: "askLlmBaseUrls",
};

const providerSelectEl = document.querySelector("#provider-select");
const apiKeyEl = document.querySelector("#api-key");
const apiHintEl = document.querySelector("#api-hint");
const modelEl = document.querySelector("#model-id");
const baseUrlEl = document.querySelector("#base-url");
const saveBtn = document.querySelector("#btn-save");
const saveStatus = document.querySelector("#save-status");
const toggleEl = document.querySelector("#toggle-enabled");
const pingBtn = document.querySelector("#btn-ping");
const pingResult = document.querySelector("#ping-result");

/** @type {Array<{ id: string, label: string, defaultBaseUrl: string, defaultModel: string, authHint: string, noAuth: boolean }>} */
let providers = [];

/**
 * In-memory edit buffer so switching providers in the dropdown doesn't lose
 * unsaved values for the others. Keyed by providerId.
 * @type {Record<string, { apiKey: string, model: string, baseUrl: string }>}
 */
const drafts = Object.create(null);

let currentProviderId = "";

async function loadProviderRegistry() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "ASK_LLM_LIST_PROVIDERS" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error ?? "Failed to load providers"));
        return;
      }
      resolve(response);
    });
  });
}

function setSaveStatus(text, ok = true) {
  if (!saveStatus) return;
  saveStatus.hidden = false;
  saveStatus.style.color = ok ? "#059669" : "#b91c1c";
  saveStatus.textContent = text;
}

function fillFormForCurrentProvider() {
  const p = providers.find((x) => x.id === currentProviderId);
  if (!p) return;
  const draft = drafts[p.id] ?? { apiKey: "", model: "", baseUrl: "" };

  if (apiKeyEl instanceof HTMLInputElement) {
    apiKeyEl.value = draft.apiKey;
    apiKeyEl.placeholder = p.authHint || (p.noAuth ? "(no key required)" : "");
    apiKeyEl.disabled = Boolean(p.noAuth);
  }
  if (modelEl instanceof HTMLInputElement) {
    modelEl.value = draft.model;
    modelEl.placeholder = p.defaultModel;
  }
  if (baseUrlEl instanceof HTMLInputElement) {
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

function captureFormIntoDraft() {
  if (!currentProviderId) return;
  drafts[currentProviderId] = {
    apiKey: apiKeyEl instanceof HTMLInputElement ? apiKeyEl.value : "",
    model: modelEl instanceof HTMLInputElement ? modelEl.value.trim() : "",
    baseUrl: baseUrlEl instanceof HTMLInputElement ? baseUrlEl.value.trim() : "",
  };
}

async function init() {
  // 1) Load registry from background
  let reg;
  try {
    reg = await loadProviderRegistry();
  } catch (e) {
    setSaveStatus(`Provider registry error: ${e instanceof Error ? e.message : e}`, false);
    return;
  }
  providers = reg.providers ?? [];

  // 2) Populate <select>
  if (providerSelectEl instanceof HTMLSelectElement) {
    providerSelectEl.innerHTML = "";
    for (const p of providers) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label;
      providerSelectEl.appendChild(opt);
    }
  }

  // 3) Pre-fill drafts from storage
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.enabled,
    STORAGE_KEYS.provider,
    STORAGE_KEYS.keys,
    STORAGE_KEYS.models,
    STORAGE_KEYS.baseUrls,
  ]);
  const keys = isPlainObject(data[STORAGE_KEYS.keys]) ? data[STORAGE_KEYS.keys] : {};
  const models = isPlainObject(data[STORAGE_KEYS.models]) ? data[STORAGE_KEYS.models] : {};
  const baseUrls = isPlainObject(data[STORAGE_KEYS.baseUrls])
    ? data[STORAGE_KEYS.baseUrls]
    : {};
  for (const p of providers) {
    drafts[p.id] = {
      apiKey: String(keys[p.id] ?? ""),
      model: String(models[p.id] ?? ""),
      baseUrl: String(baseUrls[p.id] ?? ""),
    };
  }

  // 4) Set current provider
  currentProviderId =
    String(data[STORAGE_KEYS.provider] || reg.default || providers[0]?.id || "");
  if (providerSelectEl instanceof HTMLSelectElement) {
    providerSelectEl.value = currentProviderId;
  }
  fillFormForCurrentProvider();

  // 5) Toggle
  const enabled = data[STORAGE_KEYS.enabled] !== false;
  if (toggleEl instanceof HTMLInputElement) {
    toggleEl.checked = enabled;
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

providerSelectEl?.addEventListener("change", () => {
  captureFormIntoDraft();
  if (providerSelectEl instanceof HTMLSelectElement) {
    currentProviderId = providerSelectEl.value;
  }
  fillFormForCurrentProvider();
});

saveBtn?.addEventListener("click", async () => {
  captureFormIntoDraft();

  const data = await chrome.storage.local.get([
    STORAGE_KEYS.keys,
    STORAGE_KEYS.models,
    STORAGE_KEYS.baseUrls,
  ]);
  const keys = isPlainObject(data[STORAGE_KEYS.keys]) ? { ...data[STORAGE_KEYS.keys] } : {};
  const models = isPlainObject(data[STORAGE_KEYS.models])
    ? { ...data[STORAGE_KEYS.models] }
    : {};
  const baseUrls = isPlainObject(data[STORAGE_KEYS.baseUrls])
    ? { ...data[STORAGE_KEYS.baseUrls] }
    : {};

  for (const [id, draft] of Object.entries(drafts)) {
    keys[id] = draft.apiKey ?? "";
    models[id] = draft.model ?? "";
    baseUrls[id] = draft.baseUrl ?? "";
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.provider]: currentProviderId,
    [STORAGE_KEYS.keys]: keys,
    [STORAGE_KEYS.models]: models,
    [STORAGE_KEYS.baseUrls]: baseUrls,
  });

  setSaveStatus("Saved.", true);
});

toggleEl?.addEventListener("change", async () => {
  if (!(toggleEl instanceof HTMLInputElement)) return;
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

pingBtn?.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "ASK_LLM_PING" }, (response) => {
    if (chrome.runtime.lastError) {
      if (pingResult) {
        pingResult.hidden = false;
        pingResult.style.color = "#b91c1c";
        pingResult.textContent = chrome.runtime.lastError.message;
      }
      return;
    }
    if (pingResult) {
      pingResult.hidden = false;
      pingResult.style.color = "#059669";
      pingResult.textContent = response
        ? `OK · ${response.from} · ts=${response.ts}`
        : "No response";
    }
  });
});

void init();
