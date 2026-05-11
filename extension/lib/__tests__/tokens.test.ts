import { describe, it, expect } from "vitest";
import { estimateTokens } from "../tokens";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates ~1 token per 4 chars for English", () => {
    const text = "Hello world test string";
    const tokens = estimateTokens(text);
    expect(tokens).toBe(Math.ceil(text.length / 4));
  });

  it("estimates higher ratio for CJK text", () => {
    const text = "你好世界测试";
    const tokens = estimateTokens(text);
    expect(tokens).toBe(Math.ceil(6 / 1.5));
  });

  it("handles mixed CJK and English", () => {
    const text = "Hello你好";
    const tokens = estimateTokens(text);
    const cjk = 2;
    const nonCjk = 5;
    expect(tokens).toBe(Math.ceil(cjk / 1.5 + nonCjk / 4));
  });
});
