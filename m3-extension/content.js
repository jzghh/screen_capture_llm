"use strict";

const STORAGE_ENABLED_KEY = "askLlmEnabled";

console.log("[ask-llm:m3] content script loaded");

/** @type {HTMLButtonElement | null} */
let bubbleEl = null;
/** @type {HTMLDivElement | null} */
let panelEl = null;
/** @type {HTMLElement | null} */
let panelQuestionInput = null;
/** @type {HTMLElement | null} */
let panelAnswerEl = null;
/** @type {HTMLElement | null} */
let panelSelectionEl = null;
/** @type {HTMLButtonElement | null} */
let panelSubmitBtn = null;

let lastSelectedText = "";
let featureEnabled = true;

async function readEnabledFromStorage() {
  const data = await chrome.storage.local.get(STORAGE_ENABLED_KEY);
  featureEnabled = data[STORAGE_ENABLED_KEY] !== false;
  return featureEnabled;
}

function setSubmitBusy(busy) {
  if (!panelSubmitBtn) {
    return;
  }
  panelSubmitBtn.disabled = busy;
  panelSubmitBtn.textContent = busy ? "Asking…" : "Ask Claude";
}

function ensureUi() {
  if (bubbleEl && panelEl) {
    return;
  }

  bubbleEl = document.createElement("button");
  bubbleEl.type = "button";
  bubbleEl.className = "ask-llm-bubble";
  bubbleEl.setAttribute("aria-label", "Ask about selection");
  bubbleEl.textContent = "💬";
  bubbleEl.hidden = true;

  bubbleEl.addEventListener("click", (event) => {
    event.stopPropagation();
    openPanel();
  });

  panelEl = document.createElement("div");
  panelEl.className = "ask-llm-panel";
  panelEl.hidden = true;
  panelEl.innerHTML = [
    '<div class="ask-llm-panel__header">',
    '  <span class="ask-llm-panel__title">Ask LLM (M3)</span>',
    '  <button type="button" class="ask-llm-panel__close" aria-label="Close panel">✕</button>',
    "</div>",
    '<div class="ask-llm-panel__body">',
    '  <p class="ask-llm-panel__label">Selected text</p>',
    '  <div class="ask-llm-panel__selection"></div>',
    '  <label class="ask-llm-panel__label" for="ask-llm-question-textarea">Your question</label>',
    '  <textarea id="ask-llm-question-textarea" class="ask-llm-panel__input" rows="3" ',
    '    placeholder="e.g. Summarize this in one sentence"></textarea>',
    '  <button type="button" class="ask-llm-panel__submit">Ask Claude</button>',
    '  <p class="ask-llm-panel__label">Answer</p>',
    '  <div class="ask-llm-panel__answer" aria-live="polite"></div>',
    "</div>",
  ].join("");

  /** @type {HTMLButtonElement | null} */
  const closeBtn = panelEl.querySelector(".ask-llm-panel__close");
  panelSubmitBtn = panelEl.querySelector(".ask-llm-panel__submit");
  panelQuestionInput = panelEl.querySelector("#ask-llm-question-textarea");
  panelAnswerEl = panelEl.querySelector(".ask-llm-panel__answer");
  panelSelectionEl = panelEl.querySelector(".ask-llm-panel__selection");

  closeBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    hidePanel();
    hideBubble();
  });

  panelSubmitBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    requestModelAnswer();
  });

  panelEl.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.body.append(bubbleEl, panelEl);
}

function hideBubble() {
  if (bubbleEl) {
    bubbleEl.hidden = true;
  }
}

function hidePanel() {
  if (panelEl) {
    panelEl.hidden = true;
  }
}

function hideOverlays() {
  hidePanel();
  hideBubble();
}

function openPanel() {
  if (!panelEl || !panelSelectionEl) {
    return;
  }

  panelSelectionEl.textContent = lastSelectedText;
  panelEl.hidden = false;
  hideBubble();

  if (panelQuestionInput instanceof HTMLTextAreaElement) {
    panelQuestionInput.value = "";
  }
  if (panelAnswerEl) {
    panelAnswerEl.textContent = "";
  }
  setSubmitBusy(false);
}

function requestModelAnswer() {
  if (!(panelQuestionInput instanceof HTMLTextAreaElement) || !panelAnswerEl) {
    return;
  }

  const q = panelQuestionInput.value.trim();
  if (!q) {
    panelAnswerEl.textContent = "Enter a question first.";
    return;
  }
  if (!lastSelectedText.trim()) {
    panelAnswerEl.textContent = "No selection text.";
    return;
  }

  panelAnswerEl.textContent = "Loading…";
  setSubmitBusy(true);

  chrome.runtime.sendMessage(
    {
      type: "ASK_LLM_CHAT",
      selection: lastSelectedText,
      question: q,
    },
    (response) => {
      setSubmitBusy(false);
      if (chrome.runtime.lastError) {
        panelAnswerEl.textContent = chrome.runtime.lastError.message;
        return;
      }
      if (response?.ok) {
        panelAnswerEl.textContent = response.text;
      } else {
        panelAnswerEl.textContent = `Error: ${response?.error ?? "Unknown"}`;
      }
    },
  );
}

function placeBubbleNearRange(range) {
  if (!bubbleEl) {
    return;
  }

  const rect = range.getBoundingClientRect();
  const margin = 8;
  bubbleEl.hidden = false;

  let left = rect.right + margin;
  let top = rect.top;

  bubbleEl.style.left = `${left}px`;
  bubbleEl.style.top = `${top}px`;

  const bb = bubbleEl.getBoundingClientRect();

  if (bb.right > window.innerWidth - margin) {
    left = rect.left - bb.width - margin;
    bubbleEl.style.left = `${Math.max(margin, left)}px`;
  }
  if (bb.bottom > window.innerHeight - margin) {
    top = window.innerHeight - bb.height - margin;
    bubbleEl.style.top = `${Math.max(margin, top)}px`;
  }
}

function onMouseUp() {
  if (!featureEnabled) {
    return;
  }

  ensureUi();

  const selection = window.getSelection();
  const text = selection ? selection.toString() : "";

  if (!text.trim() || !selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  if (range.collapsed) {
    return;
  }

  lastSelectedText = text;
  console.log("[ask-llm:m3] selection:", text);

  if (panelEl && !panelEl.hidden) {
    return;
  }

  placeBubbleNearRange(range);
}

function onMouseDownCapture(event) {
  if (!featureEnabled) {
    return;
  }

  ensureUi();
  const target = event.target;
  if (!(target instanceof Node)) {
    return;
  }
  if (bubbleEl?.contains(target) || panelEl?.contains(target)) {
    return;
  }
  hideOverlays();
}

function onKeyDown(event) {
  if (!featureEnabled) {
    return;
  }

  if (event.key === "Escape") {
    hideOverlays();
  }
}

document.addEventListener("mouseup", onMouseUp);

document.addEventListener("mousedown", onMouseDownCapture, true);

document.addEventListener("keydown", onKeyDown);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !(STORAGE_ENABLED_KEY in changes)) {
    return;
  }
  const next = changes[STORAGE_ENABLED_KEY].newValue !== false;
  featureEnabled = next;
  if (!featureEnabled) {
    hideOverlays();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ASK_LLM_REFRESH") {
    readEnabledFromStorage().then((enabled) => {
      if (!enabled) {
        hideOverlays();
      }
      sendResponse({ enabled });
    });
    return true;
  }
});

void readEnabledFromStorage().then((enabled) => {
  if (!enabled) {
    hideOverlays();
  }
});
