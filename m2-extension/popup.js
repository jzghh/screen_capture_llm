"use strict";

const STORAGE_ENABLED_KEY = "askLlmEnabled";

const toggleEl = document.querySelector("#toggle-enabled");
const pingBtn = document.querySelector("#btn-ping");
const pingResult = document.querySelector("#ping-result");

async function loadState() {
  const data = await chrome.storage.local.get(STORAGE_ENABLED_KEY);
  const enabled = data[STORAGE_ENABLED_KEY] !== false;
  if (toggleEl instanceof HTMLInputElement) {
    toggleEl.checked = enabled;
  }
}

async function saveEnabled(checked) {
  await chrome.storage.local.set({ [STORAGE_ENABLED_KEY]: checked });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "ASK_LLM_REFRESH" });
    } catch {
      /* Tab may have no content script (e.g. chrome://) */
    }
  }
}

toggleEl?.addEventListener("change", () => {
  if (toggleEl instanceof HTMLInputElement) {
    void saveEnabled(toggleEl.checked);
  }
});

pingBtn?.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "ASK_LLM_PING" }, (response) => {
    if (chrome.runtime.lastError) {
      if (pingResult) {
        pingResult.hidden = false;
        pingResult.textContent = chrome.runtime.lastError.message;
      }
      return;
    }
    if (pingResult) {
      pingResult.hidden = false;
      pingResult.textContent = response
        ? `OK · ${response.from} · ts=${response.ts}`
        : "No response";
    }
  });
});

void loadState();
