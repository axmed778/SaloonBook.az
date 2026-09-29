"use client";

import { useTranslations } from "next-intl";
import { useModalA11y } from "@/components/use-modal-a11y";

// The first thing a new salon owner sees after signing up: what the next few
// minutes look like, and a button into the checklist on Today. Shown once —
// either button (or Escape) closes it for good (UserGuideState.welcomeShownAt).
// Only for accounts that signed up after it shipped; see checklist.ts.
export function WelcomeDialog({
  total,
  onStart,
  onLater,
}: {
  total: number;
  onStart: () => void;
  onLater: () => void;
}) {
  const t = useTranslations("Onboarding.welcome");
  const { titleId, dialogProps } = useModalA11y(onLater);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
      <div
        {...dialogProps}
        className="relative w-full max-w-md rounded-t-2xl border border-border bg-card p-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] shadow-2xl focus:outline-none sm:rounded-2xl sm:pb-6"
      >
        <span
          aria-hidden="true"
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-500/10 text-2xl"
        >
          👋
        </span>
        <h2 id={titleId} className="mt-4 text-xl font-semibold text-foreground">
          {t("title")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("body", { count: total })}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t("help")}</p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onLater}
            className="min-h-[44px] rounded-lg border border-border px-4 text-sm font-medium text-secondary-foreground transition hover:bg-hover"
          >
            {t("later")}
          </button>
          <button
            type="button"
            onClick={onStart}
            className="min-h-[44px] rounded-lg bg-rose-600 px-4 text-sm font-medium text-white transition hover:bg-rose-700"
          >
            {t("start")}
          </button>
        </div>
      </div>
    </div>
  );
}
