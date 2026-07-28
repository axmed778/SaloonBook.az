"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ReviewForm } from "../review-form";

export type Visit = {
  id: string;
  salonName: string;
  salonSlug: string;
  employeeName: string;
  serviceName: string;
  serviceId: string;
  employeeId: string;
  when: string;
  price: string;
  status: "CONFIRMED" | "COMPLETED" | "NO_SHOW" | "CANCELLED";
  canReview: boolean;
};

const STATUS_CLS: Record<Visit["status"], string> = {
  CONFIRMED: "bg-secondary text-secondary-foreground",
  COMPLETED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  NO_SHOW: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  CANCELLED: "bg-muted text-faint-foreground",
};

export function HistoryList({ visits }: { visits: Visit[] }) {
  const t = useTranslations("History");
  const tReviews = useTranslations("Reviews");
  const [reviewing, setReviewing] = useState<string | null>(null);

  return (
    <ul className="mt-6 space-y-3">
      {visits.map((v) => (
        <li key={v.id} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{v.salonName}</p>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {v.serviceName} · {v.employeeName}
              </p>
              <p className="mt-0.5 text-xs text-faint-foreground">
                {v.when} · {v.price}
              </p>
            </div>
            <span
              className={"shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium " + STATUS_CLS[v.status]}
            >
              {t(`status.${v.status}`)}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* Book again — non-personal params only (service/master); the widget
                prefills contact from the client session server-side. */}
            <Link
              href={`/${v.salonSlug}?service=${v.serviceId}&employee=${v.employeeId}`}
              className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-medium text-secondary-foreground transition hover:bg-hover"
            >
              {t("bookAgain")}
            </Link>

            {v.canReview && reviewing !== v.id && (
              <button
                onClick={() => setReviewing(v.id)}
                className="inline-flex h-9 items-center rounded-lg bg-rose-500 px-3 text-sm font-medium text-white transition hover:bg-rose-400"
              >
                {tReviews("writeReview")}
              </button>
            )}
          </div>

          {v.canReview && reviewing === v.id && (
            <ReviewForm appointmentId={v.id} onCancel={() => setReviewing(null)} />
          )}
        </li>
      ))}
    </ul>
  );
}
