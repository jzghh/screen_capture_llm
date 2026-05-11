import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserContent } from "../prompts";

describe("buildSystemPrompt", () => {
  it("returns a non-empty string", () => {
    const prompt = buildSystemPrompt();
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("mentions page_selection delimiters", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("page_selection");
  });
});

describe("buildUserContent", () => {
  it("includes both question and selection", () => {
    const result = buildUserContent("selected text here", "What is this?");
    expect(result).toContain("What is this?");
    expect(result).toContain("selected text here");
  });

  it("wraps selection in page_selection tags", () => {
    const result = buildUserContent("test content", "Summarize");
    expect(result).toContain("<page_selection>");
    expect(result).toContain("</page_selection>");
  });

  it("truncates selection at MAX_SELECTION_CHARS", () => {
    const longSelection = "a".repeat(300_000);
    const result = buildUserContent(longSelection, "Summarize");
    expect(result).not.toContain("a".repeat(300_000));
    expect(result.length).toBeLessThan(300_000);
  });
});
