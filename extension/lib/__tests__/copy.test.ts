// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createCopyButton } from "../copy";

describe("createCopyButton", () => {
  it("creates a button element with correct class and text", () => {
    const btn = createCopyButton(() => "test");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.type).toBe("button");
    expect(btn.className).toBe("ask-llm-copy-btn");
    expect(btn.textContent).toBe("Copy");
  });

  it("has aria-label for accessibility", () => {
    const btn = createCopyButton(() => "test");
    expect(btn.getAttribute("aria-label")).toBe("Copy answer");
  });

  it("copies text to clipboard on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    const btn = createCopyButton(() => "copied text");
    btn.click();

    expect(writeText).toHaveBeenCalledWith("copied text");
  });

  it("does nothing when getRawText returns empty string", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    const btn = createCopyButton(() => "");
    btn.click();

    expect(writeText).not.toHaveBeenCalled();
  });
});
