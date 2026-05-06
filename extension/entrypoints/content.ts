import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";
import "@/assets/content.css";
import { STORAGE_KEYS, PORT_NAME, MAX_SELECTION_CHARS } from "@/utils/types";
import type { ChatMessage, StreamPortMessage } from "@/utils/types";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_idle",
  cssInjectionMode: "manifest",

  main() {
    // ─── State ────────────────────────────────────────────────────────────

    let bubbleEl: HTMLButtonElement | null = null;
    let panelEl: HTMLDivElement | null = null;
    let questionInput: HTMLTextAreaElement | null = null;
    let answerEl: HTMLElement | null = null;
    let selectionEl: HTMLElement | null = null;
    let submitBtn: HTMLButtonElement | null = null;
    let stopBtn: HTMLButtonElement | null = null;
    let historyEl: HTMLElement | null = null;

    let lastSelectedText = "";
    let featureEnabled = true;
    let conversationHistory: ChatMessage[] = [];
    let streamPort: chrome.runtime.Port | null = null;
    let chunkBuffer = "";
    let rafPending = false;

    // ─── Storage ──────────────────────────────────────────────────────────

    async function readEnabledFromStorage(): Promise<boolean> {
      const data = await chrome.storage.local.get(STORAGE_KEYS.enabled);
      featureEnabled = data[STORAGE_KEYS.enabled] !== false;
      return featureEnabled;
    }

    // ─── Markdown rendering ───────────────────────────────────────────────

    function renderMarkdown(raw: string): HTMLElement {
      const html = DOMPurify.sanitize(marked.parse(raw, { gfm: true, breaks: true }) as string, {
        USE_PROFILES: { html: true },
      });
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html;

      wrapper.querySelectorAll<HTMLElement>("pre code").forEach((block) => {
        hljs.highlightElement(block);
      });
      return wrapper;
    }

    // ─── UI building ──────────────────────────────────────────────────────

    function ensureUi(): void {
      if (bubbleEl && panelEl) return;

      bubbleEl = document.createElement("button");
      bubbleEl.type = "button";
      bubbleEl.className = "ask-llm-bubble";
      bubbleEl.setAttribute("aria-label", "Ask about selection");
      bubbleEl.textContent = "\u{1F4AC}";
      bubbleEl.hidden = true;
      bubbleEl.addEventListener("click", (e) => {
        e.stopPropagation();
        openPanel();
      });

      panelEl = document.createElement("div");
      panelEl.className = "ask-llm-panel";
      panelEl.hidden = true;
      panelEl.innerHTML = [
        '<div class="ask-llm-panel__header">',
        '  <span class="ask-llm-panel__title">Ask LLM</span>',
        '  <div class="ask-llm-panel__header-actions">',
        '    <button type="button" class="ask-llm-panel__clear" title="Clear conversation">\u21BA</button>',
        '    <button type="button" class="ask-llm-panel__close" aria-label="Close">\u2715</button>',
        "  </div>",
        "</div>",
        '<div class="ask-llm-panel__history" aria-live="polite"></div>',
        '<div class="ask-llm-panel__body">',
        '  <div class="ask-llm-panel__selection-wrap">',
        '    <p class="ask-llm-panel__label">Selected text</p>',
        '    <div class="ask-llm-panel__selection"></div>',
        "  </div>",
        '  <label class="ask-llm-panel__label" for="ask-llm-q">Your question</label>',
        '  <textarea id="ask-llm-q" class="ask-llm-panel__input" rows="3"',
        '    placeholder="e.g. Summarize this in one sentence"></textarea>',
        '  <div class="ask-llm-panel__row">',
        '    <button type="button" class="ask-llm-panel__submit">Ask</button>',
        '    <button type="button" class="ask-llm-panel__stop" hidden>Stop</button>',
        "  </div>",
        '  <div class="ask-llm-panel__answer" aria-live="polite"></div>',
        "</div>",
      ].join("");

      const closeBtn = panelEl.querySelector<HTMLButtonElement>(".ask-llm-panel__close");
      const clearBtn = panelEl.querySelector<HTMLButtonElement>(".ask-llm-panel__clear");
      submitBtn = panelEl.querySelector<HTMLButtonElement>(".ask-llm-panel__submit");
      stopBtn = panelEl.querySelector<HTMLButtonElement>(".ask-llm-panel__stop");
      questionInput = panelEl.querySelector<HTMLTextAreaElement>("#ask-llm-q");
      answerEl = panelEl.querySelector<HTMLElement>(".ask-llm-panel__answer");
      selectionEl = panelEl.querySelector<HTMLElement>(".ask-llm-panel__selection");
      historyEl = panelEl.querySelector<HTMLElement>(".ask-llm-panel__history");

      closeBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        closePanel();
      });
      clearBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        clearConversation();
      });
      submitBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        submitQuestion();
      });
      stopBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        abortStream();
      });
      panelEl.addEventListener("click", (e) => e.stopPropagation());

      questionInput?.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          submitQuestion();
        }
      });

      document.body.append(bubbleEl, panelEl);
    }

    // ─── Panel state ──────────────────────────────────────────────────────

    function hideBubble(): void {
      if (bubbleEl) bubbleEl.hidden = true;
    }
    function hidePanel(): void {
      if (panelEl) panelEl.hidden = true;
    }
    function hideOverlays(): void {
      hidePanel();
      hideBubble();
    }

    function closePanel(): void {
      abortStream();
      hidePanel();
      hideBubble();
    }

    function openPanel(): void {
      if (!panelEl || !selectionEl) return;
      selectionEl.textContent =
        lastSelectedText.slice(0, 500) + (lastSelectedText.length > 500 ? "\u2026" : "");
      panelEl.hidden = false;
      hideBubble();
      if (questionInput) questionInput.value = "";
      if (answerEl) answerEl.textContent = "";
      setBusy(false);
    }

    function clearConversation(): void {
      conversationHistory = [];
      if (historyEl) historyEl.innerHTML = "";
      if (answerEl) answerEl.textContent = "";
    }

    function setBusy(busy: boolean): void {
      if (submitBtn) {
        submitBtn.disabled = busy;
        submitBtn.textContent = busy ? "Asking\u2026" : "Ask";
      }
      if (stopBtn) stopBtn.hidden = !busy;
    }

    // ─── Streaming ────────────────────────────────────────────────────────

    function abortStream(): void {
      if (streamPort) {
        try {
          streamPort.disconnect();
        } catch {
          /* already closed */
        }
        streamPort = null;
      }
      setBusy(false);
    }

    function scheduleFlush(): void {
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
        answerEl.appendChild(rendered);
        answerEl.scrollTop = answerEl.scrollHeight;
      });
    }

    function onStreamChunk(text: string): void {
      chunkBuffer += text;
      scheduleFlush();
    }

    function onStreamDone(rawAnswer: string): void {
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

    function onStreamError(errorMsg: string): void {
      if (answerEl) {
        answerEl.textContent = `Error: ${errorMsg}`;
        delete answerEl.dataset.rawMd;
      }
      streamPort = null;
      setBusy(false);
    }

    function appendToHistory(role: "user" | "assistant", rawMd: string): void {
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
        body.appendChild(renderMarkdown(rawMd));
      } else {
        body.textContent = rawMd;
      }
      turn.appendChild(body);
      historyEl.appendChild(turn);
      historyEl.scrollTop = historyEl.scrollHeight;
    }

    function submitQuestion(): void {
      if (!questionInput || !answerEl) return;
      const question = questionInput.value.trim();
      if (!question) {
        answerEl.textContent = "Please enter a question.";
        return;
      }
      if (!lastSelectedText.trim()) {
        answerEl.textContent = "No selection text.";
        return;
      }
      if (streamPort) return;

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

      streamPort = chrome.runtime.connect(chrome.runtime.id, { name: PORT_NAME });
      let rawAnswer = "";

      streamPort.onMessage.addListener((msg: StreamPortMessage) => {
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
        if (streamPort) {
          setBusy(false);
          streamPort = null;
        }
      });

      streamPort.postMessage({
        type: "STREAM_START",
        question,
        selection: lastSelectedText,
        messages: conversationHistory.slice(0, -1),
      });
    }

    // ─── Selection detection ──────────────────────────────────────────────

    function placeBubble(range: Range): void {
      if (!bubbleEl) return;
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

    function onMouseUp(): void {
      if (!featureEnabled) return;
      ensureUi();
      const sel = window.getSelection();
      const text = sel ? sel.toString() : "";
      if (!text.trim() || !sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (range.collapsed) return;
      lastSelectedText = text;
      if (panelEl && !panelEl.hidden) return;
      placeBubble(range);
    }

    function onMouseDownCapture(event: MouseEvent): void {
      if (!featureEnabled) return;
      ensureUi();
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (bubbleEl?.contains(target) || panelEl?.contains(target)) return;
      hideOverlays();
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (!featureEnabled) return;
      if (event.key === "Escape") closePanel();
    }

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousedown", onMouseDownCapture, true);
    document.addEventListener("keydown", onKeyDown);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !(STORAGE_KEYS.enabled in changes)) return;
      featureEnabled = changes[STORAGE_KEYS.enabled].newValue !== false;
      if (!featureEnabled) hideOverlays();
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "ASK_LLM_REFRESH") {
        readEnabledFromStorage().then((en) => {
          if (!en) hideOverlays();
          sendResponse({ enabled: en });
        });
        return true;
      }
    });

    void readEnabledFromStorage();
  },
});
