"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

// ---------------------------------------------------------------------------
// Cloudflare Turnstile for the AUTH forms (login, salon sign-up, client OTP
// request). Same contract as the server half in src/lib/turnstile.ts: the
// widget exists only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, and the script
// is fetched lazily so a deploy without CAPTCHA never talks to Cloudflare at
// all. Three forms need the identical dance — script loading, theme matching,
// single-use token bookkeeping — so it lives here instead of three times over.
//
// NEXT_PUBLIC_* is inlined at BUILD time, which is why the site key is read
// through a full static reference; a computed lookup would not be replaced.
// ---------------------------------------------------------------------------

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

function getTurnstile(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

function ensureTurnstileScript(onReady: () => void): void {
  if (getTurnstile()) return onReady();
  const existing = document.getElementById("cf-turnstile-script");
  if (existing) {
    existing.addEventListener("load", onReady, { once: true });
    return;
  }
  const s = document.createElement("script");
  s.id = "cf-turnstile-script";
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  s.async = true;
  s.defer = true;
  s.addEventListener("load", onReady, { once: true });
  document.head.appendChild(s);
}

export type TurnstileHandle = {
  /** Send this to the API as `turnstileToken`. Null until the challenge passes. */
  token: string | null;
  /** True while a token is still owed — always false when CAPTCHA is disabled. */
  blocked: boolean;
  /** Tokens are single-use and consumed by the server, so call after every submit. */
  reset: () => void;
  containerRef: RefObject<HTMLDivElement | null>;
};

/**
 * Mounts a Turnstile widget into the element `containerRef` is attached to (see
 * <TurnstileBox />) and tracks its token. A no-op when no site key is set.
 */
export function useTurnstile(): TurnstileHandle {
  const [token, setToken] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;
    let renderedTheme: string | null = null;
    const container = containerRef.current;

    // Match OUR theme (the class on <html>), not the device setting: Turnstile's
    // "auto" default follows prefers-color-scheme, which renders a dark widget
    // on a light page for anyone who overrode the theme.
    const currentTheme = () =>
      document.documentElement.classList.contains("light") ? "light" : "dark";

    const renderWidget = () => {
      const ts = getTurnstile();
      if (cancelled || !ts || !container || widgetId.current) return;
      renderedTheme = currentTheme();
      widgetId.current = ts.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: renderedTheme,
        callback: (t: string) => setToken(t),
        "expired-callback": () => setToken(null),
        "error-callback": () => setToken(null),
      });
    };

    const removeWidget = () => {
      const ts = getTurnstile();
      if (ts && widgetId.current) {
        try {
          ts.remove(widgetId.current);
        } catch {
          /* widget already gone */
        }
      }
      widgetId.current = null;
      setToken(null);
    };

    ensureTurnstileScript(() => {
      if (cancelled) return;
      renderWidget();
    });

    // Turnstile has no setTheme and cannot restyle a mounted widget, so a theme
    // toggle means tearing it down and rendering again (which drops the token —
    // a fair price for a rare mid-form toggle).
    const observer = new MutationObserver(() => {
      if (cancelled || !widgetId.current || currentTheme() === renderedTheme) return;
      removeWidget();
      renderWidget();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      cancelled = true;
      observer.disconnect();
      removeWidget();
    };
  }, []);

  const reset = useCallback(() => {
    const ts = getTurnstile();
    if (ts && widgetId.current) {
      try {
        ts.reset(widgetId.current);
      } catch {
        /* no-op */
      }
    }
    setToken(null);
  }, []);

  return {
    token,
    blocked: Boolean(TURNSTILE_SITE_KEY) && token === null,
    reset,
    containerRef,
  };
}

/** The widget's mount point. Renders nothing when CAPTCHA is not configured. */
export function TurnstileBox({ turnstile }: { turnstile: TurnstileHandle }) {
  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={turnstile.containerRef} className="min-h-[65px]" />;
}
