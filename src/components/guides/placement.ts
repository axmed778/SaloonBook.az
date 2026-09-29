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

/** The spotlight hole: the element (and its error line, when shown) with some air. */
export function spotlight(rects: readonly Rect[], pad = 6): Rect | null {
  if (rects.length === 0) return null;
  const top = Math.min(...rects.map((r) => r.top)) - pad;
  const left = Math.min(...rects.map((r) => r.left)) - pad;
  const bottom = Math.max(...rects.map((r) => r.top + r.height)) + pad;
  const right = Math.max(...rects.map((r) => r.left + r.width)) + pad;
  return { top, left, width: right - left, height: bottom - top };
}

/** What window.visualViewport reports: the part of the page actually on screen. */
export interface VisualViewportLike {
  /** Offset of the visible area inside the layout viewport (pinch-zoom pans it). */
  offsetLeft: number;
  offsetTop: number;
  /** Size of the visible area, in CSS pixels (shrinks as the person zooms in). */
  width: number;
  height: number;
  /** Pinch-zoom factor; 1 when not zoomed. */
  scale: number;
}

/**
 * Where the step's element is, in the overlay's own coordinates, and whether
 * the person can see it:
 *   visible   — at least partly inside the visible area; `box` is its rectangle
 *               in the overlay layer, ready for the spotlight.
 *   offscreen — laid out, but above/below (or, zoomed in, beside) the visible
 *               area: scroll to it, or point at it with an edge arrow.
 *   hidden    — no box on the page at all (display:none, a folded section, the
 *               closed drawer parked off the side): nothing to scroll to.
 * Never a spotlight at (0,0) for an element that has no place on screen.
 */
export type TargetView =
  | { status: "visible"; box: Rect }
  | { status: "offscreen"; direction: "up" | "down" | "left" | "right" }
  | { status: "hidden" };

/**
 * The element's view, from three measurements taken in the SAME frame:
 *   el    — the element's getBoundingClientRect();
 *   layer — the overlay's own fixed, full-viewport layer's getBoundingClientRect();
 *   vv    — window.visualViewport.
 *
 * Subtracting the layer's rectangle puts the element in the coordinates the
 * fixed spotlight and card are drawn in, whichever space a browser reports
 * client rects in (layout or visual viewport — they disagree under pinch zoom).
 * The visible area inside that layer is the visual viewport's offset and size.
 */
export function targetView(el: Rect, layer: Rect, vv: VisualViewportLike): TargetView {
  if (el.width <= 0 && el.height <= 0) return { status: "hidden" };
  const box: Rect = { top: el.top - layer.top, left: el.left - layer.left, width: el.width, height: el.height };
  // Beside the layout viewport itself: the page does not scroll sideways, so this
  // is something parked out of view (the closed drawer), not somewhere to go.
  if (box.left + box.width <= 0 || box.left >= layer.width) return { status: "hidden" };

  const top = vv.offsetTop;
  const bottom = vv.offsetTop + vv.height;
  const left = vv.offsetLeft;
  const right = vv.offsetLeft + vv.width;
  if (box.top + box.height <= top) return { status: "offscreen", direction: "up" };
  if (box.top >= bottom) return { status: "offscreen", direction: "down" };
  if (box.left + box.width <= left) return { status: "offscreen", direction: "left" };
  if (box.left >= right) return { status: "offscreen", direction: "right" };
  return { status: "visible", box };
}

/** The visible area, in the overlay layer's coordinates. */
export function visibleArea(vv: VisualViewportLike): Rect {
  return { top: vv.offsetTop, left: vv.offsetLeft, width: vv.width, height: vv.height };
}
