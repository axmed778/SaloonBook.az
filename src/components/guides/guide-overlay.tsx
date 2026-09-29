"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { registerTopLayer } from "@/components/use-modal-a11y";
import type { GuideDef } from "@/lib/guides/registry";
import {
  NARROW_MAX,
  placeTooltip,
  spotlight,
  targetView,
  visibleArea,
  type Insets,
  type Rect,
  type TargetView,
  type VisualViewportLike,
} from "./placement";
import { findTarget, isFilled, isTextField, locateTarget, nearestShown } from "./targets";

// One step of a running guide on screen: the dimmed page with a hole around the
// real element, and the card that says what to do there. Remounted per step
// (keyed by the provider), so every piece of state below starts fresh.
//
// Layers: z-[55] for the dim and z-[56] for the card — above the modals and the
// drawer (z-50), so a step can point into them, and BELOW the toast (z-[60]),
// which is where a failed save explains itself ("every staff seat is taken").
// The dim never takes a click: the page stays fully usable, so a person who
// wanders off is never trapped, and the card's buttons are always there.
//
// Pinch zoom and scrolling: every position is measured against the overlay's
// own fixed layer and the visual viewport in the same frame (targetView), and
// re-measured on every frame plus on the visual viewport's resize/scroll, any
// ancestor's scroll, window resize, rotation and the element's own resize. The
// card always sits inside the part of the page actually on screen, and never
// taller than it, so its buttons stay reachable at any zoom. Zoom itself is
// never blocked: that is the person's to use.

/** How long a step waits for its element (a form opening, a page loading) before saying so. */
export const FIND_TIMEOUT_MS = 4000;

/** Stand-in for the menu entry on a phone, where the menu hides behind this button. */
const MENU_TARGET = "nav.menu";

type Phase = "search" | "notFound" | "submitted";

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b ||
  (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function readViewport(): VisualViewportLike {
  const vv = window.visualViewport;
  return vv
    ? { offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop, width: vv.width, height: vv.height, scale: vv.scale }
    : {
        offsetLeft: 0,
        offsetTop: 0,
        width: document.documentElement.clientWidth,
        height: window.innerHeight,
        scale: 1,
      };
}

const sameView = (a: TargetView | null, b: TargetView | null) => {
  if (a === b) return true;
  if (!a || !b || a.status !== b.status) return false;
  if (a.status === "visible" && b.status === "visible") return sameRect(a.box, b.box);
  if (a.status === "offscreen" && b.status === "offscreen") return a.direction === b.direction;
  return true;
};

/** Ms after an automatic scroll before the edge arrow may show (the scroll is still moving). */
const SCROLL_GRACE_MS = 800;

/** env(safe-area-inset-*) as numbers, read off a probe element. */
function readSafeArea(): Insets {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.appendChild(probe);
  const cs = window.getComputedStyle(probe);
  const out = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
  probe.remove();
  return out;
}

export function GuideOverlay({
  guide,
  stepIndex,
  onNext,
  onBack,
  onExit,
  onNotFound,
}: {
  guide: GuideDef;
  stepIndex: number;
  onNext: (from: number) => void;
  onBack: (from: number, to: number) => void;
  onExit: () => void;
  onNotFound: (step: number) => void;
}) {
  const t = useTranslations("Guides");
  const pathname = usePathname();
  const router = useRouter();
  const titleId = useId();
  const step = guide.steps[stepIndex]!;
  const total = guide.steps.length;
  const isLast = stepIndex === total - 1;
  // "Back" skips a page step already satisfied: it would finish on arrival and
  // bounce straight forward again.
  let backTo = stepIndex - 1;
  while (backTo >= 0) {
    const prev = guide.steps[backTo]!;
    if (!(prev.type === "navigate" && prev.route === pathname)) break;
    backTo -= 1;
  }

  const [phase, setPhase] = useState<Phase>("search");
  const [retry, setRetry] = useState(0);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [viaMenu, setViaMenu] = useState<HTMLElement | null>(null);
  /** Where the element (or the menu button standing in for it) is, and whether it is seen. */
  const [view, setView] = useState<TargetView | null>(null);
  /** In the page but with no place on screen (display:none, a folded section). */
  const [hiddenEl, setHiddenEl] = useState<HTMLElement | null>(null);
  const [errorBox, setErrorBox] = useState<Rect | null>(null);
  const [scale, setScale] = useState(1);
  const [arrowReady, setArrowReady] = useState(false);
  const layerRef = useRef<SVGSVGElement | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [filled, setFilled] = useState(false);
  const [viewport, setViewport] = useState<Rect | null>(null);
  const [safe, setSafe] = useState<Insets>({ top: 0, right: 0, bottom: 0, left: 0 });
  const [tipSize, setTipSize] = useState({ width: 360, height: 180 });
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  // A step on another page than the one open (a guide resumed after a reload
  // elsewhere, or the person wandered off): offer to go there, don't wait.
  const wrongPage = step.type !== "navigate" && !!step.route && pathname !== step.route;

  // Callbacks read through refs, so the frame loop below is set up once.
  const nextRef = useRef(onNext);
  nextRef.current = onNext;

  // ── Navigate steps finish on arrival ──────────────────────────────────────
  useEffect(() => {
    if (step.type === "navigate" && step.route && pathname === step.route) onNext(stepIndex);
  }, [pathname, step, stepIndex, onNext]);

  // ── Escape closes the guide (capture on window: before any dialog below) ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onExit();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onExit]);

  // ── The card is a layer above the dialogs (Tab reaches it, Escape is ours) ─
  useEffect(() => {
    const el = tipRef.current;
    return el ? registerTopLayer(el) : undefined;
  }, []);

  // Focus the card when the guide opens, so a screen reader starts reading it.
  // Later steps leave focus where it is: the person may be typing in a field.
  useEffect(() => {
    if (stepIndex === 0) tipRef.current?.focus({ preventScroll: true });
  }, [stepIndex]);

  useEffect(() => {
    setSafe(readSafeArea());
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    const measure = () => setTipSize({ width: el.offsetWidth, height: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Measuring: find the element, follow it, notice changes ────────────────
  useEffect(() => {
    let raf = 0;
    let advanced = false;
    let observed: Element | null = null;
    const ro = new ResizeObserver(() => measure());
    const measure = () => {
      const loc = step.target && !wrongPage ? locateTarget(step.target) : { el: null, hidden: null };
      const el = loc.el;
      // On a phone the menu entry lives in the drawer; until it is opened, point
      // at the button that opens it.
      const menu = !el && step.type === "navigate" ? findTarget(MENU_TARGET) : null;
      const hidden = el || menu ? null : loc.hidden;
      setTarget((prev) => (prev === el ? prev : el));
      setViaMenu((prev) => (prev === menu ? prev : menu));
      setHiddenEl((prev) => (prev === hidden ? prev : hidden));

      // One frame, three measurements: the element, our own fixed layer, the
      // visual viewport (placement.ts explains why all three).
      const vv = readViewport();
      const layer: Rect = layerRef.current
        ? rectOf(layerRef.current)
        : { top: 0, left: 0, width: document.documentElement.clientWidth, height: window.innerHeight };
      const shown = el ?? menu;
      if (shown !== observed) {
        if (observed) ro.unobserve(observed);
        if (shown) ro.observe(shown);
        observed = shown;
      }
      const v = shown ? targetView(rectOf(shown), layer, vv) : null;
      setView((prev) => (sameView(prev, v) ? prev : v));
      const errEl = step.errorTarget ? findTarget(step.errorTarget) : null;
      const ev = errEl ? targetView(rectOf(errEl), layer, vv) : null;
      const eb = ev?.status === "visible" ? ev.box : null;
      setErrorBox((prev) => (sameRect(prev, eb) ? prev : eb));
      const ok = !!step.successTarget && !!findTarget(step.successTarget);
      setSucceeded((prev) => (prev === ok ? prev : ok));
      const area = visibleArea(vv);
      setViewport((prev) => (sameRect(prev, area) ? prev : area));
      setScale((prev) => (prev === vv.scale ? prev : vv.scale));
      if (step.type === "input" && el) {
        const f = isFilled(el);
        setFilled((prev) => (prev === f ? prev : f));
      }
      // A button that opens a form, when the form is already open: the person
      // is ahead of the guide, so catch up instead of waiting for a button that
      // only shows while the form is closed.
      if (!advanced && !el && step.type === "click" && !step.awaitRemoval && !step.successTarget && !wrongPage) {
        const after = guide.steps[stepIndex + 1];
        if (after?.target && findTarget(after.target)) {
          advanced = true;
          nextRef.current(stepIndex);
        }
      }
    };
    // Every frame (the page changes under us: forms open, lists refresh), and
    // at once on anything that moves the page or the visible area — a browser
    // may slow frames down during a pinch or a fling, events still arrive.
    const tick = () => {
      measure();
      raf = requestAnimationFrame(tick);
    };
    tick();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    window.addEventListener("scroll", measure, { capture: true, passive: true }); // any scrolling ancestor
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
      window.removeEventListener("scroll", measure, { capture: true });
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [guide, step, stepIndex, wrongPage]);

  // ── Found / not found / submitted ─────────────────────────────────────────
  const found = !!(target || viaMenu);
  useEffect(() => {
    if (wrongPage || !step.target) return;
    if (phase === "submitted") {
      // The save went through: its "Saved" line appeared, or the form closed.
      if (step.successTarget ? succeeded : !target) onNext(stepIndex);
      return;
    }
    if (found) {
      if (phase === "notFound") setPhase("search");
      return;
    }
    if (phase !== "search") return;
    const id = window.setTimeout(() => {
      setPhase("notFound");
      onNotFound(stepIndex);
    }, FIND_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [found, target, succeeded, phase, retry, wrongPage, step.target, step.successTarget, stepIndex, onNext, onNotFound]);

  // ── What finishes the step ────────────────────────────────────────────────
  useEffect(() => {
    if (!target) return;
    if (step.type === "click") {
      const onClick = () => {
        if (!step.awaitRemoval && !step.successTarget) return onNext(stepIndex);
        // Forget a "Saved" line left from an earlier press: only one that
        // appears after this press counts.
        setSucceeded(false);
        setPhase("submitted");
      };
      target.addEventListener("click", onClick, true);
      return () => target.removeEventListener("click", onClick, true);
    }
    if (step.type === "input" && target instanceof HTMLSelectElement) {
      // A dropdown commits with the pick itself.
      const onChange = () => isFilled(target) && onNext(stepIndex);
      target.addEventListener("change", onChange);
      return () => target.removeEventListener("change", onChange);
    }
    if (step.type === "input" && isTextField(target)) {
      // On commit (leaving the field, or Enter), not on every keystroke: the
      // card must not jump away while a name is half typed.
      const onChange = () => isFilled(target) && onNext(stepIndex);
      const onKey = (e: KeyboardEvent) => e.key === "Enter" && isFilled(target) && onNext(stepIndex);
      target.addEventListener("change", onChange);
      target.addEventListener("keydown", onKey);
      return () => {
        target.removeEventListener("change", onChange);
        target.removeEventListener("keydown", onKey);
      };
    }
  }, [target, step, stepIndex, onNext]);

  // ── Bring the element into the part of the screen the card leaves free ────
  const scrolledFor = useRef<Element | null>(null);
  const graceUntil = useRef(0);
  const bringIntoView = useCallback(
    (el: HTMLElement) => {
      // Centred in what the card leaves free: on a phone the card is a sheet at
      // the bottom, so a scroll margin of its height lifts the element above it.
      // scrollIntoView reaches through every scrolling ancestor (a list inside
      // a scroll box, the booking dialog's body), and the visible area when
      // zoomed in.
      const narrow = (window.visualViewport?.width ?? window.innerWidth) < NARROW_MAX;
      const before = el.style.scrollMarginBottom;
      if (narrow) el.style.scrollMarginBottom = `${(tipRef.current?.offsetHeight ?? 180) + 12}px`;
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
      graceUntil.current = Date.now() + SCROLL_GRACE_MS;
      window.setTimeout(() => {
        el.style.scrollMarginBottom = before;
      }, SCROLL_GRACE_MS);
    },
    [reducedMotion],
  );

  // Once per element, and only when it needs it: out of view, or where the
  // phone sheet would cover it. After that the person scrolls as they like;
  // if they leave it behind, the edge arrow points back.
  useEffect(() => {
    const el = target ?? viaMenu;
    if (!el || !view || !viewport || scrolledFor.current === el) return;
    scrolledFor.current = el;
    const narrow = viewport.width < NARROW_MAX;
    const sheetTop = viewport.top + viewport.height - (tipRef.current?.offsetHeight ?? 180) - 24;
    const covered = narrow && view.status === "visible" && view.box.top + view.box.height > sheetTop;
    if (view.status === "offscreen" || covered) bringIntoView(el);
  }, [target, viaMenu, view, viewport, bringIntoView]);

  // The edge arrow: only once an automatic scroll has had time to land, so it
  // does not flash while the page is still moving.
  const offscreenDir = view?.status === "offscreen" ? view.direction : null;
  useEffect(() => {
    setArrowReady(false);
    if (!offscreenDir) return;
    const id = window.setTimeout(() => setArrowReady(true), Math.max(0, graceUntil.current - Date.now()));
    return () => window.clearTimeout(id);
  }, [offscreenDir]);

  const reveal = useCallback(() => {
    // In the page but boxless (a folded section): show the part of the page
    // it lives in, where the person can unfold it.
    const around = hiddenEl ? nearestShown(hiddenEl) : null;
    around?.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
  }, [hiddenEl, reducedMotion]);

  const tryAgain = useCallback(() => {
    setPhase("search");
    setRetry((n) => n + 1);
  }, []);

  // ── Layout ────────────────────────────────────────────────────────────────
  const failed = phase === "submitted" && !!errorBox;
  // A hole only around something on screen: never at (0,0) for an element with
  // no place there. Padding in screen pixels, whatever the zoom.
  const box = view?.status === "visible" ? view.box : null;
  const hole = box ? spotlight(errorBox ? [box, errorBox] : [box], 6 / scale) : null;
  const place = viewport
    ? placeTooltip({ target: hole, viewport, tip: tipSize, safe })
    : null;
  // Never taller than what is on screen, so Next/Back/Exit are always reachable.
  const maxCardHeight = viewport ? Math.max(120, viewport.height - safe.top - safe.bottom - 24) : undefined;
  const hiddenNow = !wrongPage && phase === "search" && !!hiddenEl && !target && !viaMenu;

  // ── Words ─────────────────────────────────────────────────────────────────
  let heading: string;
  let body: string;
  if (wrongPage) {
    heading = t("ui.wrongPage.title");
    body = t("ui.wrongPage.body");
  } else if (phase === "notFound") {
    heading = t("ui.notFound.title");
    body = t("ui.notFound.body");
  } else if (hiddenNow) {
    heading = t("ui.offscreen.title");
    body = t("ui.offscreen.body");
  } else if (viaMenu && !target) {
    heading = t("ui.openMenu.do");
    body = t("ui.openMenu.why");
  } else {
    heading = t(`guides.${guide.id}.steps.${step.id}.do`);
    body = t(`guides.${guide.id}.steps.${step.id}.why`);
  }

  const btn =
    "inline-flex min-h-[40px] items-center justify-center rounded-lg px-3 text-sm font-medium transition disabled:opacity-40";
  const primaryReady = step.type === "info" || (step.type === "input" && filled) || phase === "notFound";

  return (
    <>
      {/* The dim, with a hole where the element is. Never takes a click. */}
      <svg
        ref={layerRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[55] h-full w-full"
        data-guide-layer="dim"
      >
        <defs>
          <mask id={`${titleId}-mask`}>
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {hole && (
              <rect x={hole.left} y={hole.top} width={hole.width} height={hole.height} rx="10" fill="black" />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask={`url(#${titleId}-mask)`} />
      </svg>
      {hole && (
        <div
          aria-hidden="true"
          data-guide-layer="ring"
          // No transition: an animated ring lags behind a pinch or a fling.
          className="pointer-events-none fixed z-[55] rounded-[10px] ring-2 ring-rose-500 ring-offset-2 ring-offset-transparent"
          style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
        />
      )}

      {/* The element is laid out but scrolled out of view, and the automatic
          scroll did not bring it (or the person scrolled away): an arrow at
          the edge of the screen, pointing at it, that scrolls there. */}
      {offscreenDir && arrowReady && (target ?? viaMenu) && viewport && (
        <button
          type="button"
          data-guide-layer="arrow"
          onClick={() => bringIntoView((target ?? viaMenu)!)}
          aria-label={t("ui.offscreen.scrollTo")}
          title={t("ui.offscreen.scrollTo")}
          className="fixed z-[56] flex h-11 w-11 items-center justify-center rounded-full bg-rose-600 text-white shadow-2xl"
          style={arrowPosition(offscreenDir, viewport, place)}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: `rotate(${ARROW_ROTATION[offscreenDir]}deg)` }}>
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
        </button>
      )}

      {/* The card. */}
      <div
        ref={tipRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-guide-layer="card"
        className="fixed z-[56] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-4 text-foreground shadow-2xl focus:outline-none"
        style={
          place
            ? {
                top: place.top,
                left: place.left,
                width: place.width ?? Math.min(360, (viewport?.width ?? 360) - 24),
                maxHeight: maxCardHeight,
              }
            : { visibility: "hidden", top: 0, left: 0, width: 360 }
        }
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium text-faint-foreground">
            {t(`guides.${guide.id}.title`)} · {t("ui.step", { current: stepIndex + 1, total })}
          </p>
          <button
            type="button"
            onClick={onExit}
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-hover hover:text-foreground"
            aria-label={t("ui.exit")}
            title={t("ui.exit")}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div aria-live="polite">
          <h2 id={titleId} className="mt-1 text-[15px] font-semibold leading-snug">
            {heading}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          {failed && (
            <p className="mt-2 text-sm font-medium text-rose-700 dark:text-rose-400">{t("ui.saveFailed")}</p>
          )}
        </div>

        {hiddenNow && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={reveal} className={btn + " bg-rose-600 text-white hover:bg-rose-700"}>
              {t("ui.offscreen.show")}
            </button>
          </div>
        )}

        {(wrongPage || phase === "notFound") && (
          <div className="mt-3 flex flex-wrap gap-2">
            {phase === "notFound" && !wrongPage && (
              <button type="button" onClick={tryAgain} className={btn + " border border-border hover:bg-hover"}>
                {t("ui.retry")}
              </button>
            )}
            {step.route && (
              <button
                type="button"
                onClick={() => {
                  router.push(step.route!);
                  tryAgain();
                }}
                className={btn + " bg-rose-600 text-white hover:bg-rose-700"}
              >
                {t("ui.openPage")}
              </button>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onExit}
            className={btn + " text-muted-foreground hover:bg-hover hover:text-foreground"}
          >
            {t("ui.exit")}
          </button>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => onBack(stepIndex, backTo)}
              disabled={backTo < 0}
              className={btn + " border border-border hover:bg-hover"}
            >
              {t("ui.back")}
            </button>
            <button
              type="button"
              onClick={() => onNext(stepIndex)}
              className={
                btn +
                (primaryReady
                  ? " bg-rose-600 text-white hover:bg-rose-700"
                  : " border border-border hover:bg-hover")
              }
            >
              {isLast ? t("ui.done") : t("ui.next")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

const ARROW_ROTATION = { down: 0, up: 180, left: 90, right: -90 } as const;

/** The edge arrow's spot: at the edge the element is beyond, clear of the card. */
function arrowPosition(
  dir: "up" | "down" | "left" | "right",
  area: Rect,
  card: { top: number; mode: string } | null,
): React.CSSProperties {
  const size = 44;
  const midX = area.left + area.width / 2 - size / 2;
  const midY = area.top + area.height / 2 - size / 2;
  switch (dir) {
    case "up":
      // With nothing to point at, the card is never a top sheet: the top is free.
      return { left: midX, top: area.top + 12 };
    case "down":
      return {
        left: midX,
        top: card && card.mode === "sheet-bottom" ? card.top - size - 12 : area.top + area.height - size - 12,
      };
    case "left":
      return { left: area.left + 12, top: midY };
    case "right":
      return { left: area.left + area.width - size - 12, top: midY };
  }
}
