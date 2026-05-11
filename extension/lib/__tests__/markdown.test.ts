// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../markdown";

describe("renderMarkdown fallback (deps not loaded)", () => {
  it("returns a div with raw text when markdown deps are not loaded", () => {
    const el = renderMarkdown("Hello **world**");
    expect(el.tagName).toBe("DIV");
    expect(el.textContent).toBe("Hello **world**");
  });

  it("handles empty string", () => {
    const el = renderMarkdown("");
    expect(el.tagName).toBe("DIV");
    expect(el.textContent).toBe("");
  });

  it("preserves special characters in fallback", () => {
    const input = '<script>alert("xss")</script>';
    const el = renderMarkdown(input);
    expect(el.textContent).toBe(input);
    expect(el.innerHTML).not.toContain("<script>");
  });
});
