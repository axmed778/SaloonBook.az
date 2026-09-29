"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useModalA11y } from "@/components/use-modal-a11y";
import type { GuideEntry } from "@/lib/guides/availability";
import { GUIDE_SECTIONS } from "@/lib/guides/registry";
import { useGuides } from "./guide-provider";

// The round "?" button in the dashboard's bottom-right corner and the panel it
// opens: "Hi! What would you like to do?" and the tasks, grouped by section.
// Picking one starts its guide on the real screen.
//
// Only the dashboard renders it (DashboardShell), so the public booking pages
// never show it. On a phone it sits above the bottom tab bar, clear of the home
// indicator; `lift` raises it further while the install prompt occupies that
// corner.

export function HelpButton({ lift = 0 }: { lift?: number }) {
  const t = useTranslations("Help");
  const { catalog, setup, runningId } = useGuides();
  const [open, setOpen] = useState(false);

  // Nothing to offer (a platform admin), or a guide is on screen already.
  if (catalog.length === 0 && !setup) return null;

  return (
    <>
      {!runningId && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-tour="help.fab"
          aria-label={t("fab")}
          title={t("fab")}
          aria-haspopup="dialog"
          className="fixed right-[calc(env(safe-area-inset-right)+1rem)] bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[45] flex h-12 w-12 items-center justify-center rounded-full bg-rose-600 text-white shadow-2xl transition hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 lg:right-6 lg:bottom-6"
          style={lift > 0 ? { transform: `translateY(-${lift}px)` } : undefined}
        >
          <span aria-hidden="true" className="text-xl font-bold leading-none">?</span>
        </button>
      )}
      {open && <HelpPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function HelpPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("Help");
  const tg = useTranslations("Guides");
  const { catalog, start, setup, openChecklist } = useGuides();
  const { titleId, dialogProps } = useModalA11y(onClose);
  // The task whose "why not" notice is unfolded.
  const [openNotice, setOpenNotice] = useState<string | null>(null);

  function pick(g: GuideEntry) {
    if (g.state === "ready") {
      onClose();
      start(g.id);
    } else {
      setOpenNotice((cur) => (cur === g.id ? null : g.id));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-end sm:justify-end sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        {...dialogProps}
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-border bg-card pb-safe shadow-2xl focus:outline-none sm:max-h-[80vh] sm:w-[380px] sm:rounded-2xl sm:pb-0"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 pt-4 pb-3">
          <div>
            <p className="text-xs font-medium text-faint-foreground">{t("title")}</p>
            <h2 id={titleId} className="mt-0.5 text-lg font-semibold text-foreground">
              {t("greeting")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            title={t("close")}
            className="-mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-hover hover:text-foreground"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="overflow-y-auto px-3 py-3">
          {/* The first-run checklist: how far along, and the way back to it
              after "Hide". */}
          {setup && (
            <section className="mb-3">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  openChecklist();
                }}
                className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-left text-sm text-foreground transition hover:bg-rose-500/10"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{t("setup.title")}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t("setup.progress", { done: setup.done, total: setup.total })}
                  </span>
                </span>
                <svg className="h-4 w-4 shrink-0 text-faint-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
              </button>
            </section>
          )}
          {GUIDE_SECTIONS.map((section) => {
            const items = catalog.filter((g) => g.section === section);
            if (items.length === 0) return null;
            return (
              <section key={section} className="mb-3 last:mb-0">
                <h3 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-faint-foreground">
                  {t(`sections.${section}`)}
                </h3>
                <ul className="space-y-1">
                  {items.map((g) => (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => pick(g)}
                        aria-expanded={g.state === "ready" ? undefined : openNotice === g.id}
                        className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-foreground transition hover:bg-hover"
                      >
                        <span className="min-w-0 flex-1">{tg(`guides.${g.id}.title`)}</span>
                        {g.completed && (
                          <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                            {t("done")}
                          </span>
                        )}
                        <svg className="h-4 w-4 shrink-0 text-faint-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
                      </button>
                      {openNotice === g.id && g.state !== "ready" && (
                        <GuideBlockedNotice entry={g} onStart={(id) => { onClose(); start(id); }} onNavigate={onClose} />
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Why a task cannot be walked through right now, and the way forward — never a
 * dead end: a plan limit shows the way to a bigger plan (or who can take it),
 * a missing prerequisite offers its own guide.
 */
export function GuideBlockedNotice({
  entry,
  onStart,
  onNavigate,
}: {
  entry: GuideEntry;
  onStart: (id: GuideEntry["id"]) => void;
  onNavigate?: () => void;
}) {
  const t = useTranslations("Help");
  const { catalog } = useGuides();
  const box = "mx-3 mb-2 mt-1 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-foreground";
  const action =
    "mt-2 inline-flex min-h-[40px] items-center rounded-lg bg-rose-600 px-3 text-sm font-medium text-white transition hover:bg-rose-700";

  if (entry.state === "needs") {
    const prerequisiteReady = catalog.some((g) => g.id === entry.guide && g.state === "ready");
    return (
      <div className={box} role="note">
        <p>{t(`needs.${entry.id}.${entry.fact}`)}</p>
        {prerequisiteReady && (
          <button type="button" className={action} onClick={() => onStart(entry.guide)}>
            {t(`showGuide.${entry.guide}`)}
          </button>
        )}
      </div>
    );
  }

  if (entry.state === "limit" || entry.state === "plan") {
    return (
      <div className={box} role="note">
        <p className="font-medium">
          {entry.state === "limit" ? t(`limit.${entry.limit}.title`, { max: entry.max }) : t("plan.title")}
        </p>
        <p className="mt-1 text-muted-foreground">
          {entry.state === "limit" ? t(`limit.${entry.limit}.body`) : t("plan.body")}
        </p>
        {entry.canUpgrade ? (
          <Link href="/dashboard/billing" className={action} onClick={onNavigate}>
            {t("upgrade")}
          </Link>
        ) : (
          <p className="mt-2 text-muted-foreground">{t("askOwner")}</p>
        )}
      </div>
    );
  }

  return null;
}
