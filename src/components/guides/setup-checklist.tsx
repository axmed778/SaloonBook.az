"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { markLinkCopied } from "@/app/[locale]/dashboard/_actions/guides";
import type { SetupItem } from "@/lib/guides/checklist";
import { useGuidesOptional } from "./guide-provider";
import { GuideBlockedNotice } from "./help-button";

// The first-run checklist at the top of Today: six steps to a salon clients can
// book online, each ticked by the salon's real data (checklist.ts), each with a
// "Show me how" that starts its guide on the real screen.
//
// It never blocks anything: it is a card in the page, it folds to one line, and
// "Hide" puts it away — the help panel brings it back. Renders nothing when it
// is not this person's (the server sent none), all done, or hidden.

export function SetupChecklist() {
  const help = useGuidesOptional();
  const t = useTranslations("Onboarding.checklist");
  const [justHidden, setJustHidden] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const focus = help?.checklistFocus ?? 0;

  // Opened from the welcome or the help panel: bring it into view.
  useEffect(() => {
    if (focus === 0) return;
    const el = cardRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    el.focus({ preventScroll: true });
  }, [focus]);

  if (!help?.setup) return null;
  const { setup, collapsed, setCollapsed, hideChecklist, openChecklist } = help;

  if (setup.hidden) {
    // Right after "Hide", say where it went; after a reload, nothing.
    if (!justHidden) return null;
    return (
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground" role="status">
        <span className="min-w-0 flex-1">{t("hiddenNote")}</span>
        <button
          type="button"
          onClick={() => {
            setJustHidden(false);
            openChecklist();
          }}
          className="font-medium text-rose-700 transition hover:text-rose-600 dark:text-rose-400"
        >
          {t("undo")}
        </button>
      </div>
    );
  }

  const pct = Math.round((setup.done / setup.total) * 100);
  const listId = "setup-checklist-items";

  return (
    <section
      ref={cardRef}
      tabIndex={-1}
      aria-labelledby="setup-checklist-title"
      data-tour="today.checklist"
      className="mb-5 scroll-mt-20 rounded-2xl border border-border bg-card p-4 focus:outline-none sm:p-5"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="setup-checklist-title" className="text-base font-semibold text-foreground">
            {t("title")}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("progress", { done: setup.done, total: setup.total })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-controls={listId}
          className="min-h-[36px] shrink-0 rounded-lg border border-border px-3 text-sm font-medium text-secondary-foreground transition hover:bg-hover"
        >
          {collapsed ? t("expand") : t("collapse")}
        </button>
      </div>

      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={setup.total}
        aria-valuenow={setup.done}
        aria-label={t("title")}
      >
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>

      {!collapsed && (
        <>
          <ol id={listId} className="mt-4 space-y-1">
            {setup.items.map((item, i) => (
              <ChecklistRow key={item.id} item={item} n={i + 1} />
            ))}
          </ol>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => {
                setJustHidden(true);
                hideChecklist();
              }}
              className="text-sm text-muted-foreground transition hover:text-foreground"
            >
              {t("hide")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function ChecklistRow({ item, n }: { item: SetupItem; n: number }) {
  const t = useTranslations("Onboarding.checklist");
  const help = useGuidesOptional()!;
  const router = useRouter();
  const [notice, setNotice] = useState(false);
  const [copied, setCopied] = useState(false);
  const entry = help.catalog.find((g) => g.id === item.guide);

  function showHow() {
    if (!entry) return;
    if (entry.state === "ready") help.start(entry.id);
    else setNotice((v) => !v);
  }

  function copy() {
    const url = help.bookingUrl;
    if (!url) return;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      markLinkCopied()
        .then(() => router.refresh())
        .catch(() => {});
    });
  }

  return (
    <li className="rounded-xl px-2 py-2.5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold " +
            (item.done
              ? "bg-emerald-500 text-white"
              : "border border-border-strong text-muted-foreground")
          }
        >
          {item.done ? "✓" : n}
        </span>
        <div className="min-w-0 flex-1">
          <p className={"text-sm font-medium " + (item.done ? "text-muted-foreground" : "text-foreground")}>
            {t(`items.${item.id}.title`)}
            <span className="sr-only"> — {item.done ? t("stateDone") : t("stateTodo")}</span>
          </p>
          {!item.done && <p className="mt-0.5 text-sm text-muted-foreground">{t(`items.${item.id}.hint`)}</p>}

          {!item.done && item.id === "link" && help.bookingUrl && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="min-w-0 max-w-full flex-1 basis-40 truncate rounded-lg border border-border bg-background px-3 py-2 text-xs text-secondary-foreground">
                {help.bookingUrl}
              </code>
              <button
                type="button"
                onClick={copy}
                className="min-h-[36px] rounded-lg border border-border px-3 text-sm font-medium text-secondary-foreground transition hover:bg-hover"
              >
                {copied ? t("copied") : t("copy")}
              </button>
            </div>
          )}

          {!item.done && entry && (
            <button
              type="button"
              onClick={showHow}
              aria-expanded={entry.state === "ready" ? undefined : notice}
              className="mt-2 inline-flex min-h-[36px] items-center rounded-lg bg-rose-600 px-3 text-sm font-medium text-white transition hover:bg-rose-700"
            >
              {t("showHow")}
            </button>
          )}
        </div>
      </div>
      {notice && entry && entry.state !== "ready" && (
        <GuideBlockedNotice entry={entry} onStart={(id) => help.start(id)} />
      )}
    </li>
  );
}
