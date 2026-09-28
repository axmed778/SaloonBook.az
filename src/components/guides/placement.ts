// Where the guide's tooltip goes, as arithmetic. PURE — no DOM — so the rules
// for small phones are tested as data (placement.test.ts).
//
// Two layouts:
//   sheet  — phones (< 640px wide): a full-width card at the bottom of the
//            visible screen, like the app's other sheets. When the highlighted
//            element sits where that card would cover it (a "Save" button low
//            on the screen, the bottom tab bar), the card moves to the top.
//   float  — wider screens: a card next to the element, below it when there
//            is room, else above, else wherever it covers the least.

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PlacementInput {
  /** The highlighted element, in viewport coordinates. Null for a step with nothing to point at. */
  target: Rect | null;
  /** The visible viewport (visualViewport when the on-screen keyboard is up). */
  viewport: Rect;
  /** The tooltip's measured size. */
  tip: { width: number; height: number };
  /** env(safe-area-inset-*): the notch and the home indicator. */
  safe: Insets;
}

export interface Placement {
  mode: "sheet-bottom" | "sheet-top" | "float";
  top: number;
  left: number;
  /** Set for sheets, which span the viewport minus the margins. */
  width?: number;
}

export const NARROW_MAX = 640;
const MARGIN = 12;
const GAP = 12;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, Math.max(lo, hi)));
}

export function placeTooltip({ target, viewport, tip, safe }: PlacementInput): Placement {
  const vTop = viewport.top + safe.top + MARGIN;
  const vBottom = viewport.top + viewport.height - safe.bottom - MARGIN;
  const vLeft = viewport.left + safe.left + MARGIN;
  const vRight = viewport.left + viewport.width - safe.right - MARGIN;

  if (viewport.width < NARROW_MAX) {
    const width = vRight - vLeft;
    const bottomTop = vBottom - tip.height;
    // The bottom sheet covers [bottomTop, vBottom]. It is the default; move to
    // the top only when the element would be under it AND the top is free.
    if (target) {
      const targetBottom = target.top + target.height;
      const coveredAtBottom = targetBottom > bottomTop - GAP;
      const coveredAtTop = target.top < vTop + tip.height + GAP;
      if (coveredAtBottom && !coveredAtTop) {
        return { mode: "sheet-top", top: vTop, left: vLeft, width };
      }
    }
    return { mode: "sheet-bottom", top: bottomTop, left: vLeft, width };
  }

  if (!target) {
    return {
      mode: "float",
      top: clamp(viewport.top + (viewport.height - tip.height) / 2, vTop, vBottom - tip.height),
      left: clamp(viewport.left + (viewport.width - tip.width) / 2, vLeft, vRight - tip.width),
    };
  }

  const left = clamp(target.left + target.width / 2 - tip.width / 2, vLeft, vRight - tip.width);
  const below = target.top + target.height + GAP;
  if (below + tip.height <= vBottom) return { mode: "float", top: below, left };
  const above = target.top - GAP - tip.height;
  if (above >= vTop) return { mode: "float", top: above, left };
  // Neither fits (a tall element): pin to whichever edge leaves more of it seen.
  const roomBelow = vBottom - (target.top + target.height);
  const roomAbove = target.top - vTop;
  return {
    mode: "float",
    top: roomBelow >= roomAbove ? vBottom - tip.height : vTop,
    left,
  };
}

/**
 * How far to scroll the page so the element sits in the part of the screen the
 * tooltip leaves free: the upper third on a phone (the sheet takes the bottom),
 * the middle elsewhere. Zero when it is already comfortably in view.
 */
export function scrollDelta(target: Rect, viewport: Rect, sheetHeight: number): number {
  const narrow = viewport.width < NARROW_MAX;
  const free = narrow ? viewport.height - sheetHeight - GAP : viewport.height;
  const top = target.top - viewport.top;
  const bottom = top + target.height;
  // A band with some air above (under a sticky header) and below.
  if (top >= 72 && bottom <= free - GAP) return 0;
  const want = narrow ? viewport.height * 0.3 : (viewport.height - target.height) / 2;
  return Math.round(top - Math.max(72, want));
}

/** The spotlight hole: the element (and its error line, when shown) with some air. */
export function spotlight(rects: readonly Rect[], pad = 6): Rect | null {
  if (rects.length === 0) return null;
  const top = Math.min(...rects.map((r) => r.top)) - pad;
  const left = Math.min(...rects.map((r) => r.left)) - pad;
  const bottom = Math.max(...rects.map((r) => r.top + r.height)) + pad;
  const right = Math.max(...rects.map((r) => r.left + r.width)) + pad;
  return { top, left, width: right - left, height: bottom - top };
}
