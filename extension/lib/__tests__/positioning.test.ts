import { describe, it, expect } from "vitest";
import { computePanelPosition } from "../positioning";

const M = 12;

describe("computePanelPosition", () => {
  const viewport = { w: 1024, h: 768 };
  const panel = { width: 420, height: 300 };

  it("positions below when there is room", () => {
    const sel = { top: 100, bottom: 120, left: 50 };
    const pos = computePanelPosition(sel, panel, viewport);
    expect(pos.top).toBe(120 + M);
    expect(pos.left).toBe(50);
  });

  it("flips above when below overflows", () => {
    const sel = { top: 400, bottom: 500, left: 50 };
    const pos = computePanelPosition(sel, panel, viewport);
    expect(pos.top).toBe(400 - 300 - M);
  });

  it("centers vertically when neither above nor below fits", () => {
    const tallPanel = { width: 420, height: 700 };
    const sel = { top: 100, bottom: 200, left: 50 };
    const pos = computePanelPosition(sel, tallPanel, viewport);
    expect(pos.top).toBe(Math.max(M, (768 - 700) / 2));
  });

  it("clamps left to 12px minimum", () => {
    const sel = { top: 100, bottom: 120, left: -50 };
    const pos = computePanelPosition(sel, panel, viewport);
    expect(pos.left).toBe(M);
  });

  it("clamps left so panel does not overflow right edge", () => {
    const sel = { top: 100, bottom: 120, left: 900 };
    const pos = computePanelPosition(sel, panel, viewport);
    expect(pos.left).toBe(1024 - 420 - M);
  });

  it("always maintains 12px margin from viewport edges", () => {
    const sel = { top: 0, bottom: 10, left: 0 };
    const pos = computePanelPosition(sel, panel, viewport);
    expect(pos.top).toBeGreaterThanOrEqual(M);
    expect(pos.left).toBeGreaterThanOrEqual(M);
  });
});
