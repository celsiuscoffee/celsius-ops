import { describe, it, expect } from "vitest";
import { placePicker } from "./picker-placement";

const fits = (p: { top: number; maxHeight: number }, h: number) => p.top >= 8 && p.top + p.maxHeight <= h - 8;

describe("placePicker — roster shift picker stays on screen", () => {
  it("opens below a cell near the top", () => {
    const p = placePicker({ top: 100, bottom: 130, left: 400 }, { width: 1280, height: 900 });
    expect(p.top).toBe(134);
    expect(p.maxHeight).toBe(480);
    expect(fits(p, 900)).toBe(true);
  });

  it("flips above a cell near the bottom (the 23 Nov screenshot case)", () => {
    // 1280x721 window, Thursday cell for a row low on the grid.
    const p = placePicker({ top: 600, bottom: 630, left: 760 }, { width: 1280, height: 721 });
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(596);
    expect(fits(p, 721)).toBe(true);
  });

  it("never lets 70vh exceed the room it was positioned for", () => {
    // Old code positioned for 480px but CSS allowed 70vh (=630px here),
    // so the bottom 150px hung off-screen.
    for (let cellTop = 40; cellTop < 860; cellTop += 37) {
      const p = placePicker({ top: cellTop, bottom: cellTop + 30, left: 10 }, { width: 1440, height: 900 });
      expect(fits(p, 900)).toBe(true);
      expect(p.maxHeight).toBeGreaterThanOrEqual(120);
    }
  });

  it("short phone screen: pins inside the visible area", () => {
    const p = placePicker({ top: 300, bottom: 330, left: 300 }, { width: 390, height: 520 });
    expect(fits(p, 520)).toBe(true);
    expect(p.left).toBe(390 - 224 - 8);
  });
});
