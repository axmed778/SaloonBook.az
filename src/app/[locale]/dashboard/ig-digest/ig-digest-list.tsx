"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { IgDigestItem, IgDigestShownPriority } from "@/lib/ig-digest";
import { ErrorToast, UndoToast } from "../_components/toast";
import { setIgDigestItemDone, setIgLeadExcluded } from "./actions";

type Row = IgDigestItem & { index: number };

/** A lead excluded from the digest, as the page lists it. */
export interface ExcludedLead {
  igUserId: string;
  username: string | null;
  name: string | null;
  /** When it was excluded, already formatted for display. */
  when: string;
}

type Lead = Pick<ExcludedLead, "igUserId" | "username" | "name">;

const leadLabel = (lead: Lead) =>
  lead.name || (lead.username ? `@${lead.username}` : lead.igUserId);

const PRIORITY_CLASS: Record<IgDigestShownPriority, string> = {
  hot: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  warm: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  cold: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
};

export function IgDigestList({
  digestId,
  items,
  excluded,
}: {
  /** Null until the first digest has been generated. */
  digestId: string | null;
  items: Row[];
  excluded: ExcludedLead[];
}) {
  const t = useTranslations("IgDigest");
  const router = useRouter();
  const [done, setDone] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(items.map((i) => [i.index, i.done])),
  );
  // Exclusions made on this page, by igUserId, ahead of the server's answer:
  // true hides the card at once, false brings it back. After the write lands,
  // router.refresh() brings `excluded` in line and the entry just agrees with it.
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const [undo, setUndo] = useState<Lead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);
  const clearUndo = useCallback(() => setUndo(null), []);

  const excludedIds = new Set(excluded.map((l) => l.igUserId));
  const isExcluded = (igUserId: string) => override[igUserId] ?? excludedIds.has(igUserId);
  const visible = items.filter((i) => !isExcluded(i.igUserId));
  // Excluded just now (not yet in the server's list) first, then the server's
  // own, minus whatever was restored here a moment ago. A digest holds each
  // lead once (buildDigestItems), so `items` needs no dedupe.
  const excludedHere = items.filter(
    (i) => override[i.igUserId] === true && !excludedIds.has(i.igUserId),
  );
  const excludedList: Array<Lead & { when?: string }> = [
    ...excludedHere,
    ...excluded.filter((l) => isExcluded(l.igUserId)),
  ];

  const doneCount = visible.filter((i) => done[i.index]).length;

  // Optimistic: the box flips at once and flips back if the write is refused.
  async function toggle(item: Row, next: boolean) {
    setDone((d) => ({ ...d, [item.index]: next }));
    if (!digestId) return;
    const res = await setIgDigestItemDone({
      digestId,
      index: item.index,
      igUserId: item.igUserId,
      done: next,
    }).catch(() => ({ ok: false as const, error: t("errors.generic") }));
    if (!res.ok) {
      setDone((d) => ({ ...d, [item.index]: !next }));
      setError(res.error);
    }
  }

  // Optimistic like the checkbox. Excluding offers an undo; restoring does not
  // need one — the lead is simply back in the list.
  async function setExcluded(lead: Lead, next: boolean) {
    setOverride((o) => ({ ...o, [lead.igUserId]: next }));
    setUndo(next ? lead : null);
    const res = await setIgLeadExcluded({ igUserId: lead.igUserId, excluded: next }).catch(
      () => ({ ok: false as const, error: t("errors.generic") }),
    );
    if (!res.ok) {
      setOverride((o) => ({ ...o, [lead.igUserId]: !next }));
      setUndo(null);
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <>
      {!digestId ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          {t("noTasks")}
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            {t("progress", { done: doneCount, total: visible.length })}
          </p>
          <ul className="flex flex-col gap-3">
            {visible.map((item) => (
              <DigestCard
                key={item.index}
                item={item}
                done={!!done[item.index]}
                onToggle={(next) => void toggle(item, next)}
                onExclude={() => void setExcluded(item, true)}
              />
            ))}
          </ul>
        </>
      )}

      {excludedList.length > 0 && (
        <details className="mt-8 rounded-xl border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            {t("excludedTitle", { count: excludedList.length })}
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">{t("excludedHint")}</p>
          <ul className="mt-3 flex flex-col divide-y divide-border">
            {excludedList.map((lead) => (
              <li key={lead.igUserId} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {leadLabel(lead)}
                  {lead.name && lead.username && (
                    <span className="ml-2 text-muted-foreground">@{lead.username}</span>
                  )}
                </span>
                {lead.when && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t("excludedOn", { when: lead.when })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void setExcluded(lead, false)}
                  className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-muted"
                >
                  {t("restore")}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {undo && (
        <UndoToast
          // Keyed so excluding a second lead restarts the timer for it.
          key={undo.igUserId}
          message={t("excludedToast", { name: leadLabel(undo) })}
          undoLabel={t("undo")}
          onUndo={() => void setExcluded(undo, false)}
          onClose={clearUndo}
        />
      )}
      {error && <ErrorToast message={error} onClose={clearError} />}
    </>
  );
}

function DigestCard({
  item,
  done,
  onToggle,
  onExclude,
}: {
  item: Row;
  done: boolean;
  onToggle: (next: boolean) => void;
  onExclude: () => void;
}) {
  const t = useTranslations("IgDigest");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(item.draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure origin, denied permission): the draft is
      // on screen and selectable, so there is nothing better to fall back to.
    }
  }

  return (
    <li
      className={`rounded-xl border border-border bg-card p-4 transition ${done ? "opacity-50" : ""}`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={done}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={t("done")}
          className="mt-1 h-4 w-4 shrink-0 accent-current"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_CLASS[item.priority]}`}
            >
              {t(`priority.${item.priority}`)}
            </span>
            {(item.name || !item.username) && (
              <span className={`font-medium text-foreground ${done ? "line-through" : ""}`}>
                {item.name || item.igUserId}
              </span>
            )}
            {item.username && (
              <a
                href={`https://instagram.com/${encodeURIComponent(item.username)}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`hover:underline ${item.name ? "text-sm text-muted-foreground" : "font-medium text-foreground"}`}
              >
                @{item.username}
              </a>
            )}
            <span className="ml-auto flex flex-wrap items-center gap-x-2 text-xs">
              {/* Only when it's our move: "waiting 0 days" would just be noise. */}
              {item.daysSinceMyReply > 0 && (
                <span className="font-medium text-rose-600 dark:text-rose-400">
                  {t("waiting", { days: item.daysSinceMyReply })}
                </span>
              )}
              <span className="text-muted-foreground">
                {item.daysIdle === null ? t("idleNever") : t("idleDays", { days: item.daysIdle })}
              </span>
            </span>
          </div>

          <dl className="mt-3 grid gap-2 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("reason")}
              </dt>
              <dd className="text-foreground">{item.reason}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("action")}
              </dt>
              <dd className="text-foreground">{item.action}</dd>
            </div>
          </dl>

          {/* No draft means the playbook scenario still needs a decision (an
              unresolved [ПРОВЕРЬ] / [РЕШИ]); `reason` names what. An empty box
              with a Copy button would just look broken. */}
          {item.draft ? (
            <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                {item.draft}
              </p>
              <button
                type="button"
                onClick={() => void copy()}
                className="mt-2 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-muted"
              >
                {copied ? t("copied") : t("copy")}
              </button>
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
              {t("noDraft")}
            </p>
          )}

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={onExclude}
              title={t("excludeHint")}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              {t("exclude")}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
