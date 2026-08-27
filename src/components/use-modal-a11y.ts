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

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

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
        if (!closeRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const items = focusableWithin(el);
      if (items.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (!active || !el.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
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
