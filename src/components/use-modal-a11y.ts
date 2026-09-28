"use client";

import { useEffect, useId, useRef } from "react";

// Keyboard/screen-reader plumbing every dialog in the app needs and none of
// them had: a `dialog` role with an accessible name, Escape to close, focus
// moved in on open, focus kept inside while open, and focus handed back to
// whatever opened it. Spread `dialogProps` on the dialog *panel* (the card, not
// the full-screen overlay — the overlay is decoration and must stay out of the
// accessibility tree) and put `titleId` on the panel's heading.

// Stack of the mounted dialogs, innermost last. A ConfirmDialog opened on top
// of an editor modal must swallow Escape by itself, otherwise one keypress
// closes both and the user loses the form they were filling in.
const openDialogs: symbol[] = [];

// Non-modal layers drawn ABOVE every dialog: the interactive guide's tooltip
// (src/components/guides/). While one is registered, a dialog underneath
// leaves Escape to it (the guide is what the person sees on top) and lets Tab
// reach its buttons as part of the dialog's own cycle. With none registered —
// always, outside a guide — every dialog behaves exactly as before.
const topLayers = new Set<HTMLElement>();

/** Register a layer drawn above the dialogs. Returns the unregister function. */
export function registerTopLayer(el: HTMLElement): () => void {
  topLayers.add(el);
  return () => {
    topLayers.delete(el);
  };
}

/** Whether a layer above the dialogs is taking Escape. */
export function topLayerActive(): boolean {
  return topLayers.size > 0;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Where Tab should move focus inside a trap, or null to let the browser move it.
 * `inside` says whether the focused element belongs to the trap at all.
 * `explicit` steps through `items` in order instead of leaving the middle of the
 * cycle to the browser — needed once the trap spans a layer elsewhere in the
 * DOM (the guide's card), which the browser's own order would never reach.
 * Pure, so the cycle is tested without a DOM (use-modal-a11y.test.ts).
 */
export function tabTarget<T>(
  items: readonly T[],
  active: T | null,
  shift: boolean,
  inside: boolean,
  explicit = false,
): T | null {
  if (items.length === 0) return null;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (!active || !inside) return shift ? last : first;
  if (explicit) {
    const i = items.indexOf(active);
    if (i === -1) return shift ? last : first;
    return items[(i + (shift ? -1 : 1) + items.length) % items.length]!;
  }
  if (shift && active === first) return last;
  if (!shift && active === last) return first;
  return null;
}

function focusableWithin(panel: HTMLElement): HTMLElement[] {
  // getClientRects() rather than offsetParent: the panel sits inside a
  // `position: fixed` overlay, where offsetParent is null for perfectly
  // visible children.
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getClientRects().length > 0,
  );
}

export function useModalA11y<T extends HTMLElement = HTMLDivElement>(
  /**
   * Called on Escape. Pass `null` for a dialog the user is not allowed to
   * dismiss (the consent gate) — it still traps focus, it just can't be closed.
   */
  onClose: (() => void) | null,
) {
  const panelRef = useRef<T | null>(null);
  const titleId = useId();

  // Read through a ref so an inline arrow from the caller doesn't re-run the
  // effect and re-steal focus on every render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const token = Symbol("dialog");
    openDialogs.push(token);
    const opener = document.activeElement as HTMLElement | null;

    // Move focus in on open. Prefer the first control; fall back to the panel
    // itself, which carries tabIndex={-1} for exactly this case.
    const panel = panelRef.current;
    if (panel) (focusableWithin(panel)[0] ?? panel).focus();

    function onKeyDown(e: KeyboardEvent) {
      // Only the innermost dialog reacts.
      if (openDialogs[openDialogs.length - 1] !== token) return;
      const el = panelRef.current;
      if (!el) return;

      if (e.key === "Escape") {
        // The guide above handles it; one keypress must not close both.
        if (topLayerActive()) return;
        if (!closeRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const layers = [...topLayers];
      const items = [...focusableWithin(el), ...layers.flatMap(focusableWithin)];
      if (items.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && (el.contains(active) || layers.some((l) => l.contains(active)));
      const next = tabTarget(items, active, e.shiftKey, inside, layers.length > 0);
      if (next) {
        e.preventDefault();
        next.focus();
      }
    }

    // Capture phase so the dialog sees Escape before any field-level handler
    // underneath it (a <select> or a date input) can eat the key.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const i = openDialogs.indexOf(token);
      if (i !== -1) openDialogs.splice(i, 1);
      // Hand focus back to the trigger, unless the action the dialog performed
      // removed it from the page (deleting the row its button lived in).
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return {
    /** Put this on the dialog's own heading so the dialog has a name. */
    titleId,
    dialogProps: {
      ref: panelRef,
      role: "dialog" as const,
      "aria-modal": true,
      "aria-labelledby": titleId,
      // Focus target of last resort, and what makes the trap work in a dialog
      // whose controls are all disabled while a submit is in flight.
      tabIndex: -1,
    },
  };
}
