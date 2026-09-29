"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { registerTopLayer } from "@/components/use-modal-a11y";
import type { GuideDef } from "@/lib/guides/registry";
import { placeTooltip, scrollDelta, spotlight, type Insets, type Rect } from "./placement";
import { findTarget, inFixedLayer, isFilled, isTextField } from "./targets";

// One step of a running guide on screen: the dimmed page with a hole around the
// real element, and the card that says what to do there. Remounted per step
// (keyed by the provider), so every piece of state below starts fresh.
//
// Layers: z-[55] for the dim and z-[56] for the card — above the modals and the
// drawer (z-50), so a step can point into them, and BELOW the toast (z-[60]),
// which is where a failed save explains itself ("every staff seat is taken").
// The dim never takes a click: the page stays fully usable, so a person who
// wanders off is never trapped, and the card's buttons are always there.

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

function currentViewport(): Rect {
  const vv = window.visualViewport;
  return vv
    ? { top: vv.offsetTop, left: vv.offsetLeft, width: vv.width, height: vv.height }
    : { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
}

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
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [errorRect, setErrorRect] = useState<Rect | null>(null);
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

  // ── The frame loop: find the element, follow it, notice changes ───────────
  useEffect(() => {
    let raf = 0;
    let advanced = false;
    const tick = () => {
      const el = step.target && !wrongPage ? findTarget(step.target) : null;
      // On a phone the menu entry lives in the drawer; until it is opened, point
      // at the button that opens it.
      const menu = !el && step.type === "navigate" ? findTarget(MENU_TARGET) : null;
      setTarget((prev) => (prev === el ? prev : el));
      setViaMenu((prev) => (prev === menu ? prev : menu));
      const shown = el ?? menu;
      const r = shown ? rectOf(shown) : null;
      setTargetRect((prev) => (sameRect(prev, r) ? prev : r));
      const errEl = step.errorTarget ? findTarget(step.errorTarget) : null;
      const er = errEl ? rectOf(errEl) : null;
      setErrorRect((prev) => (sameRect(prev, er) ? prev : er));
      const vp = currentViewport();
      setViewport((prev) => (sameRect(prev, vp) ? prev : vp));
      if (step.type === "input" && el) {
        const f = isFilled(el);
        setFilled((prev) => (prev === f ? prev : f));
      }
      // A button that opens a form, when the form is already open: the person
      // is ahead of the guide, so catch up instead of waiting for a button that
      // only shows while the form is closed.
      if (!advanced && !el && step.type === "click" && !step.awaitRemoval && !wrongPage) {
        const after = guide.steps[stepIndex + 1];
        if (after?.target && findTarget(after.target)) {
          advanced = true;
          nextRef.current(stepIndex);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [guide, step, stepIndex, wrongPage]);

  // ── Found / not found / submitted ─────────────────────────────────────────
  const found = !!(target || viaMenu);
  useEffect(() => {
    if (wrongPage || !step.target) return;
    if (phase === "submitted") {
      // The form closed: the save went through.
      if (!target) onNext(stepIndex);
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
  }, [found, target, phase, retry, wrongPage, step.target, stepIndex, onNext, onNotFound]);

  // ── What finishes the step ────────────────────────────────────────────────
  useEffect(() => {
    if (!target) return;
    if (step.type === "click") {
      const onClick = () => (step.awaitRemoval ? setPhase("submitted") : onNext(stepIndex));
      target.addEventListener("click", onClick, true);
      return () => target.removeEventListener("click", onClick, true);
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
  useEffect(() => {
    const el = target ?? viaMenu;
    if (!el || scrolledFor.current === el || inFixedLayer(el)) return;
    scrolledFor.current = el;
    const delta = scrollDelta(rectOf(el), currentViewport(), tipRef.current?.offsetHeight ?? 180);
    if (delta !== 0) window.scrollBy({ top: delta, behavior: reducedMotion ? "auto" : "smooth" });
  }, [target, viaMenu, reducedMotion]);

  const tryAgain = useCallback(() => {
    setPhase("search");
    setRetry((n) => n + 1);
  }, []);

  // ── Layout ────────────────────────────────────────────────────────────────
  const failed = phase === "submitted" && !!errorRect;
  const hole = spotlight(
    [targetRect, failed || (errorRect && step.awaitRemoval) ? errorRect : null].filter(
      (r): r is Rect => r !== null,
    ),
  );
  const place = viewport
    ? placeTooltip({ target: hole, viewport, tip: tipSize, safe })
    : null;

  // ── Words ─────────────────────────────────────────────────────────────────
  let heading: string;
  let body: string;
  if (wrongPage) {
    heading = t("ui.wrongPage.title");
    body = t("ui.wrongPage.body");
  } else if (phase === "notFound") {
    heading = t("ui.notFound.title");
    body = t("ui.notFound.body");
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
          className={
            "pointer-events-none fixed z-[55] rounded-[10px] ring-2 ring-rose-500 ring-offset-2 ring-offset-transparent " +
            (reducedMotion ? "" : "transition-all duration-150")
          }
          style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
        />
      )}

      {/* The card. */}
      <div
        ref={tipRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-guide-layer="card"
        className="fixed z-[56] rounded-2xl border border-border bg-card p-4 text-foreground shadow-2xl focus:outline-none"
        style={
          place
            ? {
                top: place.top,
                left: place.left,
                width: place.width ?? Math.min(360, (viewport?.width ?? 360) - 24),
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

        <div className="mt-4 flex items-center gap-2">
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
