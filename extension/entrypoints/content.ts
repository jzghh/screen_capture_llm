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
    // ─── Types ─────────────────────────────────────────────────────────

    interface Turn {
      id: string;
      question: string;
      answer: string;
    }

    // ─── State ─────────────────────────────────────────────────────────

    let bubbleEl: HTMLButtonElement | null = null;
    let panelEl: HTMLDivElement | null = null;
    let questionInput: HTMLTextAreaElement | null = null;
    let answerEl: HTMLElement | null = null;
    let selectionEl: HTMLElement | null = null;
    let submitBtn: HTMLButtonElement | null = null;
    let stopBtn: HTMLButtonElement | null = null;
    let historyToggleEl: HTMLButtonElement | null = null;
    let historyRegionEl: HTMLDivElement | null = null;

    let lastSelectedText = "";
    let lastSelectionRange: Range | null = null;
    let featureEnabled = true;
    let conversationHistory: ChatMessage[] = [];
    let streamPort: chrome.runtime.Port | null = null;
    let chunkBuffer = "";
    let rafPending = false;

    let turns: Turn[] = [];
    let currentTurn: Turn | null = null;
    let isHistoryExpanded = false;
    const expandedTurnIds = new Set<string>();
    let clearConfirmTimer: ReturnType<typeof setTimeout> | null = null;
    let clearConfirmActive = false;

    let turnIdCounter = 0;
    function nextTurnId(): string {
      return `turn-${++turnIdCounter}`;
    }

    // ─── Storage ───────────────────────────────────────────────────────

    async function readEnabledFromStorage(): Promise<boolean> {
      const data = await chrome.storage.local.get(STORAGE_KEYS.enabled);
      featureEnabled = data[STORAGE_KEYS.enabled] !== false;
      return featureEnabled;
    }

    // ─── Markdown rendering ────────────────────────────────────────────

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

    // ─── Positioning ───────────────────────────────────────────────────

    function computePanelPosition(
      selRect: DOMRect,
      panelSize: { width: number; height: number },
      viewport = { w: window.innerWidth, h: window.innerHeight },
    ): { top: number; left: number } {
      const M = 12;
      const { w: vw, h: vh } = viewport;
      const { width: pw, height: ph } = panelSize;

      let top = selRect.bottom + M;
      if (top + ph > vh - M) {
        const above = selRect.top - ph - M;
        top = above >= M ? above : Math.max(M, (vh - ph) / 2);
      }

      const left = Math.min(Math.max(M, selRect.left), vw - pw - M);
      return { top, left };
    }

    // ─── UI building ───────────────────────────────────────────────────

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
        '  <button type="button" class="ask-llm-panel__close" aria-label="Close">\u2715</button>',
        "</div>",
        '<button type="button" class="ask-llm-history-toggle" hidden></button>',
        '<div class="ask-llm-history-region" hidden></div>',
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
      submitBtn = panelEl.querySelector<HTMLButtonElement>(".ask-llm-panel__submit");
      stopBtn = panelEl.querySelector<HTMLButtonElement>(".ask-llm-panel__stop");
      questionInput = panelEl.querySelector<HTMLTextAreaElement>("#ask-llm-q");
      answerEl = panelEl.querySelector<HTMLElement>(".ask-llm-panel__answer");
      selectionEl = panelEl.querySelector<HTMLElement>(".ask-llm-panel__selection");
      historyToggleEl = panelEl.querySelector<HTMLButtonElement>(".ask-llm-history-toggle");
      historyRegionEl = panelEl.querySelector<HTMLDivElement>(".ask-llm-history-region");

      closeBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        closePanel();
      });
      historyToggleEl?.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleHistory();
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

    // ─── History ───────────────────────────────────────────────────────

    function toggleHistory(): void {
      isHistoryExpanded = !isHistoryExpanded;
      renderHistoryToggle();
      renderHistoryRegion();
    }

    function renderHistoryToggle(): void {
      if (!historyToggleEl) return;
      const n = turns.length;
      if (n === 0) {
        historyToggleEl.hidden = true;
        return;
      }
      historyToggleEl.hidden = false;
      const arrow = isHistoryExpanded ? "\u25BC" : "\u25B8";
      historyToggleEl.textContent = `${arrow} History (${n})`;
    }

    function renderHistoryRegion(): void {
      if (!historyRegionEl) return;
      if (!isHistoryExpanded || turns.length === 0) {
        historyRegionEl.hidden = true;
        return;
      }
      historyRegionEl.hidden = false;
      historyRegionEl.innerHTML = "";

      for (const turn of turns) {
        const turnEl = document.createElement("div");
        turnEl.className = "ask-llm-history-turn";
        const isExpanded = expandedTurnIds.has(turn.id);
        if (isExpanded) turnEl.classList.add("ask-llm-history-turn--expanded");

        const questionHeader = document.createElement("div");
        questionHeader.className = "ask-llm-history-turn__question";
        questionHeader.textContent = turn.question;
        questionHeader.addEventListener("click", (e) => {
          e.stopPropagation();
          if (expandedTurnIds.has(turn.id)) {
            expandedTurnIds.delete(turn.id);
          } else {
            expandedTurnIds.add(turn.id);
          }
          renderHistoryRegion();
        });
        turnEl.appendChild(questionHeader);

        if (isExpanded && turn.answer) {
          const answerBody = document.createElement("div");
          answerBody.className = "ask-llm-history-turn__answer";
          answerBody.appendChild(renderMarkdown(turn.answer));
          turnEl.appendChild(answerBody);
        }

        historyRegionEl.appendChild(turnEl);
      }

      const clearRow = document.createElement("div");
      clearRow.className = "ask-llm-history-clear-row";
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "ask-llm-history-clear";
      clearBtn.textContent = clearConfirmActive ? "Confirm clear?" : "Clear";
      if (clearConfirmActive) clearBtn.classList.add("ask-llm-history-clear--confirm");
      clearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleClearClick();
      });
      clearRow.appendChild(clearBtn);
      historyRegionEl.appendChild(clearRow);
    }

    function handleClearClick(): void {
      if (clearConfirmActive) {
        clearConfirmActive = false;
        if (clearConfirmTimer !== null) {
          clearTimeout(clearConfirmTimer);
          clearConfirmTimer = null;
        }
        clearHistory();
        return;
      }

      clearConfirmActive = true;
      renderHistoryRegion();
      clearConfirmTimer = setTimeout(() => {
        clearConfirmTimer = null;
        clearConfirmActive = false;
        renderHistoryRegion();
      }, 2000);
    }

    function clearHistory(): void {
      turns.length = 0;
      expandedTurnIds.clear();

      if (currentTurn) {
        const keepCount = currentTurn.answer ? 2 : 1;
        conversationHistory = conversationHistory.slice(-keepCount);
      } else {
        conversationHistory = [];
      }

      isHistoryExpanded = false;
      renderHistoryToggle();
      renderHistoryRegion();
    }

    // ─── Panel state ───────────────────────────────────────────────────

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

      isHistoryExpanded = false;
      renderHistoryToggle();
      renderHistoryRegion();

      if (answerEl) {
        delete answerEl.dataset.rawMd;
        if (currentTurn?.answer) {
          answerEl.innerHTML = "";
          answerEl.appendChild(renderMarkdown(currentTurn.answer));
        } else {
          answerEl.textContent = "";
        }
      }

      if (questionInput) questionInput.value = "";
      setBusy(false);
      hideBubble();

      // Show panel invisibly to measure its size, then position it
      panelEl.hidden = false;
      panelEl.style.visibility = "hidden";

      if (window.innerWidth < 480) {
        panelEl.style.maxWidth = `${window.innerWidth - 24}px`;
      } else {
        panelEl.style.maxWidth = "";
      }

      const panelRect = panelEl.getBoundingClientRect();
      const panelSize = { width: panelRect.width, height: panelRect.height };
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let pos: { top: number; left: number };
      if (lastSelectionRange) {
        const selRect = lastSelectionRange.getBoundingClientRect();
        if (selRect.width > 0 || selRect.height > 0) {
          pos = computePanelPosition(selRect, panelSize);
        } else {
          pos = {
            top: Math.max(12, (vh - panelSize.height) / 2),
            left: Math.max(12, (vw - panelSize.width) / 2),
          };
        }
      } else {
        pos = {
          top: Math.max(12, (vh - panelSize.height) / 2),
          left: Math.max(12, (vw - panelSize.width) / 2),
        };
      }

      panelEl.style.top = `${pos.top}px`;
      panelEl.style.left = `${pos.left}px`;
      panelEl.style.visibility = "";
    }

    function setBusy(busy: boolean): void {
      if (submitBtn) {
        submitBtn.disabled = busy;
        submitBtn.textContent = busy ? "Asking\u2026" : "Ask";
      }
      if (stopBtn) stopBtn.hidden = !busy;
    }

    // ─── Streaming ─────────────────────────────────────────────────────

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
        if (currentTurn) currentTurn.answer = rawAnswer;
      }
      if (answerEl) {
        delete answerEl.dataset.rawMd;
        if (rawAnswer.trim()) {
          const rendered = renderMarkdown(rawAnswer);
          answerEl.innerHTML = "";
          answerEl.appendChild(rendered);
        } else {
          answerEl.textContent = "";
        }
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

    // ─── Submit ────────────────────────────────────────────────────────

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

      if (currentTurn) {
        turns.push(currentTurn);
        renderHistoryToggle();
        if (isHistoryExpanded) renderHistoryRegion();
      }

      currentTurn = { id: nextTurnId(), question, answer: "" };

      const userContent = [
        question,
        "",
        "<page_selection>",
        lastSelectedText.slice(0, MAX_SELECTION_CHARS),
        "</page_selection>",
      ].join("\n");
      conversationHistory.push({ role: "user", content: userContent });

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

    // ─── Selection detection ───────────────────────────────────────────

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
      lastSelectionRange = range.cloneRange();
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
