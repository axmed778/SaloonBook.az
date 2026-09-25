"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import type { IgDigestItem, IgDigestShownPriority } from "@/lib/ig-digest";
import { ErrorToast } from "../_components/toast";
import { setIgDigestItemDone } from "./actions";

type Row = IgDigestItem & { index: number };

const PRIORITY_CLASS: Record<IgDigestShownPriority, string> = {
  hot: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  warm: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  cold: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
};

export function IgDigestList({ digestId, items }: { digestId: string; items: Row[] }) {
  const t = useTranslations("IgDigest");
  const [done, setDone] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(items.map((i) => [i.index, i.done])),
  );
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);

  const doneCount = items.filter((i) => done[i.index]).length;

  // Optimistic: the box flips at once and flips back if the write is refused.
  async function toggle(item: Row, next: boolean) {
    setDone((d) => ({ ...d, [item.index]: next }));
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

  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("progress", { done: doneCount, total: items.length })}
      </p>
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <DigestCard
            key={item.index}
            item={item}
            done={!!done[item.index]}
            onToggle={(next) => void toggle(item, next)}
          />
        ))}
      </ul>
      {error && <ErrorToast message={error} onClose={clearError} />}
    </>
  );
}

function DigestCard({
  item,
  done,
  onToggle,
}: {
  item: Row;
  done: boolean;
  onToggle: (next: boolean) => void;
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
        </div>
      </div>
    </li>
  );
}
