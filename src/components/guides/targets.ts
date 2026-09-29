// Finding the element a guide step points at, by its data-tour attribute.
//
// Several elements may carry the same anchor: the menu is rendered twice (the
// desktop sidebar and the phone drawer), and only one is on screen at a time.
// The first one actually laid out wins — "laid out" meaning it has a box and
// that box is horizontally inside the page (the closed drawer sits at
// x = -256). It may still be scrolled out of view vertically; the overlay
// deals with that (placement.ts, targetView).
//
// The page width is documentElement.clientWidth — the LAYOUT viewport — never
// window.innerWidth, which some browsers shrink to the visible area under pinch
// zoom: a zoomed-in person would lose every element to the right of what they
// happen to be looking at.

export function tourSelector(name: string): string {
  return `[data-tour="${name}"]`;
}

export function isOnScreen(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  if (r.right <= 0 || r.left >= document.documentElement.clientWidth) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

export function findTarget(name: string): HTMLElement | null {
  return locateTarget(name).el;
}

/**
 * The step's element, told apart from "it is in the page but has no place on
 * screen" (display:none, inside a folded section or the closed drawer), which
 * gets its own message instead of a silent wait.
 */
export function locateTarget(name: string): { el: HTMLElement | null; hidden: HTMLElement | null } {
  const all = document.querySelectorAll<HTMLElement>(tourSelector(name));
  for (const el of all) if (isOnScreen(el)) return { el, hidden: null };
  return { el: null, hidden: all[0] ?? null };
}

/** The nearest ancestor that has a box on screen, to scroll to when the element itself has none. */
export function nearestShown(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const r = n.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return n;
  }
  return null;
}

/** Inside a fixed or sticky layer (the drawer, a modal): scrolling the page will not move it. */
export function inFixedLayer(el: Element): boolean {
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    const p = window.getComputedStyle(n).position;
    if (p === "fixed" || p === "sticky") return true;
  }
  return false;
}

/**
 * Whether an input step's field is filled in. A text field needs a value; a
 * group of choices needs one picked — a checked box, or a toggle button that
 * says it is pressed; a read-only value shown as text counts as filled.
 */
export function isFilled(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value.trim() !== "";
  }
  if (el.querySelector('input:checked, [aria-pressed="true"]')) return true;
  // A value shown as plain text where a field would be (the login e-mail once
  // it is set): already filled, nothing to type.
  return !el.querySelector("input, select, textarea, button") && (el.textContent ?? "").trim() !== "";
}

/** The text field inside an input step's target, when the target is a field. */
export function isTextField(el: HTMLElement): boolean {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}
