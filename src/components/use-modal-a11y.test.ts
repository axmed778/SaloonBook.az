import { describe, it, expect } from "vitest";
import { registerTopLayer, tabTarget, topLayerActive } from "./use-modal-a11y";

// The layer stack between the dialogs and the interactive guide drawn above
// them. Without a guide, every dialog must behave exactly as it always has; with
// one, the dialog leaves Escape to the guide and lets Tab reach its card.
// (No DOM in the unit suite: the rules are checked as the pure pieces the hook
// is built from.)

const el = () => ({}) as HTMLElement;

describe("layers above the dialogs", () => {
  it("take Escape only while registered, and give it back when removed", () => {
    expect(topLayerActive()).toBe(false);
    const unregister = registerTopLayer(el());
    expect(topLayerActive()).toBe(true);
    unregister();
    expect(topLayerActive()).toBe(false);
  });

  it("stack: the dialogs get Escape back only after the last layer goes", () => {
    const a = registerTopLayer(el());
    const b = registerTopLayer(el());
    a();
    expect(topLayerActive()).toBe(true);
    b();
    expect(topLayerActive()).toBe(false);
  });

  it("unregistering twice is harmless", () => {
    const off = registerTopLayer(el());
    off();
    off();
    expect(topLayerActive()).toBe(false);
  });
});

describe("the Tab cycle", () => {
  // The dialog's own controls, then (while a guide runs) the guide card's.
  const [first, middle, last, cardBack, cardNext] = ["first", "middle", "last", "cardBack", "cardNext"];

  it("is unchanged without a guide: wraps at both ends, pulls stray focus in", () => {
    const items = [first, middle, last];
    expect(tabTarget(items, last, false, true)).toBe(first);
    expect(tabTarget(items, first, true, true)).toBe(last);
    expect(tabTarget(items, middle, false, true)).toBeNull(); // the browser moves on
    expect(tabTarget(items, "outside", false, false)).toBe(first);
    expect(tabTarget(items, null, true, false)).toBe(last);
    expect(tabTarget([], null, false, false)).toBeNull();
  });

  it("with a guide, runs through the card's buttons and back into the dialog", () => {
    // The card is elsewhere in the DOM, so every step is taken explicitly: the
    // browser's own order would leave the dialog for the page, not the card.
    const items = [first, middle, last, cardBack, cardNext];
    expect(tabTarget(items, middle, false, true, true)).toBe(last);
    expect(tabTarget(items, last, false, true, true)).toBe(cardBack);
    expect(tabTarget(items, cardNext, false, true, true)).toBe(first);
    expect(tabTarget(items, first, true, true, true)).toBe(cardNext);
    expect(tabTarget(items, cardBack, true, true, true)).toBe(last);
    // The panel itself (tabIndex -1) is inside but not in the list.
    expect(tabTarget(items, "panel", false, true, true)).toBe(first);
  });
});
