"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

// Push subscription lifecycle states.
type State =
  | "loading"
  | "unsupported" // browser has no Push API at all (and not the iOS case below)
  | "iosInstall" // iOS Safari: push works ONLY once the PWA is installed
  | "notConfigured" // server has no VAPID key (e.g. local dev) — hide the card
  | "denied" // the user blocked notifications in the browser
  | "off"
  | "on"
  | "working";

// VAPID public key (base64url) -> Uint8Array, as PushManager.subscribe expects.
// Backed by an explicit ArrayBuffer so it satisfies the BufferSource type
// (a plain `new Uint8Array(len)` is Uint8Array<ArrayBufferLike>, which TS 5.9
// won't accept as applicationServerKey).
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function detectIosNonStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  const isIOS =
    /iphone|ipad|ipod/i.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
  return isIOS && !standalone;
}

/**
 * Enable/disable Web Push for the signed-in owner/staff on this device.
 * Gated per platform: iOS only supports push inside an installed PWA, so there we
 * explain the requirement instead of offering a button that can't work.
 */
export function NotificationToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const t = useTranslations("Pwa");
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supported =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

      // iOS Safari before install: Push API may be absent OR present-but-inert.
      if (detectIosNonStandalone()) {
        if (!cancelled) setState("iosInstall");
        return;
      }
      if (!supported) {
        if (!cancelled) setState("unsupported");
        return;
      }
      if (!vapidPublicKey) {
        if (!cancelled) setState("notConfigured");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setState(sub ? "on" : "off");
      } catch {
        if (!cancelled) setState("off");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  async function enable() {
    if (!vapidPublicKey) return;
    setError(null);
    setState("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        }),
      });
      if (!res.ok) throw new Error("subscribe failed");
      setState("on");
    } catch (e) {
      console.error("[push] enable failed", e);
      setError(t("notifError"));
      setState("off");
    }
  }

  async function disable() {
    setError(null);
    setState("working");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
    } catch (e) {
      console.error("[push] disable failed", e);
      setError(t("notifError"));
      setState("on");
    }
  }

  // No push backend (dev) or truly unsupported browser: nothing actionable.
  if (state === "notConfigured" || state === "unsupported") return null;

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <svg
              className="h-4 w-4 text-rose-700 dark:text-rose-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            {t("notifTitle")}
          </h2>
          <p className="mt-1 text-sm text-faint-foreground">{t("notifBody")}</p>

          {state === "iosInstall" && (
            <p className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
              {t("notifIosInstall")}
            </p>
          )}
          {state === "denied" && (
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              {t("notifDenied")}
            </p>
          )}
          {error && <p className="mt-2 text-sm text-rose-700 dark:text-rose-400">{error}</p>}
        </div>

        {(state === "off" || state === "on" || state === "working" || state === "loading") && (
          <button
            onClick={state === "on" ? disable : enable}
            disabled={state === "working" || state === "loading"}
            className={
              "shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-60 " +
              (state === "on"
                ? "border border-border text-secondary-foreground hover:bg-hover"
                : "bg-rose-500 text-white hover:bg-rose-400")
            }
          >
            {state === "working"
              ? t("notifWorking")
              : state === "on"
                ? t("notifDisable")
                : t("notifEnable")}
          </button>
        )}
      </div>
    </section>
  );
}
