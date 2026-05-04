/** Default: feature on after install */
const STORAGE_KEYS = {
  enabled: "askLlmEnabled",
};

chrome.runtime.onInstalled.addListener(async () => {
  const { [STORAGE_KEYS.enabled]: existing } = await chrome.storage.local.get(
    STORAGE_KEYS.enabled,
  );
  if (existing === undefined) {
    await chrome.storage.local.set({ [STORAGE_KEYS.enabled]: true });
  }
});

/**
 * Demo messaging for popup ↔ service worker (M2 learning: sendMessage / reply).
 * MV3: service workers may sleep; onMessage wakes them for the callback duration.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ASK_LLM_PING") {
    sendResponse({ ok: true, from: "background", ts: Date.now() });
  }
});
