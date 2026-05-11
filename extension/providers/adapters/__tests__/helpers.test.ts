import { describe, it, expect } from "vitest";
import { trimSlash, extractError, withTimeout } from "../helpers";

describe("trimSlash", () => {
  it("removes trailing slash", () => {
    expect(trimSlash("https://api.example.com/")).toBe("https://api.example.com");
  });

  it("leaves URL unchanged when no trailing slash", () => {
    expect(trimSlash("https://api.example.com")).toBe("https://api.example.com");
  });

  it("removes only the last slash", () => {
    expect(trimSlash("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
  });
});

describe("extractError", () => {
  it("extracts Anthropic-style error { error: { message } }", () => {
    expect(extractError({ error: { message: "bad key" } })).toBe("bad key");
  });

  it("extracts OpenAI-style error { error: string }", () => {
    expect(extractError({ error: "bad request" })).toBe("bad request");
  });

  it("returns empty string for empty object", () => {
    expect(extractError({})).toBe("");
  });

  it("returns empty string for null", () => {
    expect(extractError(null)).toBe("");
  });

  it("returns empty string for non-object", () => {
    expect(extractError("not an object")).toBe("");
  });

  it("returns empty string when error.message is not a string", () => {
    expect(extractError({ error: { message: 42 } })).toBe("");
  });
});

describe("withTimeout", () => {
  it("returns an AbortSignal when called with no signal", () => {
    const result = withTimeout(undefined, 5000);
    expect(result).toBeInstanceOf(AbortSignal);
    expect(result.aborted).toBe(false);
  });

  it("returns an AbortSignal when called with an existing signal", () => {
    const controller = new AbortController();
    const result = withTimeout(controller.signal, 5000);
    expect(result).toBeInstanceOf(AbortSignal);
    expect(result.aborted).toBe(false);
  });

  it("aborts when the caller signal aborts", () => {
    const controller = new AbortController();
    const result = withTimeout(controller.signal, 60_000);
    controller.abort();
    expect(result.aborted).toBe(true);
  });
});
