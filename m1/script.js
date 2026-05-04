console.log("[m1-demo] script loaded");

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

let lastSelectedText = "";

function ensureUi() {
  if (bubbleEl && panelEl) {
    return;
  }

  bubbleEl = document.createElement("button");
  bubbleEl.type = "button";
  bubbleEl.className = "m1-bubble";
  bubbleEl.setAttribute("aria-label", "Ask about selection");
  bubbleEl.textContent = "💬";
  bubbleEl.hidden = true;

  bubbleEl.addEventListener("click", (event) => {
    event.stopPropagation();
    openPanel();
  });

  panelEl = document.createElement("div");
  panelEl.className = "m1-panel";
  panelEl.hidden = true;
  panelEl.innerHTML = [
    '<div class="m1-panel__header">',
    '  <span class="m1-panel__title">Ask LLM (demo)</span>',
    '  <button type="button" class="m1-panel__close" aria-label="Close panel">✕</button>',
    "</div>",
    '<div class="m1-panel__body">',
    '  <p class="m1-panel__label">Selected text</p>',
    '  <div class="m1-panel__selection"></div>',
    '  <label class="m1-panel__label" for="m1-question">Your question</label>',
    '  <textarea id="m1-question" class="m1-panel__input" rows="3" ',
    '    placeholder="e.g. Summarize this in one sentence"></textarea>',
    '  <button type="button" class="m1-panel__submit">Ask (fake)</button>',
    '  <p class="m1-panel__label">Answer (placeholder)</p>',
    '  <div class="m1-panel__answer" aria-live="polite"></div>',
    "</div>",
  ].join("");

  /** @type {HTMLButtonElement | null} */
  const closeBtn = panelEl.querySelector(".m1-panel__close");
  /** @type {HTMLButtonElement | null} */
  const submitBtn = panelEl.querySelector(".m1-panel__submit");
  panelQuestionInput = panelEl.querySelector("#m1-question");
  panelAnswerEl = panelEl.querySelector(".m1-panel__answer");
  panelSelectionEl = panelEl.querySelector(".m1-panel__selection");

  closeBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    hidePanel();
    hideBubble();
  });

  submitBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    showFakeAnswer();
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
}

function showFakeAnswer() {
  if (!(panelQuestionInput instanceof HTMLTextAreaElement) || !panelAnswerEl) {
    return;
  }

  const q = panelQuestionInput.value.trim();
  const questionPart = q ? `关于「${q}」` : "（你还没有输入具体问题）";
  panelAnswerEl.textContent =
    `[假回答] ${questionPart} — 针对选区：「${lastSelectedText.slice(0, 80)}${
      lastSelectedText.length > 80 ? "…" : ""
    }」。M3 起再接真实 API。`;
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

document.addEventListener("mouseup", () => {
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
  console.log("[m1-demo] selection:", text);

  if (panelEl && !panelEl.hidden) {
    return;
  }

  placeBubbleNearRange(range);
});

document.addEventListener(
  "mousedown",
  (event) => {
    ensureUi();
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (bubbleEl?.contains(target) || panelEl?.contains(target)) {
      return;
    }
    hideOverlays();
  },
  true,
);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideOverlays();
  }
});
