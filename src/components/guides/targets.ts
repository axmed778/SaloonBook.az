// Finding the element a guide step points at, by its data-tour attribute.
//
// Several elements may carry the same anchor: the menu is rendered twice (the
// desktop sidebar and the phone drawer), and only one is on screen at a time.
// The first one actually visible wins — "visible" meaning it has a box and
// that box is horizontally on screen (the closed drawer sits at x = -256).

export function tourSelector(name: string): string {
  return `[data-tour="${name}"]`;
}

export function isOnScreen(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  if (r.right <= 0 || r.left >= window.innerWidth) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

export function findTarget(name: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(tourSelector(name));
  for (const el of all) if (isOnScreen(el)) return el;
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
 * says it is pressed.
 */
export function isFilled(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value.trim() !== "";
  }
  return el.querySelector('input:checked, [aria-pressed="true"]') !== null;
}

/** The text field inside an input step's target, when the target is a field. */
export function isTextField(el: HTMLElement): boolean {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}
