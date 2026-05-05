"use strict";

// vendor globals injected before this script: marked, DOMPurify, hljs

const STORAGE_ENABLED_KEY = "askLlmEnabled";
const PORT_NAME = "ask-llm-stream";
const MAX_SELECTION_CHARS = 200_000;

console.log("[ask-llm:m4] content script loaded");

// ─── State ────────────────────────────────────────────────────────────────────

/** @type {HTMLButtonElement | null} */ let bubbleEl = null;
/** @type {HTMLDivElement    | null} */ let panelEl  = null;
/** @type {HTMLTextAreaElement|null} */ let questionInput = null;
/** @type {HTMLElement       | null} */ let answerEl = null;
/** @type {HTMLElement       | null} */ let selectionEl = null;
/** @type {HTMLButtonElement | null} */ let submitBtn = null;
/** @type {HTMLButtonElement | null} */ let stopBtn   = null;
/** @type {HTMLElement       | null} */ let historyEl = null;

let lastSelectedText = "";
let featureEnabled = true;

/**
 * Multi-turn conversation history.
 * Each entry: { role: "user" | "assistant", content: string }
 * @type {Array<{ role: string, content: string }>}
 */
let conversationHistory = [];

/** @type {chrome.runtime.Port | null} */
let streamPort = null;

/** Buffered chunks waiting to be flushed via rAF */
let chunkBuffer = "";
let rafPending = false;

// ─── Storage ──────────────────────────────────────────────────────────────────

async function readEnabledFromStorage() {
  const data = await chrome.storage.local.get(STORAGE_ENABLED_KEY);
  featureEnabled = data[STORAGE_ENABLED_KEY] !== false;
  return featureEnabled;
}

// ─── Markdown rendering ───────────────────────────────────────────────────────

/** @type {any} */
const _marked = typeof marked !== "undefined" ? marked : null;
/** @type {any} */
const _DOMPurify = typeof DOMPurify !== "undefined" ? DOMPurify : null;
/** @type {any} */
const _hljs = typeof hljs !== "undefined" ? hljs : null;

function renderMarkdown(raw) {
  if (!_marked || !_DOMPurify) {
    return document.createTextNode(raw);
  }
  const html = _DOMPurify.sanitize(
    _marked.parse(raw, { gfm: true, breaks: true }),
    { USE_PROFILES: { html: true } },
  );
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;

  if (_hljs) {
    wrapper.querySelectorAll("pre code").forEach((block) => {
      _hljs.highlightElement(block);
    });
  }
  return wrapper;
}

// ─── UI building ──────────────────────────────────────────────────────────────

function ensureUi() {
  if (bubbleEl && panelEl) return;

  // Bubble
  bubbleEl = document.createElement("button");
  bubbleEl.type = "button";
  bubbleEl.className = "ask-llm-bubble";
  bubbleEl.setAttribute("aria-label", "Ask about selection");
  bubbleEl.textContent = "💬";
  bubbleEl.hidden = true;
  bubbleEl.addEventListener("click", (e) => { e.stopPropagation(); openPanel(); });

  // Panel
  panelEl = document.createElement("div");
  panelEl.className = "ask-llm-panel";
  panelEl.hidden = true;
  panelEl.innerHTML = [
    '<div class="ask-llm-panel__header">',
    '  <span class="ask-llm-panel__title">Ask LLM (M4)</span>',
    '  <div class="ask-llm-panel__header-actions">',
    '    <button type="button" class="ask-llm-panel__clear"  title="Clear conversation">↺</button>',
    '    <button type="button" class="ask-llm-panel__close"  aria-label="Close">✕</button>',
    '  </div>',
    "</div>",
    '<div class="ask-llm-panel__history" aria-live="polite"></div>',
    '<div class="ask-llm-panel__body">',
    '  <div class="ask-llm-panel__selection-wrap">',
    '    <p class="ask-llm-panel__label">Selected text</p>',
    '    <div class="ask-llm-panel__selection"></div>',
    '  </div>',
    '  <label class="ask-llm-panel__label" for="ask-llm-q4">Your question</label>',
    '  <textarea id="ask-llm-q4" class="ask-llm-panel__input" rows="3"',
    '    placeholder="e.g. Summarize this in one sentence"></textarea>',
    '  <div class="ask-llm-panel__row">',
    '    <button type="button" class="ask-llm-panel__submit">Ask</button>',
    '    <button type="button" class="ask-llm-panel__stop" hidden>Stop</button>',
    '  </div>',
    '  <div class="ask-llm-panel__answer" aria-live="polite"></div>',
    "</div>",
  ].join("");

  // Wire up elements
  const closeBtn = panelEl.querySelector(".ask-llm-panel__close");
  const clearBtn = panelEl.querySelector(".ask-llm-panel__clear");
  submitBtn   = panelEl.querySelector(".ask-llm-panel__submit");
  stopBtn     = panelEl.querySelector(".ask-llm-panel__stop");
  questionInput = panelEl.querySelector("#ask-llm-q4");
  answerEl    = panelEl.querySelector(".ask-llm-panel__answer");
  selectionEl = panelEl.querySelector(".ask-llm-panel__selection");
  historyEl   = panelEl.querySelector(".ask-llm-panel__history");

  closeBtn?.addEventListener("click", (e) => { e.stopPropagation(); closePanel(); });
  clearBtn?.addEventListener("click", (e) => { e.stopPropagation(); clearConversation(); });
  submitBtn?.addEventListener("click", (e) => { e.stopPropagation(); submitQuestion(); });
  stopBtn?.addEventListener("click",   (e) => { e.stopPropagation(); abortStream(); });
  panelEl.addEventListener("click", (e) => e.stopPropagation());

  // Submit on Ctrl/Cmd+Enter
  questionInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submitQuestion();
    }
  });

  document.body.append(bubbleEl, panelEl);
}

// ─── Panel state ──────────────────────────────────────────────────────────────

function hideBubble()  { if (bubbleEl)  bubbleEl.hidden = true;  }
function hidePanel()   { if (panelEl)   panelEl.hidden  = true;  }
function hideOverlays(){ hidePanel(); hideBubble(); }

function closePanel() {
  abortStream();
  hidePanel();
  hideBubble();
}

function openPanel() {
  if (!panelEl || !selectionEl) return;
  selectionEl.textContent = lastSelectedText.slice(0, 500) +
    (lastSelectedText.length > 500 ? "…" : "");
  panelEl.hidden = false;
  hideBubble();
  if (questionInput instanceof HTMLTextAreaElement) questionInput.value = "";
  if (answerEl) answerEl.textContent = "";
  setBusy(false);
}

function clearConversation() {
  conversationHistory = [];
  if (historyEl) historyEl.innerHTML = "";
  if (answerEl)  answerEl.textContent = "";
}

function setBusy(busy) {
  if (submitBtn) { submitBtn.disabled = busy; submitBtn.textContent = busy ? "Asking…" : "Ask"; }
  if (stopBtn)   stopBtn.hidden = !busy;
}

// ─── Streaming ────────────────────────────────────────────────────────────────

function abortStream() {
  if (streamPort) {
    try { streamPort.disconnect(); } catch { /* already closed */ }
    streamPort = null;
  }
  setBusy(false);
}

/** Flush chunkBuffer to the answer element via rAF */
function scheduleFlush() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    if (!answerEl) return;
    const current = answerEl.dataset.rawMd ?? "";
    const updated = current + chunkBuffer;
    chunkBuffer = "";
    answerEl.dataset.rawMd = updated;
    const rendered = renderMarkdown(updated);
    answerEl.innerHTML = "";
    if (rendered instanceof Node) {
      answerEl.appendChild(rendered);
    } else {
      answerEl.textContent = updated;
    }
    answerEl.scrollTop = answerEl.scrollHeight;
  });
}

function onStreamChunk(text) {
  chunkBuffer += text;
  scheduleFlush();
}

function onStreamDone(rawAnswer) {
  // Save to conversation history
  if (rawAnswer.trim()) {
    conversationHistory.push({ role: "assistant", content: rawAnswer });
    appendToHistory("assistant", rawAnswer);
  }
  if (answerEl) {
    delete answerEl.dataset.rawMd;
    answerEl.textContent = "";
  }
  streamPort = null;
  setBusy(false);
}

function onStreamError(errorMsg) {
  if (answerEl) {
    answerEl.textContent = `Error: ${errorMsg}`;
    delete answerEl.dataset.rawMd;
  }
  streamPort = null;
  setBusy(false);
}

/** Append a finished turn to the history panel. */
function appendToHistory(role, rawMd) {
  if (!historyEl) return;
  const turn = document.createElement("div");
  turn.className = `ask-llm-turn ask-llm-turn--${role}`;

  const label = document.createElement("div");
  label.className = "ask-llm-turn__label";
  label.textContent = role === "user" ? "You" : "Assistant";
  turn.appendChild(label);

  const body = document.createElement("div");
  body.className = "ask-llm-turn__body";
  if (role === "assistant") {
    const rendered = renderMarkdown(rawMd);
    if (rendered instanceof Node) body.appendChild(rendered);
    else body.textContent = rawMd;
  } else {
    body.textContent = rawMd;
  }
  turn.appendChild(body);
  historyEl.appendChild(turn);
  historyEl.scrollTop = historyEl.scrollHeight;
}

function submitQuestion() {
  if (!(questionInput instanceof HTMLTextAreaElement) || !answerEl) return;
  const question = questionInput.value.trim();
  if (!question) { answerEl.textContent = "Please enter a question."; return; }
  if (!lastSelectedText.trim()) { answerEl.textContent = "No selection text."; return; }
  if (streamPort) return; // already streaming

  // Add user turn to history
  const userContent = [
    question,
    "",
    "<page_selection>",
    lastSelectedText.slice(0, MAX_SELECTION_CHARS),
    "</page_selection>",
  ].join("\n");
  conversationHistory.push({ role: "user", content: userContent });
  appendToHistory("user", question);

  questionInput.value = "";
  answerEl.textContent = "";
  answerEl.dataset.rawMd = "";
  setBusy(true);

  // Open port & start stream
  streamPort = chrome.runtime.connect({ name: PORT_NAME });
  let rawAnswer = "";

  streamPort.onMessage.addListener((msg) => {
    if (msg.type === "CHUNK") {
      rawAnswer += msg.text;
      onStreamChunk(msg.text);
    } else if (msg.type === "DONE") {
      onStreamDone(rawAnswer);
    } else if (msg.type === "ERROR") {
      onStreamError(msg.error);
    }
  });

  streamPort.onDisconnect.addListener(() => {
    if (streamPort) { setBusy(false); streamPort = null; }
  });

  streamPort.postMessage({
    type: "STREAM_START",
    question,
    selection: lastSelectedText,
    messages: conversationHistory.slice(0, -1), // history without the just-added user turn
  });
}

// ─── Selection detection ──────────────────────────────────────────────────────

function placeBubble(range) {
  if (!bubbleEl) return;
  const rect   = range.getBoundingClientRect();
  const margin = 8;
  bubbleEl.hidden = false;

  let left = rect.right + margin;
  let top  = rect.top;
  bubbleEl.style.left = `${left}px`;
  bubbleEl.style.top  = `${top}px`;

  const bb = bubbleEl.getBoundingClientRect();
  if (bb.right  > window.innerWidth  - margin) { left = rect.left - bb.width - margin; bubbleEl.style.left = `${Math.max(margin, left)}px`; }
  if (bb.bottom > window.innerHeight - margin) { top  = window.innerHeight - bb.height - margin; bubbleEl.style.top  = `${Math.max(margin, top)}px`; }
}

function onMouseUp() {
  if (!featureEnabled) return;
  ensureUi();
  const sel  = window.getSelection();
  const text = sel ? sel.toString() : "";
  if (!text.trim() || !sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  lastSelectedText = text;
  if (panelEl && !panelEl.hidden) return;
  placeBubble(range);
}

function onMouseDownCapture(event) {
  if (!featureEnabled) return;
  ensureUi();
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (bubbleEl?.contains(target) || panelEl?.contains(target)) return;
  hideOverlays();
}

function onKeyDown(event) {
  if (!featureEnabled) return;
  if (event.key === "Escape") { closePanel(); }
}

document.addEventListener("mouseup",    onMouseUp);
document.addEventListener("mousedown",  onMouseDownCapture, true);
document.addEventListener("keydown",    onKeyDown);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(STORAGE_ENABLED_KEY in changes)) return;
  featureEnabled = changes[STORAGE_ENABLED_KEY].newValue !== false;
  if (!featureEnabled) hideOverlays();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ASK_LLM_REFRESH") {
    readEnabledFromStorage().then((en) => { if (!en) hideOverlays(); sendResponse({ enabled: en }); });
    return true;
  }
});

void readEnabledFromStorage();
