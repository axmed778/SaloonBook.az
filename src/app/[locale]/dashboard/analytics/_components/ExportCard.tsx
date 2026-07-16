"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

type Dataset = "appointments" | "clients";
type Range = "this-month" | "last-month" | "this-year" | "all";

const DATASETS: Dataset[] = ["appointments", "clients"];
const RANGES: Range[] = ["this-month", "last-month", "this-year", "all"];
const RANGE_KEY: Record<Range, string> = {
  "this-month": "thisMonth",
  "last-month": "lastMonth",
  "this-year": "thisYear",
  all: "all",
};

const SELECT_CLASS =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-border-strong sm:w-48";

// PRO data export. Downloading the attachment is a plain navigation to the API
// route — Content-Disposition makes the browser save it without leaving the
// page, so there's no load event to clear `busy`; a short timer does it instead.
// The period picker only applies to bookings; the clients export is a full
// snapshot.
export function ExportCard({ canExport }: { canExport: boolean }) {
  const t = useTranslations("Export");
  const [dataset, setDataset] = useState<Dataset>("appointments");
  const [range, setRange] = useState<Range>("this-month");
  const [busy, setBusy] = useState(false);

  function download() {
    setBusy(true);
    const query = dataset === "appointments" ? `?range=${range}` : "";
    window.location.assign(`/api/dashboard/export/${dataset}${query}`);
    setTimeout(() => setBusy(false), 1500);
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-accent">
          <svg
            className="h-[18px] w-[18px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      {canExport ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            {t("datasetLabel")}
            <select
              value={dataset}
              onChange={(e) => setDataset(e.target.value as Dataset)}
              className={SELECT_CLASS}
            >
              {DATASETS.map((d) => (
                <option key={d} value={d}>
                  {t(`datasets.${d}`)}
                </option>
              ))}
            </select>
          </label>

          {dataset === "appointments" && (
            <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
              {t("rangeLabel")}
              <select
                value={range}
                onChange={(e) => setRange(e.target.value as Range)}
                className={SELECT_CLASS}
              >
                {RANGES.map((r) => (
                  <option key={r} value={r}>
                    {t(`ranges.${RANGE_KEY[r]}`)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            type="button"
            onClick={download}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-60"
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
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            {t("download")}
          </button>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
          <p className="text-sm text-muted-foreground">{t("proBody")}</p>
          <Link
            href="/dashboard/billing"
            className="mt-3 inline-flex items-center rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400"
          >
            {t("upgrade")}
          </Link>
        </div>
      )}
    </div>
  );
}
