import { describe, it, expect } from "vitest";
import { placeTooltip, spotlight, targetView, visibleArea, type Rect, type VisualViewportLike } from "./placement";

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

// The measurement behind the spotlight: the element's client rect, the
// overlay's own fixed layer's client rect, and window.visualViewport, all from
// one frame. These are the cases a real phone produces.
describe("where the element is, under pinch zoom and scrolling", () => {
  const LAYER: Rect = { top: 0, left: 0, width: 360, height: 740 };
  const NOT_ZOOMED: VisualViewportLike = { offsetLeft: 0, offsetTop: 0, width: 360, height: 740, scale: 1 };
  // Zoomed 2x and panned: the visible area is a 180x370 window, 100px in and 200px down.
  const ZOOMED: VisualViewportLike = { offsetLeft: 100, offsetTop: 200, width: 180, height: 370, scale: 2 };

  it("puts the hole exactly on the element when nothing is zoomed", () => {
    const el = { top: 120, left: 20, width: 100, height: 40 };
    expect(targetView(el, LAYER, NOT_ZOOMED)).toEqual({ status: "visible", box: el });
  });

  it("stays on the element when zoomed and panned (rects relative to the layout viewport)", () => {
    const el = { top: 300, left: 150, width: 60, height: 30 };
    expect(targetView(el, LAYER, ZOOMED)).toEqual({ status: "visible", box: el });
  });

  it("stays on the element when the browser reports rects relative to the visual viewport", () => {
    // Same element, same zoom; this browser shifts every client rect — our layer's too.
    const shift = { top: -200, left: -100 };
    const el = { top: 300 + shift.top, left: 150 + shift.left, width: 60, height: 30 };
    const layer = { ...LAYER, top: shift.top, left: shift.left };
    expect(targetView(el, layer, ZOOMED)).toEqual({
      status: "visible",
      box: { top: 300, left: 150, width: 60, height: 30 },
    });
  });

  it("calls an element outside the zoomed-in window off screen, with the way to it", () => {
    // Inside the page, but above / below / beside what the zoomed person sees.
    expect(targetView({ top: 50, left: 150, width: 60, height: 30 }, LAYER, ZOOMED)).toEqual({ status: "offscreen", direction: "up" });
    expect(targetView({ top: 600, left: 150, width: 60, height: 30 }, LAYER, ZOOMED)).toEqual({ status: "offscreen", direction: "down" });
    expect(targetView({ top: 300, left: 10, width: 60, height: 30 }, LAYER, ZOOMED)).toEqual({ status: "offscreen", direction: "left" });
    expect(targetView({ top: 300, left: 300, width: 40, height: 30 }, LAYER, ZOOMED)).toEqual({ status: "offscreen", direction: "right" });
  });

  it("calls an element below the fold off screen, down — never a hole in the corner", () => {
    expect(targetView({ top: 1900, left: 20, width: 100, height: 40 }, LAYER, NOT_ZOOMED)).toEqual({
      status: "offscreen",
      direction: "down",
    });
  });

  it("counts a partly visible element as visible", () => {
    const el = { top: 720, left: 20, width: 100, height: 40 };
    expect(targetView(el, LAYER, NOT_ZOOMED).status).toBe("visible");
  });

  it("calls a zero-sized element hidden (display:none, a folded section)", () => {
    expect(targetView({ top: 0, left: 0, width: 0, height: 0 }, LAYER, NOT_ZOOMED)).toEqual({ status: "hidden" });
  });

  it("calls an element parked beside the page hidden (the closed drawer), not somewhere to scroll", () => {
    expect(targetView({ top: 200, left: -256, width: 240, height: 40 }, LAYER, NOT_ZOOMED)).toEqual({ status: "hidden" });
    expect(targetView({ top: 200, left: 400, width: 100, height: 40 }, LAYER, NOT_ZOOMED)).toEqual({ status: "hidden" });
  });

  it("gives the card the zoomed-in window to live in", () => {
    expect(visibleArea(ZOOMED)).toEqual({ top: 200, left: 100, width: 180, height: 370 });
    // …and a phone-width window at 2x zoom lays the card out as a sheet in it.
    const p = placeTooltip({ target: null, viewport: visibleArea(ZOOMED), tip: { width: 156, height: 200 }, safe: NO_SAFE });
    expect(p.mode).toBe("sheet-bottom");
    expect(p.left).toBeGreaterThanOrEqual(100);
    expect(p.top + 200).toBeLessThanOrEqual(200 + 370);
  });
});
