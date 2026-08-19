"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

// Blocking re-consent dialog. Shown when a signed-in party's accepted version of
// a legal document is superseded (see src/lib/legal-consent.ts). Mandatory by
// design: no close button, no backdrop dismiss, no Escape — the only ways out
// are accepting or signing out, so the area is never used under a stale consent.
//
// The gate is rendered by a server layout that already decided consent is stale,
// and `accept` re-derives the stale set server-side; this component only
// collects the click.

export type GateDoc = {
  /** LegalDoc key — also the i18n key under LegalReconsent.docs. */
  key: string;
  /** Versioned URL of the document in force, e.g. /legal/v1.1/....pdf */
  url: string;
  version: string;
};

export function ConsentGate({
  docs,
  logoutPath,
  logoutHref,
  accept,
}: {
  docs: GateDoc[];
  /** POST endpoint that clears the session cookie. */
  logoutPath: string;
  /** Where to land after signing out. */
  logoutHref: string;
  /** Server action recording the acceptance. */
  accept: () => Promise<void>;
}) {
  const t = useTranslations("LegalReconsent");
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [pending, start] = useTransition();
  const [leaving, setLeaving] = useState(false);
  const busy = pending || leaving;

  // The dialog covers the page, but the content behind it still scrolls on
  // touch and remains reachable by keyboard. Locking the body scroll keeps the
  // block honest while the gate is mounted.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function onAccept() {
    start(async () => {
      await accept();
      router.refresh();
    });
  }

  function onLogout() {
    setLeaving(true);
    void (async () => {
      try {
        await fetch(logoutPath, { method: "POST" });
        router.push(logoutHref);
        router.refresh();
      } finally {
        setLeaving(false);
      }
    })();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reconsent-title"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <h2 id="reconsent-title" className="text-lg font-semibold text-foreground">
          {t("title")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("body", { count: docs.length })}
        </p>

        <ul className="mt-4 flex flex-col gap-2">
          {docs.map((doc) => (
            <li key={doc.key}>
              <a
                href={doc.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition hover:bg-hover"
              >
                <svg
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
                <span className="flex-1">{t(`docs.${doc.key}`)}</span>
                <span className="font-mono text-xs text-muted-foreground">v{doc.version}</span>
              </a>
            </li>
          ))}
        </ul>

        <label className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"
          />
          <span>{t("confirm")}</span>
        </label>

        <div className="mt-5 flex gap-3">
          <button
            onClick={onAccept}
            disabled={!checked || busy}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? t("accepting") : t("accept")}
          </button>
          <button
            onClick={onLogout}
            disabled={busy}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-hover disabled:opacity-60"
          >
            {t("logout")}
          </button>
        </div>
      </div>
    </div>
  );
}
