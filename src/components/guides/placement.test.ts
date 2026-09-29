import { describe, it, expect } from "vitest";
import { placeTooltip, scrollDelta, spotlight, type Rect } from "./placement";

const PHONE: Rect = { top: 0, left: 0, width: 360, height: 740 };
const DESKTOP: Rect = { top: 0, left: 0, width: 1280, height: 800 };
const NO_SAFE = { top: 0, right: 0, bottom: 0, left: 0 };
const IPHONE_SAFE = { top: 47, right: 0, bottom: 34, left: 0 };
const TIP = { width: 336, height: 200 };

describe("tooltip on a phone", () => {
  it("is a bottom sheet spanning the screen, clear of the home indicator", () => {
    const p = placeTooltip({ target: { top: 100, left: 20, width: 120, height: 40 }, viewport: PHONE, tip: TIP, safe: IPHONE_SAFE });
    expect(p.mode).toBe("sheet-bottom");
    expect(p.width).toBe(360 - 24);
    expect(p.top + TIP.height).toBe(740 - 34 - 12);
  });

  it("moves to the top when the element would sit under the sheet (a Save button low down)", () => {
    const save = { top: 600, left: 20, width: 100, height: 40 };
    const p = placeTooltip({ target: save, viewport: PHONE, tip: TIP, safe: IPHONE_SAFE });
    expect(p.mode).toBe("sheet-top");
    expect(p.top).toBe(47 + 12);
    // …and then does not cover it.
    expect(p.top + TIP.height).toBeLessThan(save.top);
  });

  it("stays at the bottom when the element fills both halves (nothing better to do)", () => {
    const tall = { top: 80, left: 0, width: 360, height: 620 };
    expect(placeTooltip({ target: tall, viewport: PHONE, tip: TIP, safe: NO_SAFE }).mode).toBe("sheet-bottom");
  });

  it("follows the visible viewport when the keyboard shrinks it", () => {
    const keyboardUp: Rect = { top: 0, left: 0, width: 360, height: 400 };
    const p = placeTooltip({ target: { top: 60, left: 20, width: 300, height: 40 }, viewport: keyboardUp, tip: TIP, safe: NO_SAFE });
    expect(p.top + TIP.height).toBeLessThanOrEqual(400);
  });
});

describe("tooltip on a wide screen", () => {
  it("sits below the element when there is room, horizontally clamped", () => {
    const p = placeTooltip({ target: { top: 100, left: 1200, width: 60, height: 30 }, viewport: DESKTOP, tip: TIP, safe: NO_SAFE });
    expect(p.mode).toBe("float");
    expect(p.top).toBe(100 + 30 + 12);
    expect(p.left + TIP.width).toBeLessThanOrEqual(1280 - 12);
  });

  it("goes above when below is too short", () => {
    const p = placeTooltip({ target: { top: 700, left: 400, width: 100, height: 40 }, viewport: DESKTOP, tip: TIP, safe: NO_SAFE });
    expect(p.top).toBe(700 - 12 - TIP.height);
  });

  it("centres a step with nothing to point at", () => {
    const p = placeTooltip({ target: null, viewport: DESKTOP, tip: TIP, safe: NO_SAFE });
    expect(p.left).toBe((1280 - TIP.width) / 2);
  });
});

describe("scrolling the element into view", () => {
  it("leaves an element already in the free part alone", () => {
    expect(scrollDelta({ top: 200, left: 0, width: 100, height: 40 }, PHONE, 200)).toBe(0);
  });

  it("brings a low element up above the sheet on a phone", () => {
    const d = scrollDelta({ top: 650, left: 0, width: 100, height: 40 }, PHONE, 200);
    const after = 650 - d;
    expect(after + 40).toBeLessThan(740 - 200);
  });
});

describe("spotlight", () => {
  it("wraps the element and its error line together, with padding", () => {
    const hole = spotlight([
      { top: 100, left: 10, width: 80, height: 30 },
      { top: 70, left: 10, width: 200, height: 20 },
    ]);
    expect(hole).toEqual({ top: 64, left: 4, width: 212, height: 72 });
  });

  it("is nothing when there is nothing to point at", () => {
    expect(spotlight([])).toBeNull();
  });
});
