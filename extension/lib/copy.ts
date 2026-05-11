export function createCopyButton(getRawText: () => string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ask-llm-copy-btn";
  btn.textContent = "Copy";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const text = getRawText();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = "Copied!";
      btn.classList.add("ask-llm-copy-btn--copied");
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("ask-llm-copy-btn--copied");
      }, 1500);
    });
  });
  return btn;
}
