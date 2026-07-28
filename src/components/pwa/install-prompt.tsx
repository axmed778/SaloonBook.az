"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { dismissInstallPrompt } from "./actions";

// The event Chrome/Android fires so a site can offer its own install UI.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Custom "Add to Home Screen" prompt.
 *  - Android/Chrome: captures `beforeinstallprompt` and shows a Quraşdır button
 *    that triggers the native install flow.
 *  - iOS Safari: no such event exists, so we show a one-time instruction sheet
 *    (Share → Add to Home Screen).
 * Never shown when already installed (display-mode: standalone). Dismissal is
 * persisted server-side via a cookie (see actions.ts); `dismissed` reflects it,
 * so a dismissed user never sees it flash on the next load.
 */
export function InstallPrompt({ dismissed }: { dismissed: boolean }) {
  const t = useTranslations("Pwa");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (dismissed) return;

    // Already running as an installed app? Never prompt.
    const nav = window.navigator as Navigator & { standalone?: boolean };
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
    if (standalone) return;

    const ua = nav.userAgent;
    const isIOS =
      /iphone|ipad|ipod/i.test(ua) ||
      // iPadOS 13+ reports as desktop Safari; detect via touch points.
      (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
    const isSafari = /^((?!chrome|android|crios|fxios|edgios|opr).)*safari/i.test(ua);

    if (isIOS && isSafari) {
      setIos(true);
      setShow(true);
      return;
    }

    const onPrompt = (e: Event) => {
      // Suppress Chrome's default mini-infobar; we render our own card.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    const onInstalled = () => {
      setShow(false);
      void dismissInstallPrompt();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [dismissed]);

  async function close() {
    setShow(false);
    try {
      await dismissInstallPrompt();
    } catch {
      /* a failed dismiss just means it may re-appear next load — non-critical */
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } finally {
      void close();
    }
  }

  if (!show) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
      role="dialog"
      aria-label={ios ? t("iosTitle") : t("installTitle")}
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-4 shadow-frame">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M12 8v8M8 12h8" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {ios ? t("iosTitle") : t("installTitle")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {ios ? t("iosBody") : t("installBody")}
            </p>

            {ios ? (
              <ol className="mt-3 space-y-1.5 text-xs text-secondary-foreground">
                <li className="flex items-center gap-2">
                  <StepDot n={1} />
                  <span className="inline-flex items-center gap-1">
                    {t("iosStep1")}
                    <svg
                      className="h-4 w-4 text-rose-600 dark:text-rose-400"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 16V4M8 8l4-4 4 4" />
                      <path d="M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
                    </svg>
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <StepDot n={2} />
                  <span>{t("iosStep2")}</span>
                </li>
                <li className="flex items-center gap-2">
                  <StepDot n={3} />
                  <span>{t("iosStep3")}</span>
                </li>
              </ol>
            ) : null}
          </div>
          <button
            onClick={close}
            aria-label={t("dismiss")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-hover hover:text-foreground"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!ios ? (
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              onClick={close}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-hover hover:text-foreground"
            >
              {t("dismiss")}
            </button>
            <button
              onClick={install}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition hover:bg-accent-hover"
            >
              {t("installAction")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StepDot({ n }: { n: number }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">
      {n}
    </span>
  );
}
