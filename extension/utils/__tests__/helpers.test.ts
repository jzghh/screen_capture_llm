import { describe, it, expect } from "vitest";
import { isPlainObject } from "../helpers";

describe("isPlainObject", () => {
  it("returns true for plain objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  it("returns false for arrays", () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2])).toBe(false);
  });

  it("returns false for null", () => {
    expect(isPlainObject(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isPlainObject(undefined)).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isPlainObject("string")).toBe(false);
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject(true)).toBe(false);
    expect(isPlainObject(Symbol())).toBe(false);
  });
});
