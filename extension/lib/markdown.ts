let markdownDeps: {
  marked: typeof import("marked").marked;
  DOMPurify: typeof import("dompurify").default;
  hljs: typeof import("highlight.js").default;
} | null = null;

export async function loadMarkdownDeps() {
  if (markdownDeps) return markdownDeps;
  const [{ marked }, DOMPurifyMod, hljsMod] = await Promise.all([
    import("marked"),
    import("dompurify"),
    import("highlight.js"),
  ]);
  await import("highlight.js/styles/github.css");
  markdownDeps = { marked, DOMPurify: DOMPurifyMod.default, hljs: hljsMod.default };
  return markdownDeps;
}

export function renderMarkdown(raw: string): HTMLElement {
  if (!markdownDeps) {
    const el = document.createElement("div");
    el.textContent = raw;
    return el;
  }
  const { marked, DOMPurify, hljs } = markdownDeps;
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
